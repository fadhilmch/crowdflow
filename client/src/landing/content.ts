/** Static copy for the landing page. Keep claims limited to what the app does. */

export interface Step {
  title: string
  text: string
}

export interface QuestionType {
  name: string
  text: string
  /** Glyph shown in the colored tile. */
  glyph: string
  color: string
}

export const STEPS: Step[] = [
  { title: 'Build your slides', text: 'Mix questions and content slides. Pick a theme.' },
  { title: 'Share the code', text: 'Show a 6-digit code or QR. People join on their phones.' },
  { title: 'Present live', text: 'Choose the pace, close voting and reveal results.' },
]

export const QUESTION_TYPES: QuestionType[] = [
  { name: 'Multiple choice', text: 'Live bars as votes come in', glyph: '▮', color: '#5757db' },
  { name: 'Quiz', text: 'Correct answer and leaderboard', glyph: '?', color: '#f12f83' },
  { name: 'Word cloud', text: 'One word per person', glyph: 'Aa', color: '#ffb224' },
  { name: 'Rating', text: '1 to 10 with an average', glyph: '★', color: '#30a46c' },
  { name: 'Ranking', text: 'Tap options in order', glyph: '≡', color: '#7878e8' },
  { name: 'Open question', text: 'Answers people can upvote', glyph: '…', color: '#e5484d' },
]
