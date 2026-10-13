import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { DshNativeHistoryCache } from '../src/dsh-remote/native-history-cache.js'
import { DshCloudNativeTransport } from '../src/dsh-remote/cloud-native-transport.js'
import type { NativeHistoryRecord } from '../src/dsh-remote/native-history.js'

// Resolve the public export of the supported, installed official DSH version.
// Development peer fixtures predate native history validators.
vi.mock('@deepseek-ai/dsh-session/surface', async importOriginal => {
  if (!process.env.DSH_COMPATIBILITY_PACKAGE) return await importOriginal()
  const require = createRequire(process.env.DSH_COMPATIBILITY_PACKAGE)
  return await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session/surface')).href)
})

// Explicit private copy only. Neither path nor account content is committed.
it.skipIf(!process.env.DSH_PRIVATE_CACHE_COPY)('refreshes real nonempty cached histories on a copy and survives reopening', async () => {
  const source = new DatabaseSync(process.env.DSH_PRIVATE_CACHE_COPY!, { readOnly: true })
  const directory = mkdtempSync(join(tmpdir(), 'catalog cache acceptance '))
  const cache = new DshNativeHistoryCache(directory)
  let checked = 0
  try {
    for (const original of source.prepare('SELECT key,snapshot FROM sessions').all()) {
      const snapshot = JSON.parse(String(original.snapshot)) as Record<string, unknown>
      const records = source.prepare('SELECT payload FROM events WHERE session=? ORDER BY seq').all(original.key!).map(row => JSON.parse(String(row.payload)) as NativeHistoryRecord)
      if (!records.length) continue
      const [, runtime, address] = JSON.parse(String(original.key)) as [string, string, { sessionId: string }]
      const key = `${String(original.key)}:cloud-v2`
      cache.write(key, records, { ...snapshot, cloudRevision: 'old-generation', projections: { values: { title: 'stale-title' } } })
      const metadata = { runtime_ref: runtime, session_ref: address.sessionId, history_revision: 'new-generation', projection_as_of_seq: snapshot.cursor, source_updated_at: 100, title: 'refreshed-title' }
      const post = vi.fn(async (path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> => {
        if (path.endsWith('/sessions/metadata')) return metadata
        if (path.endsWith('/session-events/list')) return { entries: records.filter(row => row.event.seq < Number(body.before_seq ?? Infinity)).slice(-100).map(row => ({ event: row.event })) }
        throw new Error('unexpected network operation')
      })
      const cloud = new DshCloudNativeTransport({ post })
      const request = { mode: 'pull', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: address.sessionId } } } } }
      const result = await cloud.call(runtime, request, `cold-${checked}`, new AbortController().signal, { key: () => String(original.key), store: cache })
      expect(result).toMatchObject({ items: [{ cursor: snapshot.cursor, projections: { values: { title: 'refreshed-title' } } }] })
      expect(cache.page(key, Number(snapshot.cursor))?.records).toEqual(records)
      const reopened = new DshNativeHistoryCache(directory)
      try {
        post.mockClear()
        await cloud.call(runtime, request, `warm-${checked}`, new AbortController().signal, { key: () => String(original.key), store: reopened })
        expect(post.mock.calls.map(call => call[0])).toEqual(['/api/v1/dsh-remote/sessions/metadata'])
        expect(reopened.page(key, Number(snapshot.cursor))?.records).toEqual(records)
      } finally { reopened.close(); cloud.close() }
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  } finally { cache.close(); source.close(); rmSync(directory, { recursive: true, force: true }) }
})
