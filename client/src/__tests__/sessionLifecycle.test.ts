import { describe, expect, it } from 'vitest'
import { endMessage } from '../sessionLifecycle'
describe('end consequences', () => {
  it('states immutable-session consequences', () => {
    expect(endMessage(true)).toContain('cannot be resumed')
    expect(endMessage(true)).toContain('Answers stay')
    expect(endMessage(true)).toContain('join code will close')
  })
  it('distinguishes reusable deck runs', () => {
    expect(endMessage(false)).toContain('same code and existing answers')
    expect(endMessage(false)).not.toContain('cannot be resumed')
  })
})
