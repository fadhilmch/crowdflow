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
  { title: 'Build your slides', text: 'Add questions in the editor and pick a color theme for your stage and audience screens.' },
  { title: 'Share the code', text: 'Put the 6-digit join code on screen. People type it in at the CrowdFlow address on any phone.' },
  { title: 'Present live', text: 'Move through slides, close voting, reveal answers and watch bars, words and scores update in real time.' },
]

export const QUESTION_TYPES: QuestionType[] = [
  { name: 'Multiple choice', text: 'Live bars as votes come in', glyph: '▮', color: '#5757db' },
  { name: 'Quiz', text: 'Correct answer and leaderboard', glyph: '?', color: '#f12f83' },
  { name: 'Word cloud', text: 'One word per person', glyph: 'Aa', color: '#ffb224' },
  { name: 'Rating', text: '1 to 10 with an average', glyph: '★', color: '#30a46c' },
  { name: 'Ranking', text: 'Tap options in order', glyph: '≡', color: '#7878e8' },
  { name: 'Open question', text: 'Answers people can upvote', glyph: '…', color: '#e5484d' },
]
