import { describe, expect, it } from 'vitest'
import { radioIndex } from '../editor/dialogKeys'
describe('dialog radio keyboard navigation', () => {
  it('wraps in both directions', () => {
    for (const key of ['ArrowRight', 'ArrowDown']) expect(radioIndex(key, 2, 3)).toBe(0)
    for (const key of ['ArrowLeft', 'ArrowUp']) expect(radioIndex(key, 0, 3)).toBe(2)
  })
  it('supports first/last and leaves other keys alone', () => {
    expect(radioIndex('Home', 1, 3)).toBe(0)
    expect(radioIndex('End', 1, 3)).toBe(2)
    expect(radioIndex('Tab', 1, 3)).toBeNull()
    expect(radioIndex('ArrowRight', 0, 0)).toBeNull()
  })
})
