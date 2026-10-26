import { Presentation } from '../models/presentation.js';
import { LiveSession } from '../models/liveSession.js';

/**
 * Turns each existing deck's current live state into one "legacy" session that keeps its join
 * code, votes, response ids, reveal locks, participants and owner. The deck itself is not
 * changed, so rolling back means ignoring the new collection.
 *
 * Safe to repeat: legacySessionFor() inserts only when no session exists for that deck
 * (unique legacyOf index), so a second run, or two runs at once, create no duplicates.
 * Dry run is the default and writes nothing.
 */
export function legacySessionFor(presentation) {
  const doc = typeof presentation.toObject === 'function' ? presentation.toObject() : presentation;
  return {
    owner: doc.owner,
    presentation: doc._id,
    deckRevision: doc.structureRevision ?? 0,
    title: doc.title,
    theme: doc.theme,
    slides: doc.slides,
    participants: doc.participants ?? [],
    code: doc.accessCode,
    status: doc.endedAt ? 'ended' : 'active',
    endedAt: doc.endedAt ?? undefined,
    quizScoring: doc.quizScoring ?? 'standard',
    questionStartedAt: doc.questionStartedAt,
    finale: doc.finale ?? false,
    startedAt: doc.createdAt ?? new Date(),
    currentSlide: doc.currentSlide ?? 0,
    votingOpen: doc.votingOpen !== false,
    resultsVisible: doc.resultsVisible !== false,
    moderationMode: doc.moderationMode ?? 'off',
    moderationLog: doc.moderationLog ?? [],
    liveRevision: doc.liveRevision ?? 0,
    legacyOf: doc._id,
  };
}

export async function migrateLegacySessions({ apply = false, batchSize = 200 } = {}) {
  const report = { apply, decks: 0, alreadyMigrated: 0, wouldCreate: 0, created: 0, errors: [] };
  const cursor = Presentation.find({}).sort({ _id: 1 }).batchSize(batchSize).cursor();
  for await (const presentation of cursor) {
    report.decks += 1;
    if (await LiveSession.exists({ legacyOf: presentation._id })) {
      report.alreadyMigrated += 1;
      continue;
    }
    if (!apply) {
      report.wouldCreate += 1;
      continue;
    }
    try {
      const result = await LiveSession.updateOne({ legacyOf: presentation._id }, { $setOnInsert: legacySessionFor(presentation) }, { upsert: true });
      if (result.upsertedCount) report.created += 1;
      else report.alreadyMigrated += 1;
    } catch (err) {
      // A lost race on the unique index means another run created it: fine.
      if (err.code === 11000) report.alreadyMigrated += 1;
      else report.errors.push({ presentation: String(presentation._id), message: err.message });
    }
  }
  return report;
}
