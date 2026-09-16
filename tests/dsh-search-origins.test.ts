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
