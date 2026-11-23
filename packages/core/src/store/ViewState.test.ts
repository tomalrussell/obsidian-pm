import { describe, expect, it } from 'vitest'
import { sameValue } from './ViewState'

describe('sameValue', () => {
  it('compares objects independent of key order while preserving array order', () => {
    expect(sameValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true)
    expect(sameValue([1, 2], [2, 1])).toBe(false)
  })
})
