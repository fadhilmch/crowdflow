import { Router } from 'express';
import { findLiveByCode, liveExistsByCode, sendCodeMissing } from '../lib/liveTarget.js';
import { applyLiveActionByCode, liveActionSchema, publicState } from '../lib/live.js';
import { answersFor } from '../lib/answers.js';
import { participantScope, guardAudienceAction, signParticipantToken, verifyParticipantToken, limitCredentialIssue } from '../lib/audience.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createSubscriberToken, publishState, getAblyRest } from '../ably.js';

/**
 * HTTP live endpoints used with the Ably transport (e.g. on serverless hosts
 * where a persistent Socket.IO server is not available).
 */
export const liveRouter = Router();

liveRouter.get('/:accessCode/token', async (req, res, next) => {
  try {
    if (!getAblyRest()) return res.status(501).json({ message: 'Ably transport is not configured' });
    const presentation = await liveExistsByCode(req.params.accessCode);
    if (!presentation) return sendCodeMissing(res, req.params.accessCode);
    const tokenRequest = await createSubscriberToken(req.params.accessCode, req.query.clientId ?? 'anonymous');
    return res.json({ tokenRequest });
  } catch (err) {
    return next(err);
  }
});


liveRouter.get('/:accessCode/state', async (req, res, next) => {
  try {
    const presentation = await findLiveByCode(req.params.accessCode);
    if (!presentation) return sendCodeMissing(res, req.params.accessCode);
    return res.json({ data: publicState(presentation) });
  } catch (err) {
    return next(err);
  }
});

/**
 * Issues an anonymous participant credential for this presentation. It proves "this is the same
 * browser as before", not "this is a unique person": clearing browser storage creates a new one.
 * An existing valid credential is refreshed for the same id. A participant id that predates
 * credentials is accepted once so existing clients keep their answers during rollout.
 */
const credentialBody = z.object({ participantId: z.string().min(6).max(64).optional(), token: z.string().max(2000).optional() });
liveRouter.post('/:accessCode/credential', async (req, res, next) => {
  try {
    limitCredentialIssue(req.ip);
    const { participantId, token } = credentialBody.parse(req.body ?? {});
    const target = await findLiveByCode(req.params.accessCode);
    if (!target) return sendCodeMissing(res, req.params.accessCode);
    let id;
    if (token) {
      try {
        id = verifyParticipantToken(token, req.params.accessCode, participantScope(target));
      } catch {
        id = participantId ?? `p-${randomUUID()}`; // expired: continue as the same browser if it tells us who it was
      }
    } else {
      id = participantId ?? `p-${randomUUID()}`;
    }
    res.set('Cache-Control', 'private, no-store');
    return res.json({ participantId: id, token: signParticipantToken(req.params.accessCode, id, participantScope(target)) });
  } catch (err) {
    if (err.code === 'rate_limited') return res.status(429).set('Retry-After', String(err.retryAfterSeconds)).json({ message: err.message, code: err.code });
    if (err.name === 'ZodError') return res.status(400).json({ message: 'Invalid request' });
    return next(err);
  }
});

/** The caller's own answers, keyed by the anonymous participant id sent in a header (kept out of URLs and logs). */
liveRouter.get('/:accessCode/me', async (req, res, next) => {
  try {
    const presentation = await findLiveByCode(req.params.accessCode);
    if (!presentation) return sendCodeMissing(res, req.params.accessCode);
    let participantId = req.get('x-participant-id');
    const bearer = req.get('x-participant-token');
    if (bearer) participantId = verifyParticipantToken(bearer, req.params.accessCode, participantScope(presentation)); // the credential decides who is asking
    if (!participantId || participantId.length < 6 || participantId.length > 64) {
      return res.status(400).json({ message: 'x-participant-id header is required' });
    }
    if (participantScope(presentation) && !bearer) return res.status(401).json({ message: 'Reload the page to rejoin this presentation.', code: 'credential_required' });
    res.set("Cache-Control", "private, no-store");
    res.vary("x-participant-id");
    res.vary("x-participant-token");
    return res.json({ data: answersFor(presentation, participantId) });
  } catch (err) {
    if (err.code === 'invalid_credential') return res.status(401).json({ message: err.message, code: err.code });
    return next(err);
  }
});

liveRouter.post('/:accessCode/action', async (req, res, next) => {
  try {
    const action = liveActionSchema.parse(req.body);
    const targetId = await guardAudienceAction({ accessCode: req.params.accessCode, action, token: req.get('x-participant-token'), ip: req.ip });
    const presentation = await applyLiveActionByCode(req.params.accessCode, action, { targetId });
    if (!presentation) return sendCodeMissing(res, req.params.accessCode);
    const state = publicState(presentation);
    await publishState(req.params.accessCode, state);
    return res.json({ ok: true, state });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ message: 'Invalid action', issues: err.issues });
    }
    if (err.code === 'rate_limited') {
      return res.status(429).set('Retry-After', String(err.retryAfterSeconds)).json({ message: err.message, code: err.code });
    }
    if (err.code === 'invalid_credential' || err.code === 'credential_required') {
      return res.status(401).json({ message: err.message, code: err.code });
    }
    if (err.code === 'participant_mismatch') return res.status(403).json({ message: err.message, code: err.code });
    if (err.code === 'slide_not_active') {
      // Hand back the fresh state so the client can show what is on screen now.
      const fresh = await findLiveByCode(req.params.accessCode);
      return res.status(409).json({ message: err.message, code: err.code, ...(fresh ? { state: publicState(fresh) } : {}) });
    }
    if (err instanceof RangeError || err instanceof TypeError) {
      return res.status(400).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
    }
    return next(err);
  }
});
