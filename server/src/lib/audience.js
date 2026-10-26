import jwt from 'jsonwebtoken';
import { findLiveByCode } from './liveTarget.js';
import { config } from '../config.js';
import { createRateLimiter } from './rateLimiter.js';

/** An error with a machine-readable code, so clients can react without parsing messages. */
export class LiveError extends TypeError {
  constructor(message, code, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

// Conservative proposed defaults, all overridable by environment. A classroom behind one
// shared IP must not be blocked, so the IP backstop is generous and the real limit is per person.
const env = (name, fallback) => (process.env[name] ? Number(process.env[name]) : fallback);
export const limits = {
  answersPerParticipant: () => ({ limit: env('LIVE_ANSWERS_PER_10S', 20), windowMs: 10_000 }),
  identifyPerParticipant: () => ({ limit: env('LIVE_IDENTIFY_PER_MIN', 6), windowMs: 60_000 }),
  actionsPerIp: () => ({ limit: env('LIVE_ACTIONS_PER_IP_PER_MIN', 1200), windowMs: 60_000 }),
  credentialsPerIp: () => ({ limit: env('LIVE_CREDENTIALS_PER_IP_PER_MIN', 120), windowMs: 60_000 }),
};

let limiters = null;
function getLimiters() {
  if (!limiters) {
    limiters = {
      answers: createRateLimiter(limits.answersPerParticipant()),
      identify: createRateLimiter(limits.identifyPerParticipant()),
      ip: createRateLimiter(limits.actionsPerIp()),
      credentials: createRateLimiter(limits.credentialsPerIp()),
    };
  }
  return limiters;
}
/** Test hook: rebuild limiters from current environment values. */
export function resetAudienceLimiters() {
  limiters = null;
}

const CREDENTIAL_DAYS = 30;

/** Session credentials bind to the immutable run id; legacy deck credentials keep their code scope. */
export function signParticipantToken(accessCode, participantId, scope) {
  return jwt.sign({ typ: 'participant', aud: scope ?? `presentation:${accessCode}`, sub: participantId }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: `${CREDENTIAL_DAYS}d`,
  });
}

export function verifyParticipantToken(token, accessCode, scope) {
  try {
    const p = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], audience: scope ?? `presentation:${accessCode}` });
    if (p.typ !== 'participant' || typeof p.sub !== 'string') throw new Error('wrong token type');
    return p.sub;
  } catch {
    throw new LiveError('Your session expired. Reload the page to rejoin.', 'invalid_credential');
  }
}

function tooMany(retryAfterSeconds) {
  return new LiveError('You are going too fast. Wait a moment and try again.', 'rate_limited', { retryAfterSeconds });
}

export function limitCredentialIssue(ip) {
  const r = getLimiters().credentials.hit(String(ip));
  if (!r.ok) throw tooMany(r.retryAfterSeconds);
}

/** Immutable run identity; undefined keeps legacy deck token compatibility. */
export const participantScope = (target) => target?.code != null ? `session:${target._id}` : undefined;

/**
 * Gate for every audience action, shared by HTTP and sockets.
 * - A credential, when presented, must belong to this presentation and to the participant the
 *   action names, so changing the payload id cannot act as someone else.
 * - Separate sessions always require a run-scoped credential. For legacy decks, an action
 *   without a credential is accepted only while legacy ids are still allowed
 *   (REQUIRE_PARTICIPANT_TOKEN unset), keeping already-open clients working during rollout.
 * - Limits: per participant (answers, nickname changes) and a generous per-IP backstop.
 */
export async function guardAudienceAction({ accessCode, action, token, ip }) {
  const target = await findLiveByCode(accessCode);
  const scope = participantScope(target);
  if (!('participantId' in action)) return; // presenter actions are authorised elsewhere
  if (token) {
    const owner = verifyParticipantToken(token, accessCode, scope);
    if (owner !== action.participantId) {
      throw new LiveError('That action does not belong to this participant.', 'participant_mismatch');
    }
  } else if (scope || process.env.REQUIRE_PARTICIPANT_TOKEN === 'true') {
    throw new LiveError('Reload the page to rejoin this presentation.', 'credential_required');
  }
  const l = getLimiters();
  const ipHit = l.ip.hit(String(ip ?? 'unknown'));
  if (!ipHit.ok) throw tooMany(ipHit.retryAfterSeconds);
  const bucket = action.type === 'participant:identify' ? l.identify : l.answers;
  const hit = bucket.hit(`${accessCode}:${action.participantId}`);
  if (!hit.ok) throw tooMany(hit.retryAfterSeconds);
  return target ? String(target._id) : null;
}
