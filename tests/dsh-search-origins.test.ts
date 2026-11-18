import { expect, it, vi } from 'vitest'
import { resolveDshSearchOrigins } from '../src/dsh-search-origins.js'
import { dshAgentInputRecordUid } from '../src/dsh-agent-input-sync.js'
import type { ArkmeSearchRecordItem } from '../src/types.js'

it('recovers exact old IDs, including non-best matches, without matching identical text or other records', async () => {
  const hit = (seq: number) => ({ sessionId: 'local-session', seq, type: 'user/message', surface: 'current' })
  const rows = [1, 2, 3].map(seq => ({ recordUid: dshAgentInputRecordUid('local-session', seq), creationSource: seq === 3 ? 1 : 3 })) as ArkmeSearchRecordItem[]
  rows.push({ recordUid: 'unrelated-record', creationSource: 3 } as ArkmeSearchRecordItem)
  const provider = { listSessions: vi.fn(async () => [{ header: { id: 'local-session', cwd: '/workspace' } }]), filterEvents: vi.fn(async () => [hit(1), hit(2), hit(3)]) }
  const result = await resolveDshSearchOrigins(provider, rows)
  expect(result.map(item => item.dshOrigin)).toEqual([{ sessionId: 'local-session', eventSeq: 1 }, { sessionId: 'local-session', eventSeq: 2 }, undefined, undefined])
  expect(provider.filterEvents).toHaveBeenCalledTimes(1)
  expect(rows[0]?.dshOrigin).toBeUndefined()
})

it('keeps search results when local lookup fails, marks them unverified and still propagates caller cancellation', async () => {
  const fail = vi.fn(async () => { throw new Error('index unavailable') })
  const provider = { listSessions: fail, filterEvents: fail }
  expect(await resolveDshSearchOrigins(provider, [])).toEqual([])
  expect(fail).not.toHaveBeenCalled()
  const row = { recordUid: 'old', creationSource: 3 } as ArkmeSearchRecordItem
  expect(await resolveDshSearchOrigins(provider, [row])).toEqual([{ ...row, dshOriginUnverified: true }])
  const abort = new AbortController(); abort.abort()
  await expect(resolveDshSearchOrigins({ listSessions: async () => [], filterEvents: fail }, [row], abort.signal)).rejects.toThrow()
})


it('recovers a session beyond the old twenty-session cutoff even when the synced message was edited', async () => {
 const row = { recordUid: dshAgentInputRecordUid('s0', 9), creationSource: 3 } as ArkmeSearchRecordItem
 const filterEvents = vi.fn(async (id: string) => id === 's0' ? [{ sessionId: id, seq: 9, type: 'user/message', surface: 'current' }] : [])
 const provider = { listSessions: async () => Array.from({ length: 21 }, (_, i) => ({ header: { id: `s${i}`, cwd: '/workspace', createdAt: i } })), filterEvents }
 expect((await resolveDshSearchOrigins(provider, [row]))[0]?.dshOrigin).toEqual({ sessionId: 's0', eventSeq: 9 })
 expect(filterEvents).toHaveBeenCalledTimes(21)
 expect(filterEvents).toHaveBeenLastCalledWith('s0', [{ kind: 'type', values: ['user/message'] }])
})

it.each(['sessions', 'events'] as const)('honors the existing deadline while %s ignores cancellation and ignores late results', async stage => {
 const deadline = new AbortController()
 const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
 let finish!: () => void
 const waiting = new Promise<void>(resolve => { finish = resolve })
 const row = { recordUid: dshAgentInputRecordUid('slow', 9), creationSource: 3 } as ArkmeSearchRecordItem
 const provider = {
  listSessions: vi.fn(async () => { if(stage === 'sessions') await waiting; return [{header:{id:'slow',cwd:'/workspace'}}, {header:{id:'next',cwd:'/workspace'}}] }),
  filterEvents: vi.fn(async () => { await waiting; return [{sessionId:'slow',seq:9,type:'user/message',surface:'current'}] }),
 }
 const reading = resolveDshSearchOrigins(provider, [row])
 try {
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(stage === 'sessions' ? provider.listSessions : provider.filterEvents).toHaveBeenCalledOnce()
  let settled = false
  void reading.then(() => { settled = true })
  deadline.abort(new DOMException('Timed out', 'TimeoutError'))
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(settled).toBe(true)
  const result = await reading
  expect(result).toEqual([{...row,dshOriginUnverified:true}])
  expect(timeout).toHaveBeenCalledWith(5000)
  finish(); await Promise.resolve(); await Promise.resolve()
  expect(result[0]?.dshOrigin).toBeUndefined()
  expect(provider.filterEvents).toHaveBeenCalledTimes(stage === 'sessions' ? 0 : 1)
 } finally { finish(); await reading; timeout.mockRestore() }
})

it('releases a cancelled search without waiting for an uncancellable event read', async () => {
 let finish!: () => void
 const waiting = new Promise<void>(resolve => { finish = resolve })
 const controller = new AbortController()
 const provider = {listSessions:async()=>[{header:{id:'slow',cwd:'/workspace'}}],filterEvents:vi.fn(async()=>{await waiting;return []})}
 const reading = resolveDshSearchOrigins(provider, [{recordUid:'unknown',creationSource:3} as ArkmeSearchRecordItem],controller.signal)
 let rejected = false
 const checked = expect(reading).rejects.toMatchObject({name:'AbortError'}).then(()=>{rejected=true})
 try {
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(provider.filterEvents).toHaveBeenCalledOnce()
  controller.abort()
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(rejected).toBe(true)
 } finally {finish();await checked}
})
