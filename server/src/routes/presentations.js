import { Router } from 'express';
import { mutateWithRetry } from '../lib/occ.js';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Presentation } from '../models/presentation.js';
import { LiveSession } from '../models/liveSession.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { generateUniqueAccessCode } from '../lib/accessCode.js';
import { ensureSlideIds, hasUnidentifiedSlides, matchSlideUpdate, stampSlideIdsIfMissing } from '../lib/slideIdentity.js';
import { presenterActionSchema, applyLiveAction, publicState } from '../lib/live.js';
import { tallySlide } from '../lib/results.js';
import { reportSlides } from '../lib/report.js';
import { summaryCsv, responsesCsv, leaderboardCsv } from '../lib/csvReport.js';
import { templates, templateList } from '../lib/templates.js';
import { randomUUID } from 'node:crypto';
import { MEDIA_PATH } from '../lib/media.js';
import { LAYOUT_TYPES, SLIDE_TYPES } from '../models/presentation.js';
import { TIME_LIMIT_MAX, TIME_LIMIT_MIN } from '../lib/scoring.js';
import { broadcastState } from '../lib/broadcast.js';
import { config } from '../config.js';
import { sendCodeMissing } from '../lib/liveTarget.js';
import { loadModerationQueue, setModerationMode, moderateResponse, moderationActionSchema, moderationModeSchema, ModerationError } from '../lib/moderation.js';

// Options arrive either as legacy plain strings or as { id?, text } objects.
const optionInputSchema = z.union([
  z.string().trim().min(1).max(200),
  z.object({ id: z.string().min(1).max(64).optional(), text: z.string().trim().min(1).max(200) }),
]);

const normalizeOption = (option) => (typeof option === 'string' ? { text: option } : option);

const isAllowedImageUrl = (value) => MEDIA_PATH.test(value) || (/^https:\/\//i.test(value) && z.string().url().safeParse(value).success);

const designInputSchema = z
  .object({
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    // An https link, or an image uploaded through POST /api/media.
    imageUrl: z.string().trim().max(500).refine(isAllowedImageUrl, { message: 'Use an https:// image link or upload an image' }).optional(),
    imageLayout: z.enum(['beside', 'behind']).optional(),
  })
  .optional();

const slideSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    questionType: z.enum(SLIDE_TYPES),
    question: z.string().trim().min(1).max(300),
    timeLimit: z.number().int().min(TIME_LIMIT_MIN).max(TIME_LIMIT_MAX).optional(),
    body: z.string().trim().max(400).optional(),
    columns: z.array(z.object({ title: z.string().trim().max(80).default(''), text: z.string().trim().max(600).default('') })).max(3).optional(),
    options: z.array(optionInputSchema).max(12).default([]),
    correctOptionId: z.string().min(1).max(64).optional(),
    design: designInputSchema,
  })
  .superRefine((slide, ctx) => {
    if (slide.questionType === 'multiple-choice' && slide.options.length < 2) {
      ctx.addIssue({ code: 'custom', message: 'Multiple-choice slides need at least 2 options', path: ['options'] });
    }
    if ((slide.questionType === 'ranking' || slide.questionType === 'quiz') && slide.options.length < 2) {
      ctx.addIssue({ code: 'custom', message: 'Ranking and quiz slides need at least 2 options', path: ['options'] });
    }
    if (slide.timeLimit !== undefined && slide.questionType !== 'quiz') {
      ctx.addIssue({ code: 'custom', message: 'Only quiz questions have a time limit', path: ['timeLimit'] });
    }
    if (slide.questionType === 'image' && !slide.design?.imageUrl) {
      ctx.addIssue({ code: 'custom', message: 'An image slide needs an image', path: ['design'] });
    }
    if (slide.questionType === 'columns' && !(slide.columns?.length >= 2)) {
      ctx.addIssue({ code: 'custom', message: 'A columns slide needs 2 or 3 columns', path: ['columns'] });
    }
    if (LAYOUT_TYPES.includes(slide.questionType) && slide.options.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'Content slides have no answer options', path: ['options'] });
    }
    if (slide.design?.imageLayout && !slide.design?.imageUrl) {
      ctx.addIssue({ code: 'custom', message: 'Image layout only applies when an image is set', path: ['design'] });
    }
  });

