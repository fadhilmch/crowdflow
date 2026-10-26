import { z } from 'zod';
import { findLiveByCode, endedByCode, SESSION_ENDED_MESSAGE } from '../lib/liveTarget.js';
import { applyLiveActionByCode, liveActionSchema, publicState, liveChannel } from '../lib/live.js';
import { guardAudienceAction } from '../lib/audience.js';
import { publishState } from '../ably.js';
import { setBroadcaster } from '../lib/broadcast.js';
import { createCoalescer } from '../lib/coalesce.js';
import { logEvent } from '../lib/logEvent.js';

const joinSchema = z.object({ accessCode: z.string().trim().min(1) });

async function sendState(io, accessCode) {
  const presentation = await findLiveByCode(accessCode);
  if (!presentation) return;
  const state = publicState(presentation);
  io.to(liveChannel(accessCode)).emit('presentation:state', state);
  await publishState(accessCode, state);
}

// Connected clients in a room. This is not the number of people who answered:
// the tally already reports unique submitters. Counts sockets on this process only.
function roomSize(io, accessCode) {
  return io.sockets.adapter.rooms.get(liveChannel(accessCode))?.size ?? 0;
}

function emitPresence(io, accessCode) {
  io.to(liveChannel(accessCode)).emit('presence:update', { connected: roomSize(io, accessCode) });
}

/**
 * Live room protocol over Socket.IO (self-hosted transport).
 * One room per access code; mutations persist first, then a fresh snapshot is broadcast.
 */
export function registerPresentationSockets(io) {
  // BROADCAST_COALESCE_MS=0 (default) sends one snapshot per change, as before. A positive value
  // collapses bursts into a leading and a trailing snapshot per room.
  const broadcastState = createCoalescer((accessCode) => sendState(io, accessCode), Number(process.env.BROADCAST_COALESCE_MS ?? 0));
  const broadcastTo = (_io, accessCode) => broadcastState(accessCode);
  setBroadcaster(async (accessCode, terminalState) => {
    // Ended sessions release their code, so they cannot be looked up again.
    if (terminalState) {
      io.to(liveChannel(accessCode)).emit('presentation:state', terminalState);
      await publishState(accessCode, terminalState);
      return;
    }
    return broadcastState(accessCode);
  });
  io.on('connection', (socket) => {
    let joinedCode = null;

    socket.on('presentation:join', async (payload, ack = () => {}) => {
      try {
        const { accessCode } = joinSchema.parse(payload);
        const presentation = await findLiveByCode(accessCode);
        if (!presentation) {
          return ack((await endedByCode(accessCode)) ? { ok: false, message: SESSION_ENDED_MESSAGE, code: 'session_ended' } : { ok: false, message: 'No presentation with that code' });
        }
        const previous = joinedCode;
        if (previous) {
          await socket.leave(liveChannel(previous));
          emitPresence(io, previous);
        }
        joinedCode = accessCode;
        await socket.join(liveChannel(accessCode));
        emitPresence(io, accessCode);
        return ack({ ok: true, state: publicState(presentation), presence: { connected: roomSize(io, accessCode) } });
      } catch (err) {
        return ack({ ok: false, message: err.message });
      }
    });

    socket.on('disconnecting', () => {
      if (joinedCode) {
        const code = joinedCode;
        // The socket is still in the room during 'disconnecting'; report the count without it.
        io.to(liveChannel(code)).emit('presence:update', { connected: Math.max(0, roomSize(io, code) - 1) });
      }
    });

    socket.on('live:action', async (payload, ack = () => {}) => {
      if (!joinedCode) return ack({ ok: false, message: 'Join a presentation first' });
      try {
        const action = liveActionSchema.parse({ type: payload?.type, ...payload });
        const targetId = await guardAudienceAction({ accessCode: joinedCode, action, token: payload?.token, ip: socket.handshake?.address });
        const presentation = await applyLiveActionByCode(joinedCode, action, { targetId });
        if (!presentation) return ack({ ok: false, message: 'Presentation is gone' });
        await broadcastTo(io, joinedCode);
        return ack({ ok: true });
      } catch (err) {
        logEvent('warn', 'live.action.failed', { room: joinedCode, action: payload?.type, code: err.code ?? null, reason: String(err.message).slice(0, 120) });
        return ack({ ok: false, message: err.message, ...(err.code ? { code: err.code } : {}), ...(err.retryAfterSeconds ? { retryAfterSeconds: err.retryAfterSeconds } : {}) });
      }
    });
  });
}
