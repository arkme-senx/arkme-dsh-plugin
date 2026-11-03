import { expect, it } from 'vitest'
import { thoughtReplyFromWire } from '../src/thought-reply.js'
import { publicTimelineExtensionSends, type DetailExtensionSend } from '../src/client/detail-extension-send.js'

it('accepts only a bounded versioned snapshot and drops malformed owner data', () => {
  const row = { version:1, kind:'record', thought_id:'thought', record_uid:'root', generation:2, visibility:'user', content:'原始 Arko 答复' }
  expect(thoughtReplyFromWire(row)).toEqual({ thoughtId:'thought', recordUid:'root', generation:2, visibility:'user', content:'原始 Arko 答复' })
  for (const change of [{ version:2 }, { content:'' }, { content:'x'.repeat(131073) }, { generation:0 }, { visibility:'public' }, { kind:'record_uid' }]) expect(thoughtReplyFromWire({...row,...change})).toBeUndefined()
})
it('keeps private pending, uncertain and confirmed replies out of the shared timeline', () => {
  const tasks = [
    { state:'sending', extension:{privateThoughtReply:true} },
    { state:'uncertain', extension:{privateThoughtReply:true} },
    { state:'sent', extension:{}, result:{privateThoughtReply:true} },
    { state:'sent', extension:{thoughtReply:{visibility:'members'}} },
    { state:'sending', extension:{} },
  ] as DetailExtensionSend[]
  expect(publicTimelineExtensionSends(tasks)).toEqual(tasks.slice(3))
})