const confirmRemoveSchema = z.object({
  votes: z.number().int().min(0),
  responses: z.number().int().min(0),
});

const createSchema = z.object({
  creationKind: z.enum(['quiz', 'presentation', 'blank']).optional(),
  title: z.string().trim().min(1).max(120),
  location: z.string().trim().max(120).optional(),
  theme: z.enum(['iris', 'apricot', 'plum', 'cobalt']).optional(),
  quizScoring: z.enum(['standard', 'speed']).optional(),
  slides: z.array(slideSchema).max(50).default([]),
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  location: z.string().trim().max(120).nullable().optional(),
  theme: z.enum(['iris', 'apricot', 'plum', 'cobalt']).optional(),
  quizScoring: z.enum(['standard', 'speed']).optional(),
  slides: z.array(slideSchema).max(50).optional(),
  currentSlide: z.number().int().min(0).optional(),
  baseStructureRevision: z.number().int().min(0).optional(),
  confirmRemove: confirmRemoveSchema.optional(),
});

export const presentationsRouter = Router();

const codeExists = async (code) =>
  Boolean((await Presentation.exists({ accessCode: code })) || (await LiveSession.exists({ code, status: 'active' })));

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  // Opaque cursor from the previous page: "<createdAt ms>_<id>".
  cursor: z.string().regex(/^\d+_[a-f0-9]{24}$/).optional(),
});

/**
 * Dashboard listing: metadata only, paginated. Slides, answers and voter ids never leave the
 * database here, so the response size depends on the page size and not on collected answers.
 */
presentationsRouter.get('/', authenticate, async (req, res, next) => {
  try {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: 'Invalid paging parameters' });
    const { limit, cursor } = parsed.data;
    const owner = new mongoose.Types.ObjectId(req.auth.userId);
    const match = { owner };
    if (cursor) {
      const [ms, id] = cursor.split('_');
      const at = new Date(Number(ms));
      const oid = new mongoose.Types.ObjectId(id);
      match.$or = [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: oid } }];
    }
    const [rows, total] = await Promise.all([
      Presentation.aggregate([
        { $match: match },
        { $sort: { createdAt: -1, _id: -1 } },
        { $limit: limit + 1 },
        { $project: { title: 1, accessCode: 1, location: 1, theme: 1, createdAt: 1, updatedAt: 1, slideCount: { $size: { $ifNull: ['$slides', []] } } } },
      ]),
      Presentation.countDocuments({ owner }),
    ]);
    const page = rows.slice(0, limit);
    // One bounded owner-only metadata query, never a per-card request or answer payload.
    if (process.env.SESSIONS_ENABLED === 'true' && page.length) {
      const active = await LiveSession.aggregate([
        { $match: { owner, presentation: { $in: page.map((p) => p._id) }, status: 'active' } },
        { $sort: { startedAt: -1, _id: -1 } },
        { $group: { _id: '$presentation', runs: { $push: { id: '$_id', code: '$code', startedAt: '$startedAt' } } } },
      ]);
      const byDeck = new Map(active.map((group) => [String(group._id), group.runs]));
      for (const deck of page) deck.activeSessions = byDeck.get(String(deck._id)) ?? [];
    }
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit && last ? `${new Date(last.createdAt).getTime()}_${last._id}` : null;
    return res.json({ data: page, total, nextCursor });
  } catch (err) {
    return next(err);
  }
});

/** Starter decks. Choose one with POST /from-template/:key. */
presentationsRouter.get('/templates', authenticate, (req, res) => res.json({ data: templateList() }));

presentationsRouter.post('/from-template/:key', authenticate, async (req, res, next) => {
  try {
    const template = templates.find((t) => t.key === req.params.key);
    if (!template) return res.status(404).json({ message: 'No template with that name' });
    const accessCode = await generateUniqueAccessCode(codeExists, config.accessCode);
    const slides = template.slides.map((slide) => {
      const options = slide.options.map((text) => ({ id: randomUUID(), text, votes: [] }));
      return {
        id: randomUUID(),
        questionType: slide.questionType,
        question: slide.question,
        options,
        responses: [],
        ratings: [],
        rankings: [],
        ...(slide.correctIndex !== undefined ? { correctOptionId: options[slide.correctIndex].id } : {}),
      };
    });
    const data = await Presentation.create({ title: template.name, slides, accessCode, owner: req.auth.userId });
    return res.status(201).json({ data });
  } catch (err) {
    return next(err);
  }
});

