import mongoose from 'mongoose';

const optionSchema = new mongoose.Schema(
  {
    // Stable identity stamped on save; lets edits keep votes attached to the right option.
    id: { type: String },
    text: { type: String, required: true, trim: true, maxlength: 200 },
    votes: { type: [String], default: [] },
  },
  { _id: false },
);

const responseSchema = new mongoose.Schema(
  {
    // Stable identity so moderation and upvotes address one response even as the list changes.
    id: { type: String },
    // Cleared when a presenter deletes the response (the slot stays so stored positions never shift).
    text: { type: String, required: function requiredUnlessDeleted() { return this.status !== 'deleted'; }, trim: true, maxlength: 280 },
    // Moderation state. A missing value means 'visible' (all data from before moderation).
    status: { type: String, enum: ['visible', 'pending', 'hidden', 'deleted'], default: 'visible' },
    authorId: { type: String, required: true },
    // Client-chosen id of the send, so a retry after a lost acknowledgment is not stored twice.
    clientId: { type: String },
    upvotes: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const ratingSchema = new mongoose.Schema(
  {
    authorId: { type: String, required: true },
    value: { type: Number, required: true, min: 1, max: 10 },
  },
  { _id: false },
);

const rankingSchema = new mongoose.Schema(
  {
    authorId: { type: String, required: true },
    // Option ids in the participant's chosen order, best first.
    order: { type: [String], default: [] },
  },
  { _id: false },
);

// Milliseconds a player took to answer a timed or speed-scored quiz question (latest answer).
// Never sent to clients.
const answerTimeSchema = new mongoose.Schema(
  {
    participantId: { type: String, required: true },
    ms: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

// One text block of a columns slide.
const columnSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 80 },
    text: { type: String, trim: true, maxlength: 600 },
  },
  { _id: false },
);

export const SLIDE_TYPES = ['multiple-choice', 'open-ended', 'word-cloud', 'rating', 'ranking', 'quiz', 'title', 'columns', 'image'];
/** Layout slides show content only: nothing to answer, no tally, no moderation. */
export const LAYOUT_TYPES = ['title', 'columns', 'image'];
export const isLayoutSlide = (slide) => LAYOUT_TYPES.includes(slide?.questionType);

const designSchema = new mongoose.Schema(
  {
    // Optional per-slide accent; inherits the presentation theme when unset.
    accent: { type: String, match: /^#[0-9a-fA-F]{6}$/ },
    imageUrl: { type: String, trim: true, maxlength: 500 },
    imageLayout: { type: String, enum: ['beside', 'behind'] },
  },
  { _id: false },
);

export const slideSchema = new mongoose.Schema(
  {
    // Stable identity stamped on save; lets edits keep votes/responses attached to the right slide.
    id: { type: String },
    questionType: {
      type: String,
      enum: SLIDE_TYPES,
      required: true,
    },
    question: { type: String, required: true, trim: true, maxlength: 300 },
    options: { type: [optionSchema], default: [] },
    responses: { type: [responseSchema], default: [] },
    ratings: { type: [ratingSchema], default: [] },
    rankings: { type: [rankingSchema], default: [] },
    // Quiz slides mark the correct option by its stable option id.
    correctOptionId: { type: String },
    // Set when the quiz answer has been shown to the audience. Locks voting on
    // this question permanently (until a presenter vote reset): nobody can
    // change an answer they have already seen revealed.
    revealed: { type: Boolean, default: false },
    design: { type: designSchema, default: undefined },
    // Quiz only: seconds the audience has to answer. Unset means no limit.
    timeLimit: { type: Number, min: 5, max: 300 },
    answerTimes: { type: [answerTimeSchema], default: [] },
    // Layout slides: a subtitle (title slide) and up to three text columns (columns slide).
    body: { type: String, trim: true, maxlength: 400 },
    columns: { type: [columnSchema], default: undefined },
  },
  { _id: false },
);

export const participantSchema = new mongoose.Schema(
  {
    participantId: { type: String, required: true },
    nickname: { type: String, trim: true, maxlength: 24 },
  },
  { _id: false },
);

const presentationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    // Creation intent is metadata, not an unsaved slide edit. Older decks omit it.
    creationKind: { type: String, enum: ['quiz', 'presentation', 'blank'] },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    accessCode: { type: String, required: true, unique: true, index: true },
    location: { type: String, trim: true, maxlength: 120 },
    theme: { type: String, enum: ['iris', 'apricot', 'plum', 'cobalt'], default: 'iris' },
    slides: { type: [slideSchema], default: [] },
    // Leaderboard names: optional nickname per stable anonymous participant id.
    participants: { type: [participantSchema], default: [] },
    // 'off' shows new responses at once (the default). 'approve' holds them until the owner approves.
    moderationMode: { type: String, enum: ['off', 'approve'], default: 'off' },
    // Owner, action and time only. Never the response text.
    moderationLog: {
      type: [
        new mongoose.Schema(
          { owner: { type: String, required: true }, action: { type: String, required: true }, slideId: { type: String }, responseId: { type: String }, at: { type: Date, default: Date.now } },
          { _id: false },
        ),
      ],
      default: [],
    },
    // 'standard' (1 point per correct answer) or 'speed' (faster correct answers score more).
    quizScoring: { type: String, enum: ['standard', 'speed'], default: 'standard' },
    // When the question on screen started counting. Set by the presenter (timer:start) or on a slide change.
    questionStartedAt: { type: Date },
    // The presenter is showing the winners' podium.
    finale: { type: Boolean, default: false },
    currentSlide: { type: Number, default: 0, min: 0 },
    votingOpen: { type: Boolean, default: true },
    endedAt: { type: Date, default: null },
    resultsVisible: { type: Boolean, default: true },
    // Bumped only when the slide/option structure changes. Votes and live
    // actions do not touch it, so the editor can detect concurrent structural
    // edits without conflicting with live audience activity.
    structureRevision: { type: Number, default: 0 },
    // Bumped on every successful change to the live state (answers, slide, voting, resets).
    // Clients use it to ignore a snapshot that arrives after a newer one.
    liveRevision: { type: Number, default: 0 },
  },
  { timestamps: true, optimisticConcurrency: true },
);

// Atomic $inc, so two writers cannot both stamp the same stale value + 1.
presentationSchema.pre('save', function bumpLiveRevision() {
  if (!this.isNew && this.isModified()) this.$inc('liveRevision', 1);
});

export const Presentation = mongoose.model('Presentation', presentationSchema);
