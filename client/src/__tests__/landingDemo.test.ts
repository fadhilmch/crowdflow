import { describe, expect, it } from 'vitest'
import { DEMO_KINDS, demoAnswer, demoRows } from '../landing/demo'

describe('browser-only landing demo', () => {
  it('uses honest totals in all three samples', () => {
    for (const { id } of DEMO_KINDS) {
      const before = demoRows(id, null)
      const after = demoRows(id, 1)
      expect(after.reduce((sum, row) => sum + row.count, 0)).toBe(before.reduce((sum, row) => sum + row.count, 0) + 1)
      expect(after[1].count).toBe(before[1].count + 1)
    }
  })
  it('poll choices replace the visitor answer instead of creating fake extra people', () => {
    const selected = demoAnswer('poll', 0, 2, true, false)
    expect(selected).toBe(2)
    expect(demoRows('poll', selected).map(row => row.count)).toEqual([12, 8, 7])
  })
  it('a quiz locks the first answer until reset', () => {
    expect(demoAnswer('quiz', 0, 2, true, false)).toBe(0)
    expect(demoAnswer('quiz', null, 2, true, true)).toBeNull()
  })
  it('closed voting and invalid answer indexes never change a sample', () => {
    expect(demoAnswer('poll', 1, 0, false, false)).toBe(1)
    for (const i of [-1, 3, 0.5, NaN]) expect(demoAnswer('poll', null, i, true, false)).toBeNull()
  })
})