/**
 * Copies the structure only: fresh deck, slide and option ids, correct answers remapped, design kept.
 * No votes, responses, participants, revealed state or join code are copied.
 */
presentationsRouter.post('/:id/duplicate', authenticate, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Presentation not found' });
    const source = await Presentation.findOne({ _id: req.params.id, owner: req.auth.userId });
    if (!source) return res.status(404).json({ message: 'Presentation not found' });
    const accessCode = await generateUniqueAccessCode(codeExists, config.accessCode);
    const slides = source.slides.map((slide) => {
      const options = slide.options.map((option) => ({ id: randomUUID(), text: option.text, votes: [] }));
      const correctAt = slide.options.findIndex((option) => option.id && option.id === slide.correctOptionId);
      const design = slide.design?.toObject ? slide.design.toObject() : slide.design;
      return {
        id: randomUUID(),
        questionType: slide.questionType,
        question: slide.question,
        options,
        responses: [],
        ratings: [],
        rankings: [],
        revealed: false,
        ...(correctAt >= 0 ? { correctOptionId: options[correctAt].id } : {}),
        ...(design ? { design } : {}),
        ...(slide.timeLimit ? { timeLimit: slide.timeLimit } : {}),
        ...(slide.body ? { body: slide.body } : {}),
        ...(slide.columns?.length ? { columns: slide.columns.map(({ title, text }) => ({ title, text })) } : {}),
      };
    });
    const title = `Copy of ${source.title}`.slice(0, 120);
    const data = await Presentation.create({ title, location: source.location, theme: source.theme, quizScoring: source.quizScoring, slides, accessCode, owner: req.auth.userId });
    return res.status(201).json({ data });
  } catch (err) {
    return next(err);
  }
});

presentationsRouter.post('/', authenticate, validate(createSchema), async (req, res, next) => {
  try {
    const accessCode = await generateUniqueAccessCode(codeExists, config.accessCode);
    const slides = req.body.slides.map((slide) => ({
      ...slide,
      options: slide.options.map(normalizeOption).map((option) => ({ ...option, votes: [] })),
      responses: [],
      ratings: [],
      rankings: [],
    }));
    const data = await Presentation.create({ ...req.body, slides, accessCode, owner: req.auth.userId });
    ensureSlideIds(data);
    await data.save();
    return res.status(201).json({ data });
  } catch (err) {
    return next(err);
  }
});

/** Public join-by-code: audience needs no account. */
presentationsRouter.get('/code/:accessCode', async (req, res, next) => {
  try {
    const data = await Presentation.findOne({ accessCode: req.params.accessCode });
    if (!data) return sendCodeMissing(res, req.params.accessCode);
    return res.json({ data: publicState(data) });
  } catch (err) {
    return next(err);
  }
});

/**
 * Owner-only CSV of the results as they stand now (a snapshot, not a frozen historical report:
 * sessions are not separated from decks yet). kind=summary is aggregate; responses adds open-ended
 * text; leaderboard adds player names and scores and is a deliberate separate choice.
 */
const exporters = { summary: summaryCsv, responses: responsesCsv, leaderboard: leaderboardCsv };
presentationsRouter.get('/:id/export.csv', authenticate, async (req, res, next) => {
  try {
    const kind = String(req.query.kind ?? 'summary');
    if (!Object.hasOwn(exporters, kind)) return res.status(400).json({ message: 'kind must be summary, responses or leaderboard' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Presentation not found' });
    let data = await Presentation.findOne({ _id: req.params.id, owner: req.auth.userId });
    // A run's results export by its session id (sessions on only), ended runs included.
    if (!data && process.env.SESSIONS_ENABLED === 'true') data = await LiveSession.findOne({ _id: req.params.id, owner: req.auth.userId });
    if (!data) return res.status(404).json({ message: 'Presentation not found' });
    const slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'presentation';
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-${kind}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.send(exporters[kind](data));
  } catch (err) {
    return next(err);
  }
});

/**
 * Owner-only JSON report: the same tallies as the live screen and the CSV, for the report view.
 * It is a snapshot of the current results; per-session frozen reports need live sessions (docs/live-sessions.md).
 */
presentationsRouter.get('/:id/report', authenticate, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Presentation not found' });
    const data = await Presentation.findOne({ _id: req.params.id, owner: req.auth.userId });
    if (!data) return res.status(404).json({ message: 'Presentation not found' });
    const slides = reportSlides(data.slides);
    res.set('Cache-Control', 'private, no-store');
    return res.json({ data: { title: data.title, generatedAt: new Date().toISOString(), scope: 'current results of this deck (not separated by session)', slides } });
  } catch (err) {
    return next(err);
  }
});

