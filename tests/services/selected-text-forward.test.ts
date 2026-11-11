import {it,expect,vi} from 'vitest'
import {sendSelectedTextForward} from '../../src/services/selected-text-forward.js'
import {readRecordExcerpt} from '../../src/record-excerpt.js'
import {matchExcerptOriginal} from '../../src/services/excerpt-original.js'
import {createHash} from 'node:crypto'
import type {ServiceRuntime} from '../../src/services/service.js'
import {RecordService} from '../../src/services/record-service.js'
import {ChatService} from '../../src/services/chat-service.js'
const quote={version:1 as const,sourceLabel:'群聊',senderName:'原作者',sourceAtMillis:1000,text:'引用 😀\n'}
const input={expectedAccountKey:'prod:11',recordUid:'019d8592-ebb4-7232-90f2-000000000001',relationUid:'019d8592-ebb4-7232-90f2-000000000002',sendAtMillis:1000,commentText:'',quote}
function fixture(){const session={userId:11,refreshToken:'session'};return {config:{environment:'prod',maxTextLength:20000},requireSession:vi.fn(async()=>session),accountScopedSession:vi.fn(async()=>session)} as unknown as ServiceRuntime}
it.each(['send_to_self','topic','private_chat','group_chat'])('persists exact selected prose and optional comment as one cloud document for %s',async kind=>{
 const runtime=fixture(),send=vi.fn(async(text:string,user:number,excerpt:any)=>{expect(user).toBe(11);expect(readRecordExcerpt(excerpt,text)).toBeDefined();expect(text.slice(excerpt.quote_start,excerpt.quote_end)).toBe(quote.text);expect(excerpt.kind).toBe('forward');expect(text.slice(excerpt.note_start)).toBe('');return {sourceRef:'target',itemUid:input.recordUid,status:1,localState:'synced' as const}})
 await sendSelectedTextForward(runtime,input,{kind,ownerRef:'target'},send);expect(send).toHaveBeenCalledOnce()
})
it('separates comment and never writes a local quotation before cloud acceptance',async()=>{
 const runtime=fixture(),store=vi.fn();(runtime as any).stateStore={selfNoteQuotes:{prepare:store}}
 await sendSelectedTextForward(runtime,{...input,commentText:'  我的附言 #tag  '},{kind:'private_chat',ownerRef:'target'},async(text,user,excerpt)=>{expect(text.slice(excerpt.note_start)).toBe('我的附言 #tag');expect(text.slice(excerpt.quote_end,excerpt.note_start)).toBe('\n\n附言\n');return {sourceRef:'target',itemUid:input.recordUid,status:1,localState:'synced'}})
 expect(store).not.toHaveBeenCalled()
})
it('blocks wrong accounts, invalid time, unsupported targets, aborted and unconfirmed delivery',async()=>{
 const runtime=fixture(),send=vi.fn()
 for(const data of [{...input,expectedAccountKey:'prod:12'},{...input,sendAtMillis:0},{...input,quote:{...quote,text:'x'.repeat(2001)}}])await expect(sendSelectedTextForward(runtime,data,{kind:'private_chat',ownerRef:'target'},send)).rejects.toThrow()
 await expect(sendSelectedTextForward(runtime,input,{kind:'team',ownerRef:'target'},send)).rejects.toThrow()
 await expect(sendSelectedTextForward(runtime,input,{kind:'private_chat',ownerRef:'target'},send,AbortSignal.abort())).rejects.toThrow();expect(send).not.toHaveBeenCalled()
 await expect(sendSelectedTextForward(runtime,input,{kind:'private_chat',ownerRef:'target'},async()=>({sourceRef:'target',itemUid:'wrong',localState:'synced',status:1}))).rejects.toMatchObject({code:'selected-text-unconfirmed'})
})
it('matches the exact occurrence of repeated text without persisting surrounding private prose',()=>{
 const text='私文 相同 相同 尾文',start=text.lastIndexOf('相同'),digest=createHash('sha256').update(JSON.stringify([text,'plain'])).digest('hex')
 const q={...quote,text:'相同',sourceSelection:{projection:'arkme-text-v1' as const,source_digest:digest,start,end:start+2,record_version:3}}
 expect(matchExcerptOriginal({title:'source',text,recordVersion:3},q).selection).toEqual({start,end:start+2})
 expect(()=>matchExcerptOriginal({title:'source',text:text+'改',recordVersion:4},q)).toThrow('变化')
 expect(JSON.stringify(q.sourceSelection)).not.toContain('私文')
})

it('keeps a pending self excerpt bound to the original send time and exposes intent conflicts',async()=>{
 const runtime=fixture()
 let pending:any
 await sendSelectedTextForward(runtime,input,{kind:'send_to_self',ownerRef:'self'},async(text,userId,excerpt)=>{
  pending={recordUid:input.recordUid,textContent:text,excerpt:readRecordExcerpt(excerpt,text),sendAtMillis:input.sendAtMillis,createdAtMillis:input.sendAtMillis,attempts:1}
  return {sourceRef:'self',itemUid:input.recordUid,status:1,localState:'synced'}
 })
 ;(runtime as any).stateStore={listPending:async()=>[pending]}
 const record=new RecordService(runtime,{} as never,{} as never)
 const dispatch=vi.spyOn(record as any,'sendPending').mockResolvedValue({recordUid:input.recordUid,status:1})
 await expect(record.createText(input.recordUid,pending.textContent,{excerpt:pending.excerpt,sendAtMillis:input.sendAtMillis+1})).rejects.toMatchObject({code:'record-intent-conflict'})
 await expect(record.createTextForConversation(input.recordUid,pending.textContent,{excerpt:pending.excerpt,sendAtMillis:input.sendAtMillis+1})).rejects.toMatchObject({code:'record-intent-conflict'})
 expect(dispatch).not.toHaveBeenCalled()
 await expect(record.createTextForConversation(input.recordUid,pending.textContent,{excerpt:pending.excerpt,sendAtMillis:input.sendAtMillis})).resolves.toMatchObject({localState:'synced',recordUid:input.recordUid})
 expect(dispatch).toHaveBeenCalledOnce()
})


it('does not send a topic excerpt if cancelled while resolving the sender snapshot', async () => {
 const controller = new AbortController()
 const record = {createPersonalRecord: vi.fn()}
 const runtime = fixture()
 const chat = new ChatService(runtime,
  {openSourceRef: async () => ({kind: 'topic', ownerRef: 'topic'})} as never,
  {recordSenderSnapshot: async () => controller.abort()} as never,
  {} as never, record as never, {} as never, {} as never, {} as never, {} as never)
 const target = {kind: 'topic', ownerRef: 'topic'}
 await expect(sendSelectedTextForward(runtime, input, target, (text, userId, excerpt) =>
  chat.sendSourceExcerpt('topic-ref', text, excerpt, {
   recordUid: input.recordUid, expectedUserId: userId, sendAtMillis: input.sendAtMillis, signal: controller.signal,
  }), controller.signal)).rejects.toMatchObject({name: 'AbortError'})
 expect(record.createPersonalRecord).not.toHaveBeenCalled()
})
