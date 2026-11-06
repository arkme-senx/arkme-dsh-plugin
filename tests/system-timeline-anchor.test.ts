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

it('binds team system anchors to the selected admission frame',()=>{
 const team=systemTimelineAnchorCodec('key','test',1,'chat','team42-admission2')
 const ref=team.seal('team_membership','team-group:event')
 expect(team.open(ref)).toEqual({anchor_source:'team_membership',anchor_id:'team-group:event'})
 for(const other of [undefined,'team43-admission2','team42-admission3']) expect(()=>systemTimelineAnchorCodec('key','test',1,'chat',other).open(ref)).toThrow()
})
