import { expect, it, vi } from 'vitest'
import { LocalHistoryCoverage } from '../src/dsh-remote/local-history-coverage.js'
import { contentMessageKey, readLocalContentProof } from '../src/dsh-remote/history-content-proof.js'
import type { DshAccountSession } from '../src/dsh-remote/account-session-types.js'

it('uses metadata alone across cold open, 400 window refreshes and 10000 active history appends', async () => {
 const summary = { updatedAt: 1, projectionAsOfSeq: 9999, running: false }
 const summaries = vi.fn(async () => new Map([['same', summary]]))
 const coverage = new LocalHistoryCoverage({ summaries })
 const row = (extra = {}) => ({ runtimeRef: 'cloud', sessionRef: 'same', previousRuntimeRefs: ['local'], local: false, ...extra }) as DshAccountSession
 const signal = new AbortController().signal
 for (let i = 0; i < 10400; i++) {
  summary.updatedAt++; summary.projectionAsOfSeq++
  summary.running = i >= 400
  const current = row({ contentRevision: String(i) })
  await coverage.annotate([current], 'local', signal)
  expect(current.coveredLocalHistory?.source).toBe(summary.running ? 'local' : 'cloud')
 }
 expect(summaries).toHaveBeenCalledTimes(10400)
 const verified = row({ readableRuntimeRefs: ['local'] })
 summary.running = false
 await coverage.annotate([verified], 'local', signal)
 expect(verified.coveredLocalHistory?.source).toBe('local')
})
it('requires account-owned local identity and server alias metadata, including archives', async () => {
 const summaries = vi.fn(async () => new Map([['same', {updatedAt: 1, running: false}]]))
 const coverage = new LocalHistoryCoverage({ summaries }), signal = new AbortController().signal
 const rows = [{runtimeRef:'cloud',sessionRef:'same',previousRuntimeRefs:['local'],archived:true}, {runtimeRef:'cloud',sessionRef:'foreign',previousRuntimeRefs:['local']}, {runtimeRef:'fork',sessionRef:'same'}] as DshAccountSession[]
 await coverage.annotate(rows, 'local', signal)
 expect(rows.map(r=>r.coveredLocalHistory?.source)).toEqual(['cloud',undefined,undefined])
 const abort = new AbortController(); abort.abort()
 await expect(coverage.annotate(rows,'local',abort.signal)).rejects.toThrow()
})
it('reads a restored 10000-message journal only through bounded public reads and closes it', async()=>{
 const events=Array.from({length:10000},(_,seq)=>({seq,type:'user/message',time:seq,data:{text:String(seq)}}))
 const read=vi.fn(async(offset:number,length:number)=>({events:events.slice(offset,offset+length)})), close=vi.fn(async()=>{})
 const proof=await readLocalContentProof({open:async()=>({read,close})},'restored',9999,new AbortController().signal)
 expect(proof.sequence).toHaveLength(10000);expect(read).toHaveBeenCalledTimes(41);expect(close).toHaveBeenCalledOnce()
 expect(read.mock.calls.every(([,limit])=>limit===256)).toBe(true)
})
it('compares complete message payloads across sequence/chunk formats, including repeated tool calls', async () => {
  const event = { seq: 2, type: 'tool/call', time: 9, data: { input: { '2': '<script>', '10': '\u2028', '中文': '天气' }, name: 'tool' } }
  expect(contentMessageKey(event)).toBe(contentMessageKey({ ...event, seq: 900 }))
  expect(contentMessageKey(event)).not.toBe(contentMessageKey({ ...event, data: { input: 'different' } }))
  const proof = await readLocalContentProof({ open: async () => ({ read: async (offset: number) => ({ events: offset ? [] : [{ ...event, seq: 0 }, { ...event, seq: 1 }] }), close: async () => {} }) }, 's', 1, new AbortController().signal)
  expect(proof.messages[contentMessageKey(event)!]).toBe(2)
})
it('preserves tool cards/errors and usage while accepting v3 embedded token streams', () => {
 const event = { seq: 0, type: 'tool/result', time: 1, data: { message: { content: 'same' }, meta: { attachment: 'one' }, error: { code: 'failure' } } }
 expect(contentMessageKey(event)).not.toBe(contentMessageKey({ ...event, data: { ...event.data, meta: { attachment: 'two' } } }))
 expect(contentMessageKey(event)).not.toBe(contentMessageKey({ ...event, data: { message: event.data.message } }))
 const assistant = { seq: 1, time: 2, type: 'assistant/message', data: { turn: 1, step: 2, message: { content: 'complete' }, usage: { inputTokens: 3 } } }
 expect(contentMessageKey(assistant)).toBe(contentMessageKey({ ...assistant, data: { ...assistant.data, turn: 9, stream: [{ type: 'chunk' }] } }))
 expect(contentMessageKey(assistant)).not.toBe(contentMessageKey({ ...assistant, data: { ...assistant.data, usage: { inputTokens: 4 } } }))
})

it('folds a restored account-owned identity before its new runtime has uploaded history',async()=>{
 const coverage=new LocalHistoryCoverage({summaries:async()=>new Map([['restored',{updatedAt:0,running:false}]])})
 const row={runtimeRef:'old-runtime',sessionRef:'restored',canonicalIdentity:true} as DshAccountSession
 await coverage.annotate([row],'new-runtime',new AbortController().signal)
 expect(row.coveredLocalHistory?.source).toBe('cloud')
 expect(row.coveredLocalHistory?.runtimeRef).toBe('new-runtime')
})

it('recognizes an account-owned canonical alias before Host registration supplies a Runtime', async () => {
  const coverage = new LocalHistoryCoverage({ summaries: async () => new Map([['same', { updatedAt: 1, running: false }]]) })
  const rows = [
    { runtimeRef: 'cloud', sessionRef: 'same', canonicalIdentity: true },
    { runtimeRef: 'cloud', sessionRef: 'foreign', canonicalIdentity: true },
    { runtimeRef: 'legacy', sessionRef: 'same' },
  ] as DshAccountSession[]
  await coverage.annotate(rows, undefined, new AbortController().signal)
  expect(rows.map(row => row.coveredLocalHistory?.source)).toEqual(['cloud', undefined, undefined])
})
