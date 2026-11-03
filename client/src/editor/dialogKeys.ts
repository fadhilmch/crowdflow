/** Roving radio selection, wrapping at the ends. Unhandled keys leave selection alone. */
export function radioIndex(key: string, current: number, count: number): number | null {
  if (count < 1) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (['ArrowRight', 'ArrowDown'].includes(key)) return (current + 1) % count
  if (['ArrowLeft', 'ArrowUp'].includes(key)) return (current - 1 + count) % count
  return null
}
