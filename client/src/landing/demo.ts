/** A deterministic, browser-only sample. Never creates a room or sends answers. */
export type DemoKind = 'poll' | 'word-cloud' | 'quiz'
export const DEMO_KINDS: { id: DemoKind; label: string }[] = [
  { id: 'poll', label: 'Poll' }, { id: 'word-cloud', label: 'Word cloud' }, { id: 'quiz', label: 'Quiz' },
]
export const DEMO = {
  poll: { question: 'What should we focus on next?', options: ['Product quality', 'New features', 'Performance'], counts: [12, 8, 6] },
  'word-cloud': { question: 'One word for a great team?', options: ['Curious', 'Kind', 'Bold'], counts: [4, 3, 2] },
  quiz: { question: 'Which planet is closest to the Sun?', options: ['Mercury', 'Venus', 'Mars'], counts: [9, 5, 2] },
} as const
export const QUIZ_CORRECT = 0
export function demoRows(kind: DemoKind, selected: number | null) {
  const sample = DEMO[kind]
  const counts = sample.counts.map((n, i) => n + (i === selected ? 1 : 0))
  const total = counts.reduce((sum, n) => sum + n, 0)
  return sample.options.map((label, i) => ({ label, count: counts[i], percent: Math.round(counts[i] / total * 100) }))
}
export function demoAnswer(kind: DemoKind, selected: number | null, index: number, open: boolean, revealed: boolean) {
  if (!open || (kind === 'quiz' && (selected !== null || revealed)) || !Number.isInteger(index) || index < 0 || index >= DEMO[kind].options.length) return selected
  return index
}
