import { expect, it, vi } from 'vitest'
import { LocalHistoryCoverage } from '../src/dsh-remote/local-history-coverage.js'
import { contentMessageKey, readLocalContentProof, type ContentProof } from '../src/dsh-remote/history-content-proof.js'
import type { DshAccountSession } from '../src/dsh-remote/account-session-types.js'

function fixture(size = 4) {
  const events = Array.from({ length: size }, (_, seq) => ({ seq, type: 'user/message', time: seq + 1, data: { text: `message-${seq}` } }))
  const summary = { updatedAt: 42, projectionAsOfSeq: size - 1, running: false }
  const summaries = vi.fn(async () => new Map([['same', { ...summary }]]))
  const close = vi.fn(async () => {}), read = vi.fn(async (offset: number, length: number) => ({ events: events.slice(offset, offset + length) }))
  const persistence = { open: vi.fn(async () => ({ read, close })) }
  const content = vi.fn(async (id: string, through: number, signal: AbortSignal) => readLocalContentProof(persistence, id, through, signal))
  const proof = (): ContentProof => ({ version: 1, messages: Object.fromEntries(events.map(e => [contentMessageKey(e)!, 1])), sequence: events.map(e => contentMessageKey(e)!) })
  const cloud = vi.fn(async () => proof()), readable = vi.fn(async () => true)
  const verifier = new LocalHistoryCoverage({ summaries, content }, cloud, readable)
  const row = (extra = {}) => ({ runtimeRef: 'cloud', sessionRef: 'same', historyRevision: 'revision', contentRevision: 'content', projectionAsOfSeq: size - 1, updatedAt: 42, previousRuntimeRefs: ['local'], local: false, ...extra }) as DshAccountSession
  const signal = new AbortController()
  const list = async (extra = {}) => { const r = row(extra); await verifier.annotate([r], 'local', signal.signal); return r }
  const proven = async (source: 'local' | 'cloud' = 'local') => { let r: DshAccountSession; await vi.waitFor(async () => { r = await list(); expect(r.coveredLocalHistory?.source).toBe(source) }); return r! }
  return { verifier, events, summary, summaries, content, read, close, cloud, readable, proof, row, signal, list, proven }
}
it('prefers readable local history on equality, single-flights windows and reuses proof results', async () => {
  const f = fixture()
  await Promise.all(Array.from({ length: 8 }, () => f.list()))
  const proof = await f.proven()
  expect(proof.coveredLocalHistory).toEqual({ runtimeRef: 'local', updatedAt: 42, projectionAsOfSeq: 3, source: 'local' })
  expect(f.cloud).toHaveBeenCalledOnce(); expect(f.content).toHaveBeenCalledOnce(); expect(f.readable).not.toHaveBeenCalled()
  await Promise.all(Array.from({ length: 100 }, () => f.list()))
  expect(f.cloud).toHaveBeenCalledOnce(); expect(f.content).toHaveBeenCalledOnce()
})
it('selects a local superset and selects a cloud superset only after native readability is proven', async () => {
  const local = fixture(); local.cloud.mockResolvedValue({ version: 1, messages: { [contentMessageKey(local.events[0]!)!]: 1 }, sequence: [contentMessageKey(local.events[0]!)!] })
  await local.proven('local')
  const cloud = fixture(); cloud.cloud.mockResolvedValue({ version: 1, messages: { ...cloud.proof().messages, [contentMessageKey({ seq: 8, type: 'user/message', time: 12, data: { text: 'additional cloud message' } })!]: 1 }, sequence: [...cloud.proof().sequence, contentMessageKey({ seq: 8, type: 'user/message', time: 12, data: { text: 'additional cloud message' } })!] })
  await cloud.proven('cloud'); expect(cloud.readable).toHaveBeenCalledOnce()
})
it('retains a real fork with independent messages and backs off failed proofs', async () => {
  const f = fixture()
  f.cloud.mockResolvedValue({ version: 1, messages: { ['a'.repeat(64)]: 1 }, sequence: ['a'.repeat(64)] })
  await f.list(); await vi.waitFor(() => expect(f.cloud).toHaveBeenCalledOnce())
  for (let i = 0; i < 20; i++) expect((await f.list()).coveredLocalHistory).toBeUndefined()
  expect(f.cloud).toHaveBeenCalledOnce()
})
it('retains a verified local superset across appends but invalidates rewinds and cloud changes', async () => {
  const f = fixture(); await f.proven()
  f.summary.running = true; f.summary.updatedAt++; f.summary.projectionAsOfSeq++; expect((await f.list()).coveredLocalHistory?.source).toBe('local')
  expect(f.content).toHaveBeenCalledOnce()
  f.summary.running = false; f.summary.projectionAsOfSeq = 1; expect((await f.list()).coveredLocalHistory).toBeUndefined()
  expect((await f.list({ contentRevision: 'new-content' })).coveredLocalHistory).toBeUndefined()
})
it('requires server aliases, revisions, local ownership and complete native coordinates', async () => {
  const f = fixture()
  await f.list({ previousRuntimeRefs: ['other'] }); await f.list({ contentRevision: undefined })
  expect(f.summaries).not.toHaveBeenCalled()
  f.read.mockResolvedValue({ events: f.events.slice(1) })
  await f.list(); await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce())
  expect((await f.list()).coveredLocalHistory).toBeUndefined(); expect(f.cloud).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledOnce()
})
it('rejects concurrent local changes and unreadable cloud supersets', async () => {
  const f = fixture()
  f.cloud.mockImplementation(async () => { f.summary.updatedAt++; return f.proof() })
  await f.list(); await vi.waitFor(() => expect(f.cloud).toHaveBeenCalledOnce())
  expect((await f.list()).coveredLocalHistory).toBeUndefined()
  const unreadable = fixture(); unreadable.cloud.mockResolvedValue({ version: 1, messages: { ...unreadable.proof().messages, ['a'.repeat(64)]: 1 }, sequence: [...unreadable.proof().sequence, 'a'.repeat(64)] }); unreadable.readable.mockResolvedValue(false)
  await unreadable.list(); await vi.waitFor(() => expect(unreadable.readable).toHaveBeenCalledOnce())
  expect((await unreadable.list()).coveredLocalHistory).toBeUndefined()
})
it('reads 10000 messages in bounded batches and performs no history reads on 400 window refreshes', async () => {
  const f = fixture(10_000), started = performance.now()
  await f.proven()
  expect(f.read).toHaveBeenCalledTimes(41); expect(f.cloud).toHaveBeenCalledOnce()
  expect(f.read.mock.calls.every(([, limit]) => limit <= 256)).toBe(true)
  await Promise.all(Array.from({ length: 400 }, () => f.list()))
  expect(f.read).toHaveBeenCalledTimes(41); expect(f.cloud).toHaveBeenCalledOnce()
  expect(performance.now() - started).toBeLessThan(10_000)
})
it('compares complete message payloads across sequence/chunk formats, including repeated tool calls', async () => {
  const event = { seq: 2, type: 'tool/call', time: 9, data: { input: { '2': '<script>', '10': '\u2028', '中文': '天气' }, name: 'tool' } }
  expect(contentMessageKey(event)).toBe(contentMessageKey({ ...event, seq: 900 }))
  expect(contentMessageKey(event)).not.toBe(contentMessageKey({ ...event, data: { input: 'different' } }))
  const proof = await readLocalContentProof({ open: async () => ({ read: async (offset: number) => ({ events: offset ? [] : [{ ...event, seq: 0 }, { ...event, seq: 1 }] }), close: async () => {} }) }, 's', 1, new AbortController().signal)
  expect(proof.messages[contentMessageKey(event)!]).toBe(2)
})
it('aborts an in-flight proof on account disposal without reviving its result', async () => {
  const f = fixture(); let resolve!: (value: ContentProof) => void
  f.cloud.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  await f.list(); await vi.waitFor(() => expect(f.cloud).toHaveBeenCalledOnce())
  f.signal.abort(); f.verifier.clear(); resolve(f.proof())
  await expect(f.list()).rejects.toThrow()
})