presentationsRouter.get('/:id', authenticate, async (req, res, next) => {
  try {
    let data = await Presentation.findOne({ _id: req.params.id, owner: req.auth.userId });
    if (!data) return res.status(404).json({ message: 'Presentation not found' });
    // Upgrade-on-read: stamp stable ids onto pre-identity decks. This is purely
    // additive (no votes, responses or structure are touched) and gives the
    // editor real identities to echo back on save. The write is version-guarded:
    // a concurrent change wins, and the winner may be a vote, which stamps
    // nothing - so reload and retry instead of returning an unidentified deck.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await stampSlideIdsIfMissing(data)) break;
      data = await Presentation.findOne({ _id: req.params.id, owner: req.auth.userId });
      if (!data) return res.status(404).json({ message: 'Presentation not found' });
    }
    return res.json({ data });
  } catch (err) {
    return next(err);
  }
});

// One save attempt against the latest stored deck. Returns the HTTP outcome instead of sending it, so a
// lost race (VersionError: an answer was saved first) can reload the deck and run every check again.
async function attemptDeckSave(req) {
  const presentation = await Presentation.findOne({ _id: req.params.id, owner: req.auth.userId });
  if (!presentation) return { status: 404, body: { message: 'Presentation not found' } };
  const { slides, baseStructureRevision, confirmRemove, ...rest } = req.body;
  Object.assign(presentation, rest);
  if (slides) {
    if (hasUnidentifiedSlides(presentation.slides)) {
      // Pre-identity deck: stamp ids additively and ask the client to reload.
      // Never index-match legacy data - that is how votes get misattached.
      // Version-guarded write; on contention the other writer's ids win.
      await stampSlideIdsIfMissing(presentation);
      return {
        status: 409,
        body: { code: 'upgraded', message: 'This presentation was just upgraded for safer editing. Reload it and save again.' },
      };
    }
    const normalized = slides.map((slide) => ({ ...slide, options: slide.options.map(normalizeOption) }));
    // A deck with no stored slides has nothing to attach identities to, so a
    // first save of brand-new slides (no ids yet) is legitimate. Only reject
    // id-less slides when stored slides exist that they could be mismatched with.
    const echoesNoIdentities =
      presentation.slides.length > 0 && normalized.length > 0 && normalized.every((s) => !s.id);
    if (baseStructureRevision === undefined || echoesNoIdentities) {
      // The client is not echoing identities; it may hold stale data. Reject
      // rather than guess: no attachment beats wrong attachment.
      return { status: 409, body: { code: 'stale', message: 'Reload the presentation before saving.' } };
    }
    if (baseStructureRevision !== presentation.structureRevision) {
      return { status: 409, body: { code: 'conflict', message: 'Someone changed these slides elsewhere. Reload before saving.' } };
    }
    const { merged, removedVotes, removedResponses } = matchSlideUpdate(presentation.slides, normalized);
    if (removedVotes > 0 || removedResponses > 0) {
      // Discarding real audience data requires an explicit, count-aware
      // confirmation computed against the current stored document. Counts
      // that went stale (new votes meanwhile) fail this check.
      if (!confirmRemove || confirmRemove.votes !== removedVotes || confirmRemove.responses !== removedResponses) {
        return {
          status: 409,
          body: {
            code: 'requiresConfirmation',
            message: 'Saving removes slides or options that already have audience results.',
            removedVotes,
            removedResponses,
          },
        };
      }
    }
    const currentSlideId = presentation.slides[presentation.currentSlide]?.id;
    presentation.slides = merged;
    if (currentSlideId) {
      const nextIndex = merged.findIndex((s) => s.id === currentSlideId);
      presentation.currentSlide = nextIndex >= 0 ? nextIndex : Math.max(0, merged.length - 1);
    } else if (presentation.currentSlide >= merged.length) {
      presentation.currentSlide = Math.max(0, merged.length - 1);
    }
    presentation.structureRevision += 1;
  }
  const data = await presentation.save();
  return { status: 200, body: { data } };
}

