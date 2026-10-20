import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { UnifiedTimelineCache } from '../src/unified-timeline-cache.js'
import { ChatMessageSyncService } from '../src/services/chat-message-sync-service.js'
import type { ArkmeMessageSyncProgress, ChatSyncCommand } from '../src/chat-message-sync.js'
const position = { cursor: 500, membership_version: 2, initialized: true }
const head = { chat_session_uid: 'chat', session_kind: 1, membership_version: 2, accessible: true, complete: true, position }
const row = (i: number) => ({ rel_uid: String(i), revision: 1, record_version: 1, state: 'available', seq: i, unread: true })
function setup(post: (...args: any[]) => Promise<unknown>) {
  const path = mkdtempSync(join(tmpdir(), 'arkme sync owner ')), cache = new UnifiedTimelineCache(path)
  const updates: ArkmeMessageSyncProgress[] = []
  const committedHints: Array<{ sourceKeys: string[]; readable: number }> = []
  let account = 1
  const runtime = { config: { environment: 'test' }, requireSession: async () => ({ userId: account }), accountScopedSession: async () => ({ userId: account }), stateStore: { uniqueCode: async () => 'key' },
    authenticatedChatPost: post, runBackgroundMessageProjection: async (fn: () => Promise<unknown>) => fn() }
  const service = new ChatMessageSyncService(runtime as never, { sync: async (c: ChatSyncCommand) => cache.sync(c), syncTicket: async () => cache.reserve() } as never,
    { chatDirectorySourceKey: async (_user: number, uid: string) => `source:${uid}`, chatTimelineItemKey: async (_user: number, _uid: string, id: string) => `key:${id}` } as never,
    { chatTimelineItems: async (data: { items: any[] }) => data.items.map(item => ({ timelineItemKey: `key:${item.rel_uid}`, itemUid: item.rel_uid, recordVersion: item.record_version, sendAtMillis: item.relation.seq, textContent: 'body' })) } as never,
    (progress, sourceKeys) => {
      updates.push(progress)
      if (sourceKeys?.length) committedHints.push({ sourceKeys, readable: (cache.sync({ action: 'read', scope: JSON.stringify(['test', account, 'chat']), limit: 100 }) as import('../src/chat-message-sync.js').ChatSyncLocalPage | undefined)?.events.length ?? 0 })
    })
  return { service, updates, committedHints, runtime, switchAccount() { account++; service.reset() }, close() { service.dispose(); cache.close(); rmSync(path, { force: true, recursive: true }) } }
}
it('has one Host pump, 100-body batches, at most two background reads and no directory/read-ACK calls', async () => {
  let active = 0, peak = 0
  const post = vi.fn(async (route, data, _session, signal, options) => {
    expect(route).toBe('/api/v1/chat/sync/account'); expect(options.lane).toBe('background-read'); expect(signal.aborted).toBe(false)
    if (data.mode === 'unread_manifest') return { manifest_only: true, checkpoint: 'cp', has_more: false, retry: false, sessions: [{ ...head, manifest: Array.from({ length: 450 }, (_, i) => row(i+1)) }] }
    const ids = data.bodies.chat as string[]; expect(ids.length).toBeLessThanOrEqual(100)
    peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 10)); active--
    return { manifest_only: false, checkpoint: 'cp', has_more: false, retry: false, sessions: [{ ...head, items: ids.map(id => ({ ...row(Number(id)), relation: { rel_uid: id, seq: Number(id) }, record: {} })) }] }
  })
  const s = setup(post)
  try {
    const stop = s.service.start(); s.service.start(); await s.service.retry()
    await vi.waitFor(() => expect(s.updates.at(-1)).toMatchObject({ phase: 'idle', total: 450, completed: 450, pending: 0 }), { timeout: 8000 })
    expect(peak).toBe(2); expect(post).toHaveBeenCalledTimes(6)
    expect(s.updates.filter(p=>p.phase==='syncing').every(p=>p.total===450)).toBe(true)
    expect(s.committedHints).toHaveLength(5)
    expect(s.committedHints.every(hint => hint.sourceKeys.length === 1 && hint.sourceKeys[0] === 'source:chat' && hint.readable === 100)).toBe(true)
    stop()
  } finally { s.close() }
})
it('does not complete missing bodies and backs off without busy looping', async () => {
  const post = vi.fn(async (_route, data) => ({ manifest_only: data.mode === 'unread_manifest', checkpoint: 'cp', has_more: false, retry: false, sessions: [{ ...head,
    ...(data.mode === 'unread_manifest' ? { manifest: [row(1)] } : { items: [{ ...row(1), state: 'missing' }] }) }] }))
  const s = setup(post)
  try { s.service.start(); await vi.waitFor(() => expect(s.updates.at(-1)).toMatchObject({ phase: 'paused', total: 1, completed: 0, pending: 1 })); expect(post).toHaveBeenCalledTimes(2) }
  finally { s.close() }
})
it('aborts outstanding HTTP and rejects late old-account progress after account changes', async () => {
  let release: (()=>void) | undefined; let activeSignal: AbortSignal | undefined
  const s = setup(async (_route, _data, _session, signal) => {
    activeSignal = signal; await new Promise<void>(resolve => { release=resolve })
    return { manifest_only: true, checkpoint: 'cp', has_more: false, retry: false, sessions: [{ ...head, manifest: [row(1)] }] }
  })
  try {
    s.service.start(); await vi.waitFor(() => expect(release).toBeTypeOf('function')); s.switchAccount(); expect(activeSignal?.aborted).toBe(true)
    release!(); await new Promise(resolve => setTimeout(resolve,20)); expect(s.updates.at(-1)).toMatchObject({ accountKey: '', phase: 'idle', total: 0 })
    expect(s.committedHints).toEqual([])
  } finally { s.close() }
})
it('keeps explicit cached ranges on every discovery continuation and freezes only after the final page', async () => {
  let pages=0
  const s=setup(async(_route,data)=>{
    if(data.mode==='unread_manifest') {
      expect(data.cached).toEqual({}); pages++
      return {manifest_only:true,checkpoint:`cp${pages}`,has_more:pages===1,retry:false,sessions:[{...head,manifest:pages===1?[row(1)]:[]}]}
    }
    return {manifest_only:false,checkpoint:'cp2',has_more:false,retry:false,sessions:[{...head,items:[{...row(1),relation:{rel_uid:'1',seq:1},record:{}}]}]}
  })
  try {s.service.start();await vi.waitFor(()=>expect(s.updates.at(-1)).toMatchObject({phase:'idle',completed:1,total:1}));expect(pages).toBe(2)}
  finally{s.close()}
})