it('retains different chronological histories even when message multisets match', async () => {
 const f = fixture(); f.cloud.mockResolvedValue({ ...f.proof(), sequence: [...f.proof().sequence].reverse() })
 await f.list(); await vi.waitFor(() => expect(f.cloud).toHaveBeenCalledOnce())
 expect((await f.list()).coveredLocalHistory).toBeUndefined()
})

it('preserves tool cards/errors and usage while accepting v3 embedded token streams', () => {
 const event = { seq: 0, type: 'tool/result', time: 1, data: { message: { content: 'same' }, meta: { attachment: 'one' }, error: { code: 'failure' } } }
 expect(contentMessageKey(event)).not.toBe(contentMessageKey({ ...event, data: { ...event.data, meta: { attachment: 'two' } } }))
 expect(contentMessageKey(event)).not.toBe(contentMessageKey({ ...event, data: { message: event.data.message } }))
 const assistant = { seq: 1, time: 2, type: 'assistant/message', data: { turn: 1, step: 2, message: { content: 'complete' }, usage: { inputTokens: 3 } } }
 expect(contentMessageKey(assistant)).toBe(contentMessageKey({ ...assistant, data: { ...assistant.data, turn: 9, stream: [{ type: 'chunk' }] } }))
 expect(contentMessageKey(assistant)).not.toBe(contentMessageKey({ ...assistant, data: { ...assistant.data, usage: { inputTokens: 4 } } }))
})
it('uses the validated persistence end when a legacy list has unknown or pre-migration coordinates', async () => {
 const f = fixture(); f.summary.projectionAsOfSeq = -1
 await f.proven('local'); expect(f.read).toHaveBeenCalledTimes(2)
 expect(f.close).toHaveBeenCalledOnce()
})

it('does not read histories again for cloud rename, timestamp or metadata watermark changes',async()=>{
 const f=fixture(10000);await f.proven()
 for(let i=1;i<=400;i++)expect((await f.list({updatedAt:42+i,projectionAsOfSeq:10000+i,title:'renamed'})).coveredLocalHistory?.source).toBe('local')
 expect(f.content).toHaveBeenCalledOnce();expect(f.cloud).toHaveBeenCalledOnce()
})
