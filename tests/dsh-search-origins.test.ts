import { expect, it, vi } from 'vitest'
import { resolveDshSearchOrigins } from '../src/dsh-search-origins.js'
import { dshAgentInputRecordUid } from '../src/dsh-agent-input-sync.js'
import type { ArkmeSearchRecordItem } from '../src/types.js'

it('recovers exact old IDs, including non-best matches, without matching identical text or other records', async () => {
  const hit = (seq: number) => ({ sessionId: 'local-session', seq, type: 'user/message', surface: 'current' })
  const rows = [1, 2, 3].map(seq => ({ recordUid: dshAgentInputRecordUid('local-session', seq), creationSource: seq === 3 ? 1 : 3 })) as ArkmeSearchRecordItem[]
  rows.push({ recordUid: 'unrelated-record', creationSource: 3 } as ArkmeSearchRecordItem)
  const provider = { listSessions: vi.fn(async () => [{ header: { id: 'local-session', cwd: '/workspace' } }]), filterEvents: vi.fn(async () => [hit(1), hit(2), hit(3)]) }
  const result = await resolveDshSearchOrigins(provider, '武汉', rows)
  expect(result.map(item => item.dshOrigin)).toEqual([{ sessionId: 'local-session', eventSeq: 1 }, { sessionId: 'local-session', eventSeq: 2 }, undefined, undefined])
  expect(provider.filterEvents).toHaveBeenCalledTimes(1)
  expect(rows[0]?.dshOrigin).toBeUndefined()
})

it('skips providers when no recovery is required and propagates failed reads instead of declaring absence', async () => {
  const fail = vi.fn(async () => { throw new Error('index unavailable') })
  const provider = { listSessions: fail, filterEvents: fail }
  expect(await resolveDshSearchOrigins(provider, '武汉', [])).toEqual([])
  expect(fail).not.toHaveBeenCalled()
  const row = { recordUid: 'old', creationSource: 3 } as ArkmeSearchRecordItem
  await expect(resolveDshSearchOrigins(provider, '武汉', [row])).rejects.toThrow('index unavailable')
  const abort = new AbortController(); abort.abort()
  await expect(resolveDshSearchOrigins({ listSessions: async () => [], filterEvents: fail }, '武汉', [row], abort.signal)).rejects.toThrow()
})