/**
 * Saving slides while an audience votes: an answer saved between our read and our write makes the save
 * lose the race (VersionError). The edit is not lost: reload the latest deck (with the new votes) and apply
 * the same edit again, so the presenter's changes and the audience's votes both survive. Every check
 * (structure revision, removal confirmation) re-runs against the fresh deck, so a real conflict still stops.
 */
presentationsRouter.put('/:id', authenticate, validate(updateSchema), async (req, res, next) => {
  try {
    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const { status, body } = await attemptDeckSave(req);
        return res.status(status).json(body);
      } catch (err) {
        if (err.name !== 'VersionError' || attempt === maxAttempts - 1) throw err;
        await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 30 * (attempt + 1)));
      }
    }
    return undefined;
  } catch (err) {
    return next(err);
  }
});

/**
 * Presenter-only live controls (vote reset, open/close voting, hide/reveal
 * results). Authenticated + owner-scoped, unlike the public live channels.
 */
presentationsRouter.post('/:id/live-actions', authenticate, async (req, res, next) => {
  try {
    const action = presenterActionSchema.parse(req.body);
    const load = async () => {
      let presentation = await Presentation.findOne({ _id: req.params.id, owner: req.auth.userId });
      // With sessions on, the presenter screen addresses a run by the id in its state (a session id).
      if (!presentation && process.env.SESSIONS_ENABLED === 'true' && mongoose.isValidObjectId(req.params.id)) {
        presentation = await LiveSession.findOne({ _id: req.params.id, owner: req.auth.userId, status: 'active' });
      }
      return presentation;
    };
    // Retries when an answer was saved in between, so a presenter control never fails or overwrites votes.
    const outcome = await mutateWithRetry(load, (presentation) => applyLiveAction(presentation, action));
    if (!outcome) return res.status(404).json({ message: 'Presentation not found' });
    const data = outcome.doc;
    const state = publicState(data);
    await broadcastState(data.accessCode, state);
    return res.json({ ok: true, state });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ message: 'Invalid action', issues: err.issues });
    if (err instanceof RangeError || err instanceof TypeError) return res.status(400).json({ message: err.message });
    return next(err);
  }
});

/**
 * Moderation of open-ended responses and word-cloud words. Owner-scoped; audience credentials
 * never reach these routes. Every change is saved, then pushed to both live transports.
 */
function moderationError(err, res, next) {
  if (err.name === 'ZodError') return res.status(400).json({ message: 'Invalid request' });
  if (err instanceof ModerationError) return res.status(err.status).json({ message: err.message });
  return next(err);
}

presentationsRouter.get('/:id/moderation', authenticate, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    return res.json({ data: await loadModerationQueue(req.params.id, req.auth.userId) });
  } catch (err) {
    return moderationError(err, res, next);
  }
});

presentationsRouter.post('/:id/moderation/mode', authenticate, async (req, res, next) => {
  try {
    const { mode } = moderationModeSchema.parse(req.body);
    const { presentation } = await setModerationMode(req.params.id, req.auth.userId, mode);
    await broadcastState(presentation.accessCode, publicState(presentation));
    return res.json({ data: await loadModerationQueue(req.params.id, req.auth.userId), state: publicState(presentation) });
  } catch (err) {
    return moderationError(err, res, next);
  }
});

presentationsRouter.post('/:id/moderation/:slideId/:responseId', authenticate, async (req, res, next) => {
  try {
    const { action } = moderationActionSchema.parse(req.body);
    const { presentation } = await moderateResponse(req.params.id, req.auth.userId, { slideId: req.params.slideId, responseId: req.params.responseId, action });
    const state = publicState(presentation);
    await broadcastState(presentation.accessCode, state);
    return res.json({ data: await loadModerationQueue(req.params.id, req.auth.userId), state });
  } catch (err) {
    return moderationError(err, res, next);
  }
});

presentationsRouter.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const data = await Presentation.findOneAndDelete({ _id: req.params.id, owner: req.auth.userId });
    if (!data) return res.status(404).json({ message: 'Presentation not found' });
    return res.json({ data });
  } catch (err) {
    return next(err);
  }
});
