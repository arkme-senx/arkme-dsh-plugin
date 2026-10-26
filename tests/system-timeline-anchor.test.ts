import { expect, it } from 'vitest'
import { systemTimelineAnchorCodec, validateSystemTimelineAnchor } from '../src/services/system-timeline-anchor.js'
import { TimelineTokenCodec } from '../src/services/timeline-token.js'
it('accepts only canonical system sources and authenticated purpose-scoped references', () => {
 const codec = systemTimelineAnchorCodec('key', 'test', 1, 'chat')
 for (const source of ['group_metadata', 'member_left', 'ai_polish']) {
  const ref = codec.seal(source, 'exact-id')
  expect(codec.open(ref)).toEqual({ anchor_source: source, anchor_id: 'exact-id' })
  expect(() => codec.open(ref.slice(0, -3))).toThrow()
 }
 for (const source of ['messages', 'world_public', 'offline_context', '', null]) expect(() => validateSystemTimelineAnchor(source, 'id')).toThrow()
 for (const id of ['', 'x'.repeat(1025), null, 123]) expect(() => validateSystemTimelineAnchor('group_metadata', id)).toThrow()
 const token = new TimelineTokenCodec('key', JSON.stringify(['test', 1, 'chat'])).seal(JSON.stringify(['group_metadata', 'id']), 'cursor')
 expect(() => codec.open(token)).toThrow()
})
