export type SlideType = 'multiple-choice' | 'open-ended' | 'word-cloud' | 'rating' | 'ranking' | 'quiz' | 'title' | 'columns' | 'image';

/** Layout slides show content only: nothing to answer. */
export const LAYOUT_TYPES: SlideType[] = ['title', 'columns', 'image'];
export const isLayoutType = (type: SlideType): boolean => LAYOUT_TYPES.includes(type);

export interface SlideColumn {
  title: string;
  text: string;
}

export interface SlideDesign {
  accent?: string;
  imageUrl?: string;
  imageLayout?: 'beside' | 'behind';
}

export interface Tally {
  total: number;
  // multiple-choice + quiz
  counts?: number[];
  percentages?: number[];
  // quiz
  correctOptionIndex?: number;
  correctCount?: number;
  // word-cloud
  words?: { text: string; count: number }[];
  // rating
  average?: number;
  buckets?: number[];
  // ranking
  points?: number[];
}

export interface RankingOption {
  id: string;
  text: string;
}

export interface PublicSlide {
  questionType: SlideType;
  question: string;
  options?: string[] | RankingOption[];
  design?: SlideDesign;
  /** Quiz only: seconds to answer. */
  timeLimit?: number;
  /** Title slide subtitle. */
  body?: string;
  /** Columns slide text blocks. */
  columns?: SlideColumn[];
  tally?: Tally | null;
  responses?: { id?: string; index: number; text: string; upvotes: number; createdAt: string }[];
}

export interface LeaderboardEntry {
  /** Opaque per-room player label; unlike `name` it is unique. */
  key: string;
  name: string;
  score: number;
  rank: number;
}

export interface PresentationState {
  /** Separate immutable run: ending releases its join code and cannot be resumed. */
  session?: boolean;
  id: string;
  title: string;
  accessCode: string;
  /** Increases with every change to the live state; older snapshots are ignored. */
  revision?: number;
  theme?: 'iris' | 'apricot' | 'plum' | 'cobalt';
  currentSlide: number;
  votingOpen: boolean;
  resultsVisible: boolean;
  /** Persisted by the presenter, distinct from closing voting for one slide. */
  ended?: boolean;
  /** 'approve' when the presenter holds new responses until approved. */
  moderation?: 'off' | 'approve';
  /** Quiz points: 1 per correct answer, or more for faster correct answers. */
  quizScoring?: 'standard' | 'speed';
  /** The presenter is showing the winners' podium. */
  finale?: boolean;
  /** Countdown for the timed quiz question on screen. Times are epoch ms; `endsAt` is null until it starts. */
  timer?: { durationSec: number; endsAt: number | null; serverNow: number } | null;
  slides: PublicSlide[];
  // Quiz scores: only sent after voting closes and results are visible.
  leaderboard?: LeaderboardEntry[] | null;
}

export type LiveAction =
  | { type: 'vote:cast'; slideIndex: number; optionIndex: number; participantId: string }
  | { type: 'response:add'; slideIndex: number; text: string; participantId: string; clientId?: string }
  | { type: 'response:upvote'; slideIndex: number; responseIndex?: number; responseId?: string; participantId: string; on?: boolean }
  | { type: 'word:submit'; slideIndex: number; text: string; participantId: string }
  | { type: 'rating:cast'; slideIndex: number; value: number; participantId: string }
  | { type: 'ranking:submit'; slideIndex: number; order: string[]; participantId: string }
  | { type: 'participant:identify'; participantId: string; nickname: string };

export type ConnectionState = 'connected' | 'reconnecting' | 'offline';

export interface LiveTransport {
  join(accessCode: string): Promise<PresentationState>;
  send(action: LiveAction): Promise<void>;
  onState(handler: (state: PresentationState) => void): void;
  /** Optional: called after a dropped connection is re-established and the room is rejoined. */
  onReconnect?(handler: () => void): void;
  /** Connected-client count for the room. Only the Socket.IO transport has it (one server process). */
  onPresence?(handler: (connected: number) => void): void;
  /** Optional: reports connected / reconnecting / offline the same way for every transport. */
  onConnection?(handler: (state: ConnectionState) => void): void;
  leave(): void;
}
