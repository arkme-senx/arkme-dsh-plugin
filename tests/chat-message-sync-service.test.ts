import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { UnifiedTimelineCache } from '../src/unified-timeline-cache.js'
import { ChatMessageSyncService } from '../src/services/chat-message-sync-service.js'
import { ArkmePluginError } from '../src/services/service.js'
import type { ArkmeMessageSyncProgress, ChatSyncCommand } from '../src/chat-message-sync.js'
import { MessageSyncDisplay } from '../src/client/message-sync-store.js'
import type { ArkmeChatClientEvent } from '../src/types.js'
const position = { cursor: 500, membership_version: 2, initialized: true }
const head = { chat_session_uid: 'chat', session_kind: 1, membership_version: 2, accessible: true, complete: true, position }
const row = (i: number) => ({ rel_uid: String(i), revision: 1, record_version: 1, state: 'available', seq: i, unread: true })
const timelineHint: ArkmeChatClientEvent = { type: 'timeline-changed', revision: 1, sourceKey: 'source:chat', timelineItemKey: 'key:1', changeKind: 'reedited', changeVersion: 1, relationTerminal: false, throughSequence: 1 }
function setup(post: (...args: any[]) => Promise<unknown>, observe?: (progress: ArkmeMessageSyncProgress) => void) {
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
      observe?.(progress)
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
it('commits bodies from the first page before requesting the next membership page', async () => {
  let pages=0, bodyCheckpoint: string | undefined
  const s=setup(async(_route,data)=>{
    if(data.mode==='unread_manifest') {
      expect(data.cached).toEqual({}); pages++
      if (pages === 2) expect(s.committedHints).toEqual([{ sourceKeys: ['source:chat'], readable: 1 }])
      return {manifest_only:true,checkpoint:`cp${pages}`,has_more:pages===1,retry:false,sessions:[{...head,manifest:pages===1?[row(1)]:[]}]}
    }
    bodyCheckpoint = data.checkpoint
    return {manifest_only:false,checkpoint:'cp1',has_more:false,retry:false,sessions:[{...head,items:[{...row(1),relation:{rel_uid:'1',seq:1},record:{}}]}]}
  })
  try {s.service.start();await vi.waitFor(()=>expect(s.updates.at(-1)).toMatchObject({phase:'idle',completed:1,total:1}));expect(pages).toBe(2);expect(bodyCheckpoint).toBe('cp1')}
  finally{s.close()}
})

it.each<ArkmeChatClientEvent>([
  timelineHint,
  { type: 'sessions-delta', revision: 1, updates: [] },
  { type: 'read-ack', revision: 1, sourceRef: 'source-ref', sourceKey: 'source:chat', effectiveReadSequence: 0, unreadCount: 1 },
  { type: 'members-invalidated', revision: 1, sourceKey: 'source:chat' },
])('keeps slow ordinary $type cache updates silent while still committing their bodies', async event => {
  vi.useFakeTimers()
  const display = new MessageSyncDisplay(); display.activateAccount('test:1')
  let count = 0, release: (() => void) | undefined
  const s = setup(async (_route, data) => {
    if (data.mode === 'unread_manifest') return { manifest_only: true, checkpoint: 'cp', has_more: false, retry: false, sessions: [{ ...head, manifest: Array.from({ length: count }, (_, i) => row(i + 1)) }] }
    await new Promise<void>(resolve => { release = resolve })
    return { manifest_only: false, checkpoint: 'cp', has_more: false, retry: false, sessions: [{ ...head, items: data.bodies.chat.map((id: string) => ({ ...row(Number(id)), relation: { rel_uid: id, seq: Number(id) }, record: {} })) }] }
  }, progress => display.apply(progress))
  try {
    s.service.start(); await vi.advanceTimersByTimeAsync(0)
    count = 1
    s.service.accept(event)
    await vi.advanceTimersByTimeAsync(6500)
    expect(s.updates.at(-1)).toMatchObject({ phase: 'syncing', trigger: 'realtime', pending: 1 })
    expect(display.snapshot().visible).toBe(false)
    release!(); await vi.advanceTimersByTimeAsync(0)
    expect(s.updates.at(-1)).toMatchObject({ phase: 'idle', completed: 1, trigger: 'realtime' })
    expect(s.committedHints).toEqual([{ sourceKeys: ['source:chat'], readable: 1 }])
    expect(display.snapshot().visible).toBe(false)
  } finally { release?.(); s.close(); display.dispose(); vi.useRealTimers() }
})

it.each([
  ['reconnect', false], ['retry', false], ['reconnect', true], ['retry', true],
] as const)('preserves %s feedback when realtime hints coalesce with recovery (already running=%s)', async (cause, running) => {
  vi.useFakeTimers()
  const display = new MessageSyncDisplay(); display.activateAccount('test:1')
  let count = 0, release: (() => void) | undefined
  const s = setup(async (_route, data) => {
    if (data.mode === 'unread_manifest') return { manifest_only: true, checkpoint: 'cp', has_more: false, retry: false, sessions: [{ ...head, manifest: Array.from({ length: count }, (_, i) => row(i + 1)) }] }
    await new Promise<void>(resolve => { release = resolve })
    return { manifest_only: false, checkpoint: 'cp', has_more: false, retry: false, sessions: [{ ...head, items: [{ ...row(1), relation: { rel_uid: '1', seq: 1 }, record: {} }] }] }
  }, progress => display.apply(progress))
  try {
    s.service.start(); await vi.advanceTimersByTimeAsync(0); count = 1
    s.service.accept(timelineHint)
    if (running) await vi.advanceTimersByTimeAsync(5000)
    if (cause === 'reconnect') s.service.accept({ type: 'reconcile', revision: 2, connected: true, connectionGeneration: 2 })
    else await s.service.retry()
    s.service.accept({ ...timelineHint, revision: 3 })
    await vi.advanceTimersByTimeAsync(400)
    expect(s.updates.at(-1)).toMatchObject({ phase: 'syncing', trigger: 'catchup' })
    expect(display.snapshot().visible).toBe(true)
    release!(); await vi.advanceTimersByTimeAsync(350)
    expect(display.snapshot().visible).toBe(false)
  } finally { release?.(); s.close(); display.dispose(); vi.useRealTimers() }
})

it('promotes failed realtime work to recovery feedback and preserves its retry', async () => {
  vi.useFakeTimers()
  const display = new MessageSyncDisplay(); display.activateAccount('test:1')
  let count = 0, failed = false
  const s = setup(async (_route, data) => {
    if (data.mode === 'unread_manifest') return { manifest_only: true, checkpoint: 'cp', has_more: false, retry: false, sessions: [{ ...head, manifest: Array.from({ length: count }, (_, i) => row(i + 1)) }] }
    if (!failed) { failed = true; throw new Error('network') }
    return { manifest_only: false, checkpoint: 'cp', has_more: false, retry: false, sessions: [{ ...head, items: [{ ...row(1), relation: { rel_uid: '1', seq: 1 }, record: {} }] }] }
  }, progress => display.apply(progress))
  try {
    s.service.start(); await vi.advanceTimersByTimeAsync(0); count = 1
    s.service.accept(timelineHint)
    await vi.advanceTimersByTimeAsync(5400)
    expect(s.updates.at(-1)).toMatchObject({ phase: 'paused', reason: 'network', trigger: 'catchup' })
    expect(display.snapshot().visible).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(s.updates.at(-1)).toMatchObject({ phase: 'idle', completed: 1, trigger: 'catchup' })
    expect(display.snapshot().visible).toBe(false)
  } finally { s.close(); display.dispose(); vi.useRealTimers() }
})

it('shows explicit cache recovery discovered by a realtime wake without changing its read flow', async () => {
  vi.useFakeTimers()
  const display = new MessageSyncDisplay(); display.activateAccount('test:1')
  let recover = false, pages = 0, release: (() => void) | undefined
  const post = vi.fn(async (_route, data) => {
    if (data.mode === 'unread_manifest') {
      if (!recover) return { manifest_only: true, checkpoint: 'cp0', has_more: false, retry: false, sessions: [{ ...head, manifest: [] }] }
      if (++pages === 1) return { manifest_only: true, checkpoint: 'cp-recover', has_more: true, retry: false, sessions: [{ ...head, complete: false, cache_required: true, position: { ...position, initialized: false }, manifest: [] }] }
      return { manifest_only: true, checkpoint: 'cp-ready', has_more: false, retry: false, sessions: [{ ...head, manifest: [row(1)] }] }
    }
    await new Promise<void>(resolve => { release = resolve })
    return { manifest_only: false, checkpoint: 'cp-ready', has_more: false, retry: false, sessions: [{ ...head, items: [{ ...row(1), relation: { rel_uid: '1', seq: 1 }, record: {} }] }] }
  })
  const s = setup(post, progress => display.apply(progress))
  try {
    s.service.start(); await vi.advanceTimersByTimeAsync(0); recover = true
    s.service.accept({ type: 'sessions-delta', revision: 1, updates: [] })
    await vi.advanceTimersByTimeAsync(6500)
    expect(pages).toBe(2)
    expect(s.updates.at(-1)).toMatchObject({ phase: 'syncing', trigger: 'catchup', total: 1, pending: 1 })
    expect(display.snapshot().visible).toBe(true)
    s.service.accept(timelineHint)
    release!(); await vi.advanceTimersByTimeAsync(350)
    expect(s.updates.at(-1)).toMatchObject({ phase: 'idle', completed: 1, trigger: 'catchup' })
    expect(display.snapshot().visible).toBe(false)
    expect(post).toHaveBeenCalledTimes(4)
  } finally { release?.(); s.close(); display.dispose(); vi.useRealTimers() }
})

it.each([true, false])('reconnect wakes transport backoff only (transport=%s)', async transport => {
  vi.useFakeTimers()
  const post = vi.fn(async () => {
    if (post.mock.calls.length === 1) throw transport
      ? new ArkmePluginError('arkme-network-error', 'offline', true, 502)
      : new ArkmePluginError('arkme-http-error', 'limited', true, 502, { upstreamStatus: 429, retryAfterMillis: 10000 })
    return { manifest_only: true, checkpoint: 'cp', has_more: false, retry: false, sessions: [] }
  })
  const s = setup(post)
  try {
    s.service.start()
    await vi.advanceTimersByTimeAsync(0)
    s.service.accept({ type: 'reconcile', revision: 1, connected: true, connectionGeneration: 2 })
    await vi.advanceTimersByTimeAsync(10)
    expect(post).toHaveBeenCalledTimes(transport ? 2 : 1)
    await vi.advanceTimersByTimeAsync(10000)
    expect(post).toHaveBeenCalledTimes(2)
  } finally { s.close(); vi.useRealTimers() }
})

it('runs a fresh pass immediately when reconnect arrives during an older manifest', async () => {
  vi.useFakeTimers()
  let release: (() => void) | undefined
  const post = vi.fn(async () => {
    if (post.mock.calls.length === 1) await new Promise<void>(resolve => { release = resolve })
    return { manifest_only: true, checkpoint: 'cp', has_more: false, retry: false, sessions: [] }
  })
  const s = setup(post)
  try {
    s.service.start()
    await vi.advanceTimersByTimeAsync(0)
    s.service.accept({ type: 'reconcile', revision: 1, connected: true, connectionGeneration: 2 })
    release!()
    await vi.advanceTimersByTimeAsync(10)
    expect(post).toHaveBeenCalledTimes(2)
  } finally { release?.(); s.close(); vi.useRealTimers() }
})

it('uses a Chat availability hint for one early transport probe per failure streak', async () => {
  vi.useFakeTimers()
  const post = vi.fn(async () => {
    if (post.mock.calls.length <= 2) throw new ArkmePluginError('arkme-network-error', 'offline', true, 502)
    return { manifest_only: true, checkpoint: 'cp', has_more: false, retry: false, sessions: [] }
  })
  const s = setup(post)
  try {
    s.service.start()
    await vi.advanceTimersByTimeAsync(0)
    s.service.resumeTransport()
    await vi.advanceTimersByTimeAsync(10)
    expect(post).toHaveBeenCalledTimes(2)
    s.service.resumeTransport()
    await vi.advanceTimersByTimeAsync(10)
    expect(post).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4000)
    expect(post).toHaveBeenCalledTimes(3)
  } finally { s.close(); vi.useRealTimers() }
})
