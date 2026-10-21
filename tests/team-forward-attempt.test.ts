import {expect,it,vi} from 'vitest'
import {TeamForwardAttempt} from '../src/client/team-forward-attempt.js'
import type {TeamForwardInput} from '../src/team-message-contract.js'
import type {ArkmeSourceSendResult} from '../src/types.js'

const signal=()=>new AbortController().signal
const target={kind:'source' as const,sourceRef:'target'}
const receipt:ArkmeSourceSendResult={sourceRef:'target',itemUid:'accepted',localState:'synced',status:1}
const selections=[{messageRef:'selected',version:3}]
const sender=()=>vi.fn<(input:TeamForwardInput,signal:AbortSignal)=>Promise<ArkmeSourceSendResult>>()

it('retries the original command after unknown outcome and only rotates the target capability',async()=>{
 const send=sender().mockRejectedValueOnce(new Error('response lost')).mockResolvedValue(receipt)
 const selected=selections.map(item=>({...item}))
 const attempt=new TeamForwardAttempt('source',selected,send)
 selected[0]!.version=99;selected.push({messageRef:'unselected',version:1})
 await expect(attempt.send('a',target,' 原附言 ',signal())).rejects.toThrow('response lost')
 await attempt.send('a',{...target,sourceRef:'rotated'},'新附言',signal())
 const initial=send.mock.calls[0]![0]
 expect(initial.selections).toEqual(selections)
 expect(initial.commentText).toBe('原附言')
 expect(send.mock.calls[1]![0]).toEqual({...initial,target:{...target,sourceRef:'rotated'}})
 expect(new Set([initial.requestId,initial.recordUid,initial.commentRecordUid]).size).toBe(3)
 expect(initial.sendAtMillis).toBeGreaterThan(0)
 expect(attempt.hasSent('a')).toBe(true)
 await attempt.send('a',target,'新附言',signal())
 expect(send).toHaveBeenCalledTimes(2)
})

it('keeps partial comment delivery retryable and does not resend confirmed destinations',async()=>{
 const send=sender().mockResolvedValueOnce({...receipt,warningText:'附言尚未确认'}).mockResolvedValue(receipt)
 const attempt=new TeamForwardAttempt('source',selections,send)
 await attempt.send('a',target,'附言',signal())
 expect(attempt.hasSent('a')).toBe(false)
 await attempt.send('b',{kind:'team',conversationRef:'team-target'},'附言',signal())
 await attempt.send('a',target,'不能修改',signal())
 expect(send.mock.calls[2]![0]).toEqual(send.mock.calls[0]![0])
 expect(send.mock.calls[1]![0].requestId).not.toBe(send.mock.calls[0]![0].requestId)
 await attempt.send('b',{kind:'team',conversationRef:'team-target'},'',signal())
 expect(send).toHaveBeenCalledTimes(3)
})

it('does not freeze a pre-cancelled action, and keeps a late confirmed receipt',async()=>{
 let complete!:(value:ArkmeSourceSendResult)=>void
 const send=sender().mockImplementationOnce(async()=>await new Promise(resolve=>{complete=resolve}))
 const attempt=new TeamForwardAttempt('source',selections,send),cancelled=new AbortController()
 cancelled.abort()
 await expect(attempt.send('a',target,'未提交的内容',cancelled.signal)).rejects.toThrow()
 expect(attempt.commentText).toBeUndefined();expect(attempt.hasAttempt('a')).toBe(false)
 const closing=new AbortController(),pending=attempt.send('a',target,'',closing.signal)
 closing.abort();complete(receipt)
 await pending
 expect(attempt.commentText).toBe('');expect(attempt.hasSent('a')).toBe(true)
 await attempt.send('a',target,'不能替换原空附言',signal())
 expect(send).toHaveBeenCalledOnce()
})

it.each([{itemUid:'',localState:'synced'},{itemUid:'pending',localState:'pending'}])('does not treat malformed or unconfirmed receipt as delivery: %j',async result=>{
 const send=sender().mockResolvedValue(result as ArkmeSourceSendResult)
 const attempt=new TeamForwardAttempt('source',selections,send)
 await expect(attempt.send('a',target,'',signal())).rejects.toThrow('尚未确认')
 expect(attempt.hasSent('a')).toBe(false)
})
