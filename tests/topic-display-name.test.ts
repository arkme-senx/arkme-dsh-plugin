import { describe, expect, it } from 'vitest'
import { arkmeTopicDisplayName } from '../src/topic-policy.js'

describe('system topic display name', () => {
  it('labels the container by kind, including cached internal titles', () => {
    for (const title of ['DSH Agent Input', 'DSH Agent 输入', 'Archive']) {
      expect(arkmeTopicDisplayName(title, 3)).toBe('发给 DSH 的消息')
    }
  })
  it('preserves ordinary, internal Agent and unknown topic names', () => {
    for (const kind of [undefined, 1, 2, 99]) {
      expect(arkmeTopicDisplayName('DSH Agent Input', kind)).toBe('DSH Agent Input')
      expect(arkmeTopicDisplayName('发给 DSH 的消息', kind)).toBe('发给 DSH 的消息')
    }
  })
})
