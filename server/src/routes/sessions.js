import { Router } from 'express';
import { mutateWithRetry } from '../lib/occ.js';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Presentation } from '../models/presentation.js';
import { LiveSession } from '../models/liveSession.js';
import { authenticate } from '../middleware/authenticate.js';
import { generateUniqueAccessCode } from '../lib/accessCode.js';
import { config } from '../config.js';
import { presenterActionSchema, applyLiveAction, publicState } from '../lib/live.js';
import { reportSlides } from '../lib/report.js';
import { broadcastState } from '../lib/broadcast.js';

/**
 * Owner session lifecycle. Mounted only when SESSIONS_ENABLED=true (see app.js), so production
 * behaviour is unchanged until the owner turns it on, after running the migration.
 *
 * These routes manage sessions only. Audience answers still go to the deck until live actions are
 * pointed at sessions, which is the next step in docs/live-sessions.md.
 */
export const sessionsRouter = Router();

const codeExists = async (code) =>
  Boolean((await Presentation.exists({ accessCode: code })) || (await LiveSession.exists({ code, status: 'active' })));

const blankSlides = (slides) =>
  slides.map((slide) => {
    const options = (slide.options ?? []).map((o) => ({ id: randomUUID(), text: o.text, votes: [] }));
    const correctAt = (slide.options ?? []).findIndex((o) => o.id && o.id === slide.correctOptionId);
    const design = slide.design?.toObject ? slide.design.toObject() : slide.design;
    return {
      id: slide.id ?? randomUUID(),
      questionType: slide.questionType,
      question: slide.question,
      options,
      responses: [],
      ratings: [],
      rankings: [],
      revealed: false,
      ...(correctAt >= 0 ? { correctOptionId: options[correctAt].id } : {}),
      ...(design ? { design } : {}),
      ...(slide.timeLimit != null ? { timeLimit: slide.timeLimit } : {}),
      ...(slide.body != null ? { body: slide.body } : {}),
      ...(slide.columns ? { columns: slide.columns.map(({ title, text }) => ({ title, text })) } : {}),
    };
  });

const summary = (s) => ({
  id: s._id, presentation: s.presentation, title: s.title, code: s.code, status: s.status,
  startedAt: s.startedAt, endedAt: s.endedAt ?? null, slideCount: s.slides.length,
});

async function ownedSession(req) {
  if (!mongoose.isValidObjectId(req.params.sid)) return null;
  return LiveSession.findOne({ _id: req.params.sid, owner: req.auth.userId });
}

// Start a session for a deck (also "run it again": every start is a new session with a new code and no answers).
sessionsRouter.post('/presentations/:id/sessions', authenticate, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Presentation not found' });
    const deck = await Presentation.findOne({ _id: req.params.id, owner: req.auth.userId });
    if (!deck) return res.status(404).json({ message: 'Presentation not found' });
    const code = await generateUniqueAccessCode(codeExists, config.accessCode);
    const session = await LiveSession.create({
      owner: req.auth.userId,
      presentation: deck._id,
      deckRevision: deck.structureRevision ?? 0,
      title: deck.title,
      theme: deck.theme,
      quizScoring: deck.quizScoring,
      slides: blankSlides(deck.slides),
      moderationMode: deck.moderationMode ?? 'off',
      code,
    });
    return res.status(201).json({ data: summary(session) });
  } catch (err) {
    return next(err);
  }
});

sessionsRouter.get('/presentations/:id/sessions', authenticate, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Presentation not found' });
    const sessions = await LiveSession.find({ presentation: req.params.id, owner: req.auth.userId }).sort({ startedAt: -1 }).limit(100);
    return res.json({ data: sessions.map(summary) });
  } catch (err) {
    return next(err);
  }
});

// End: stops accepting the join code (the unique code index only covers active sessions).
sessionsRouter.post('/sessions/:sid/end', authenticate, async (req, res, next) => {
  try {
    const outcome = await mutateWithRetry(() => ownedSession(req), (s) => {
      if (s.status !== 'active') return false;
      applyLiveAction(s, { type: 'presentation:end' });
      return true;
    });
    if (!outcome) return res.status(404).json({ message: 'Session not found' });
    const s = outcome.doc;
    if (outcome.result) await broadcastState(s.code, publicState(s));
    return res.json({ data: summary(s) });
  } catch (err) {
    return next(err);
  }
});

sessionsRouter.post('/sessions/:sid/archive', authenticate, async (req, res, next) => {
  try {
    const outcome = await mutateWithRetry(() => ownedSession(req), (s) => {
      if (s.status === 'active') throw Object.assign(new Error('End the session before archiving it'), { status: 409 });
      s.status = 'archived';
    });
    if (!outcome) return res.status(404).json({ message: 'Session not found' });
    const s = outcome.doc;
    return res.json({ data: summary(s) });
  } catch (err) {
    return next(err);
  }
});

// Delete removes the session and its answers for good. Active sessions must be ended first.
sessionsRouter.delete('/sessions/:sid', authenticate, async (req, res, next) => {
  try {
    const s = await ownedSession(req);
    if (!s) return res.status(404).json({ message: 'Session not found' });
    if (s.status === 'active') return res.status(409).json({ message: 'End the session before deleting it' });
    await s.deleteOne();
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

// Presenter controls for one session (slide, voting, results, resets), same actions as the deck route.
sessionsRouter.post('/sessions/:sid/live-actions', authenticate, async (req, res, next) => {
  try {
    const action = presenterActionSchema.parse(req.body);
    const outcome = await mutateWithRetry(() => ownedSession(req), (s) => {
      if (s.status !== 'active') throw Object.assign(new Error('This session has ended'), { status: 409 });
      applyLiveAction(s, action);
    });
    if (!outcome) return res.status(404).json({ message: 'Session not found' });
    const data = outcome.doc;
    const state = publicState(data);
    await broadcastState(data.code, state);
    return res.json({ ok: true, state });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ message: 'Invalid action', issues: err.issues });
    if (err instanceof RangeError || err instanceof TypeError) return res.status(400).json({ message: err.message });
    return next(err);
  }
});

// Current results of a session (owner only). Frozen once it has ended.
sessionsRouter.get('/sessions/:sid/state', authenticate, async (req, res, next) => {
  try {
    const s = await ownedSession(req);
    if (!s) return res.status(404).json({ message: 'Session not found' });
    return res.json({ data: publicState(s), status: s.status });
  } catch (err) {
    return next(err);
  }
});

/**
 * Report for one run. While the run is active it is live; once ended it is final (the run no longer
 * accepts answers), and generatedAt/endedAt say when. Separate from the deck and from other runs.
 */
sessionsRouter.get('/sessions/:sid/report', authenticate, async (req, res, next) => {
  try {
    const s = await ownedSession(req);
    if (!s) return res.status(404).json({ message: 'Session not found' });
    res.set('Cache-Control', 'private, no-store');
    return res.json({
      data: {
        title: s.title,
        generatedAt: new Date().toISOString(),
        scope: s.status === 'active' ? 'this session so far (still running)' : 'this session, final (ended and no longer accepting answers)',
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt ?? null,
        slides: reportSlides(s.slides),
      },
    });
  } catch (err) {
    return next(err);
  }
});
