import { describe, expect, it } from 'vitest'
import { recordingEntityDisplayRange } from '../src/recording-entity-range.js'

describe('entity original-text evidence', () => {
  it('maps Unicode code points after whitespace and background-prefix removal', () => {
    expect(recordingEntityDisplayRange('  (背景音) 🙂武汉  ', '🙂武汉', 9, 11, '武汉')).toEqual({ start: 1, length: 2 })
    expect(recordingEntityDisplayRange('🙂武汉', '🙂武汉', 1, 3, '武汉')).toEqual({ start: 1, length: 2 })
  })
  it('rejects stale, partial, guessed and out-of-bounds evidence', () => {
    for (const [raw, visible, start, end, observed] of [
      ['武汉武汉', '武汉武汉', 0, 2, '北京'], ['武汉', '武汉', 0, 4, '武汉'],
      ['(背景音)武汉', '武汉', 0, 7, '(背景音)武汉'], ['旧武汉', '新武汉', 1, 3, '武汉'],
    ] as const) expect(recordingEntityDisplayRange(raw, visible, start, end, observed)).toBeUndefined()
  })
})
