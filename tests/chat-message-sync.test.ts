import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { UnifiedTimelineCache, TIMELINE_CACHE_FILE } from '../src/unified-timeline-cache.js'
import { parseChatSyncPage, type ChatSyncCommand, type ChatSyncPlan, type ChatSyncWork, type ChatSyncSession } from '../src/chat-message-sync.js'
import { MessageSyncDisplay } from '../src/client/message-sync-store.js'
const paths: string[] = []
afterEach(() => { vi.useRealTimers(); for (const path of paths.splice(0)) rmSync(path, { force: true, recursive: true }) })
const session = (work: ChatSyncWork[], uid = 'chat'): ChatSyncSession => ({ uid, kind: 1, membership: 2, accessible: true, complete: true, position: { cursor: 10, initialized: true, membership_version: 2 }, cacheRequired: false, work, scope: `test:1:${uid}`, sourceKey: `source:${uid}` })
const work = (id = 'one', sequence = 1): ChatSyncWork => ({ id, revision: 1, version: 1, state: 'available', sequence, unread: true, eventId: `event:${id}`, itemKey: `key:${id}` })
const body = (item: ChatSyncWork): ChatSyncWork => ({ ...item, event: { eventId: item.eventId!, source: 'messages', occurredAtMillis: item.sequence, orderTie: item.id, kind: 'message', contentStatus: 'available', item: { itemUid: item.id, timelineItemKey: item.itemKey, recordVersion: item.version, textContent: '正文' } as never } })
function setup() {
  const path = mkdtempSync(join(tmpdir(), 'arkme sync test ')); paths.push(path)
  let cache = new UnifiedTimelineCache(path), plan: ChatSyncPlan
  const execute = (command: ChatSyncCommand) => cache.sync(command)
  const begin = () => plan = execute({ action: 'begin', account: 'test:1' }) as ChatSyncPlan
  const page = (sessions: ChatSyncSession[], manifest = true) => plan = execute({ action: manifest ? 'manifest' : 'commit', account: 'test:1', epoch: plan.epoch, expectedCheckpoint: plan.checkpoint,
    page: { manifest, checkpoint: 'checkpoint', hasMore: false, retry: false, sessions }, ticket: cache.reserve(), now: 100 }) as ChatSyncPlan
  const action = (action: 'freeze' | 'finish') => plan = execute({ action, account: 'test:1', epoch: plan.epoch }) as ChatSyncPlan
  return { path, execute, begin, page, action, get cache() { return cache }, get plan() { return plan }, reopen() { cache.close(); cache = new UnifiedTimelineCache(path) }, close() { cache.close() } }
}
it('commits bodies and checkpoint durably, freezes m, resumes without recounting and never writes read acknowledgements', () => {
  const s = setup()
  try {
    s.begin(); s.page([session([work(), work('two', 2)])]); expect(s.action('freeze').progress).toMatchObject({ total: 2, completed: 0 })
    s.page([session([body(work())])], false)
    expect(s.plan.progress).toMatchObject({ completed: 1, total: 2, pending: 1 })
    s.reopen(); expect(s.begin().progress).toMatchObject({ completed: 1, total: 2, pending: 1 })
    s.page([session([body(work('two', 2))])], false)
    expect(s.action('finish').progress).toMatchObject({ total: 2, completed: 2, pending: 0 })
    expect(s.execute({ action: 'read', scope: 'test:1:chat', limit: 40 })).toMatchObject({ events: [{ eventId: 'event:one' }, { eventId: 'event:two' }] })
    expect(s.execute({ action: 'read', scope: 'test:2:chat', limit: 40 })).toBeUndefined()
    const db = new DatabaseSync(join(s.path, TIMELINE_CACHE_FILE), { readOnly: true })
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%read%'").all()).toEqual([]); db.close()
  } finally { s.close() }
})
it('rolls back the entire commit on invalid bodies, counts zero-revision tombstones and holds pending work', () => {
  const s = setup()
  try {
    s.begin(); s.page([session([work(), work('two', 2)])]); s.action('freeze')
    expect(() => s.page([session([body(work()), work('two', 2)])], false)).toThrow('body-incomplete')
    expect(s.execute({ action: 'status', account: 'test:1' })).toMatchObject({ progress: { completed: 0, pending: 2 } })
    s.page([session([{ ...work(), state: 'removed', revision: 0, version: 0 }, { ...work('two', 2), state: 'pending', revision: 0 }])], false)
    expect(s.plan.progress).toMatchObject({ completed: 1, terminal: 1, pending: 1 })
    expect(s.execute({ action: 'pending', account: 'test:1', epoch: s.plan.epoch, now: 100, limit: 400 })).toEqual([])
  } finally { s.close() }
})
it('resolves local history anchors by event, item key and record identity after reopening', () => {
  const s = setup()
  try {
    const message = body(work())
    if (message.event?.kind === 'message') message.event.item.itemUid = 'record-one'
    s.begin(); s.page([session([work()])]); s.action('freeze')
    s.page([session([message])], false); s.action('finish'); s.reopen()
    for (const anchorId of ['event:one', 'key:one', 'record-one']) {
      expect(s.execute({ action: 'read', scope: 'test:1:chat', limit: 40, anchorId })).toMatchObject({ events: [{ item: { itemUid: 'record-one' } }] })
      expect(s.execute({ action: 'read', scope: 'test:2:chat', limit: 40, anchorId })).toBeUndefined()
    }
    expect(s.execute({ action: 'read', scope: 'test:1:chat', limit: 40, anchorId: 'unknown-record' })).toBeUndefined()
    s.cache.invalidateSource('source:chat', 'key:one', true)
    expect(s.execute({ action: 'read', scope: 'test:1:chat', limit: 40, anchorId: 'record-one' })).toBeUndefined()
  } finally { s.close() }
})
it('leaves settled unread receipts untouched on empty checks and carries only invalidated work into the next cohort', () => {
  const s = setup()
  try {
    s.begin(); s.page([session([work(), work('two', 2)])]); s.action('freeze')
    s.page([session([body(work()), body(work('two', 2))])], false); s.action('finish')
    const db = new DatabaseSync(join(s.path, TIMELINE_CACHE_FILE))
    try {
      db.exec('CREATE TABLE receipt_writes(n INTEGER); INSERT INTO receipt_writes VALUES (0); CREATE TRIGGER audit_receipts AFTER UPDATE ON message_sync_work BEGIN UPDATE receipt_writes SET n=n+1; END;')
      s.begin(); s.page([session([])]); s.action('freeze'); s.action('finish')
      expect(db.prepare('SELECT n FROM receipt_writes').get()!.n).toBe(0)
      expect(s.plan.progress).toMatchObject({ total: 0, completed: 0, pending: 0 })
      s.cache.invalidateSource('source:chat', 'key:one')
      db.exec('UPDATE receipt_writes SET n=0')
      s.begin(); s.page([session([])]); s.action('freeze')
      expect(db.prepare('SELECT n FROM receipt_writes').get()!.n).toBe(1)
      expect(s.plan.progress).toMatchObject({ total: 1, completed: 0, pending: 1 })
      s.page([session([body(work())])], false); s.action('finish')
      expect(s.plan.progress).toMatchObject({ total: 1, completed: 1, pending: 0 })
      expect(s.execute({ action: 'read', scope: 'test:1:chat', limit: 40 })).toMatchObject({ events: [{ eventId: 'event:one' }, { eventId: 'event:two' }] })
    } finally { db.close() }
  } finally { s.close() }
})
it('does not report a skipped newer body as committed when a later foreground ticket holds an older version', () => {
  const s = setup()
  try {
    const latest = { ...work(), version: 2 }
    s.begin(); s.page([session([latest])]); s.action('freeze')
    const delayedTicket = s.cache.reserve()
    const foreground = body(work()).event!
    s.cache.write('test:1:chat', 'latest', { source: {} as never, items: [], hasMore: false,
      unified: { protocolVersion: 1, events: [foreground], sources: [{ source: 'messages', status: 'ready', itemCount: 1 }],
        complete: true, windowTokens: ['window'], olderHasMore: false, newerHasMore: false, hasMore: false } })
    expect(() => s.execute({ action: 'commit', account: 'test:1', epoch: s.plan.epoch, expectedCheckpoint: s.plan.checkpoint,
      page: { manifest: false, checkpoint: 'checkpoint', retry: false, hasMore: false, sessions: [session([body(latest)])] },
      ticket: delayedTicket, now: 100 })).toThrow('message-sync-stale')
    expect(s.execute({ action: 'status', account: 'test:1' })).toMatchObject({ progress: { completed: 0, pending: 1 } })
    s.reopen()
    expect(s.begin().progress).toMatchObject({ completed: 0, pending: 1 })
    s.page([session([body(latest)])], false); s.action('finish')
    expect(s.plan.progress).toMatchObject({ completed: 1, pending: 0 })
    expect(s.execute({ action: 'read', scope: 'test:1:chat', limit: 40 })).toMatchObject({ events: [{ item: { recordVersion: 2 } }] })
  } finally { s.close() }
})
it('fences stale account epochs and realtime revocation and removes local content on membership loss', () => {
  const s = setup()
  try {
    s.begin(); s.page([session([work()])]); s.action('freeze'); const old = s.plan.epoch
    s.begin(); expect(() => s.execute({ action: 'finish', account: 'test:1', epoch: old })).toThrow('stale')
    const ticket = s.cache.reserve(); s.cache.invalidateSource('source:chat', 'key:one', true)
    expect(() => s.execute({ action: 'commit', account: 'test:1', epoch: s.plan.epoch, expectedCheckpoint: 'checkpoint', page: { manifest: false, checkpoint: 'checkpoint', retry: false, hasMore: false, sessions: [session([body(work())])] }, ticket, now: 0 })).toThrow('stale')
    s.page([session([body(work())])], false)
    s.page([{ ...session([]), accessible: false, membership: 3 }], false)
    expect(s.execute({ action: 'read', scope: 'test:1:chat', limit: 40 })).toBeUndefined()
    expect(s.plan.progress.pending).toBe(0)
  } finally { s.close() }
})
it('keeps unread pins when 256 windows are evicted; ignores read history with no local reference', () => {
  const s = setup()
  try {
    s.begin(); s.page([session([work(), { ...work('read'), unread: false }])]); expect(s.action('freeze').progress.total).toBe(1)
    s.page([session([body(work())])], false); s.action('finish')
    for (let i=0;i<260;i++) s.cache.write('other', String(i), { source: {} as never, items: [], hasMore: false, unified: { protocolVersion: 1, events: [], sources: [], complete: true, windowTokens: [], olderHasMore: false, newerHasMore: false, hasMore: false } })
    expect(s.execute({ action: 'read', scope: 'test:1:chat', limit: 40 })).toMatchObject({ events: [{ eventId: 'event:one' }] })
  } finally { s.close() }
})
it('round-robins a busy account across more than fifty sessions with bounded batches', () => {
  const s = setup()
  try {
    s.begin(); const sessions = Array.from({ length: 55 }, (_, i) => session(Array.from({ length: 12 }, (_, j) => work(`${i}-${j}`, j+1)), `chat-${String(i).padStart(2,'0')}`))
    s.page(sessions.slice(0,50)); s.page(sessions.slice(50)); s.action('freeze')
    const first = s.execute({ action: 'pending', account: 'test:1', epoch: s.plan.epoch, now: 0, limit: 400 }) as { uid: string; work: unknown[] }[]
    const second = s.execute({ action: 'pending', account: 'test:1', epoch: s.plan.epoch, now: 0, limit: 400 }) as { uid: string; work: unknown[] }[]
    expect(first.reduce((n,s) => n+s.work.length,0)).toBeLessThanOrEqual(400)
    expect(second.slice(0,5).map(s=>s.uid)).toEqual(['chat-50','chat-51','chat-52','chat-53','chat-54'])
  } finally { s.close() }
})
it('rejects malformed bodies and uses current authorization membership instead of checkpoint membership', () => {
  const raw = { manifest_only: true, checkpoint: 'cp', has_more: false, retry: false, sessions: [{ chat_session_uid: 'chat', accessible: true, session_kind: 1, membership_version: 3, position: { cursor: 1, membership_version: 2, initialized: true }, complete: true, manifest: [] }] }
  expect(parseChatSyncPage(raw, true).sessions[0]?.membership).toBe(3)
  expect(() => parseChatSyncPage({ ...raw, sessions: [...raw.sessions, ...raw.sessions] }, true)).toThrow('Duplicate')
  expect(() => parseChatSyncPage({ ...raw, manifest_only: false, sessions: [{ ...raw.sessions[0], items: [{ rel_uid: 'x', state: 'available' }] }] }, false)).toThrow('Missing')
})
it('hides quick work, holds completion, cancels old timers, and isolates account switches', () => {
  vi.useFakeTimers(); const display = new MessageSyncDisplay(); display.activateAccount('test:1')
  const progress = { accountKey: 'test:1', cycle: 1, revision: 1, phase: 'syncing' as const, completed: 0, total: 10, pending: 10, terminal: 0 }
  display.apply(progress); vi.advanceTimersByTime(200); display.apply({ ...progress, revision: 2, completed: 10, pending: 0, phase: 'idle' }); vi.advanceTimersByTime(300)
  expect(display.snapshot().visible).toBe(false)
  display.apply({ ...progress, revision: 3 }); vi.advanceTimersByTime(300); expect(display.snapshot().visible).toBe(true)
  display.apply({ ...progress, revision: 4, phase: 'idle', completed: 10, pending: 0 }); vi.advanceTimersByTime(349); expect(display.snapshot().visible).toBe(true)
  display.apply({ ...progress, revision: 5, cycle: 2 }); vi.advanceTimersByTime(200); expect(display.snapshot().visible).toBe(true)
  display.activateAccount('test:2'); display.apply({ ...progress, revision: 6 }); vi.advanceTimersByTime(1000); expect(display.snapshot()).toEqual({ visible: false }); display.dispose()
})
it('releases unread retention only on an existing acknowledged read cursor, preserves counts on capacity failure', () => {
  const s=setup()
  try {
    s.begin(); s.page([session([work()])]); s.action('freeze')
    const db = new DatabaseSync(join(s.path,TIMELINE_CACHE_FILE)); const bytes = db.prepare('SELECT metadata FROM message_sync_stats').get()!.metadata
    db.prepare('UPDATE message_sync_stats SET metadata=?').run(193*1024*1024)
    expect(()=>s.page([session([body(work())])],false)).toThrow('capacity')
    expect(s.execute({action:'status',account:'test:1'})).toMatchObject({progress:{completed:0,pending:1}})
    db.prepare('UPDATE message_sync_stats SET metadata=?').run(bytes); db.close()
    s.page([session([body(work())])],false); s.action('finish')
    s.execute({action:'ack',account:'other',sourceKey:'source:chat',through:10}); s.begin(); s.page([session([])]); s.action('freeze'); s.action('finish')
    expect(s.execute({action:'read',scope:'test:1:chat',limit:40})).toBeDefined()
    s.execute({action:'ack',account:'test:1',sourceKey:'source:chat',through:1}); s.begin()
    expect(s.execute({action:'read',scope:'test:1:chat',limit:40})).toBeUndefined()
  } finally {s.close()}
})
it('retains observed read acknowledgements across later manifest pages and body responses', () => {
  const s=setup()
  try {
    s.begin();s.page([session([work()])]);s.action('freeze')
    s.execute({action:'ack',account:'test:1',sourceKey:'source:chat',through:2})
    s.page([session([body(work())])],false);s.action('finish');s.begin()
    s.page([session([work(),work('two',2)])]);s.action('freeze')
    expect(s.plan.progress).toMatchObject({total:0,pending:0})
    expect(s.execute({action:'read',scope:'test:1:chat',limit:40})).toBeUndefined()
    s.execute({action:'ack',account:'test:1',sourceKey:'source:new',through:9})
    s.page([session([work('new',9)],'new')]);
    expect(s.plan.progress.pending).toBe(0)
  } finally {s.close()}
})

it('keeps the foreground window allowance when unread bodies exceed the old shared cache budget', () => {
  const s=setup()
  const foreground = { source: {} as never, items: [], hasMore: false, unified: { protocolVersion: 1 as const, events: [], sources: [], complete: true, windowTokens: [], olderHasMore: false, newerHasMore: false, hasMore: false } }
  try {
    s.cache.write('reading', 'anchor', foreground)
    s.begin(); const works=Array.from({length:65},(_,i)=>work(`large-${i}`,i+1));s.page([session(works)]);s.action('freeze')
    for(const w of works) {
      const b=body(w);if(b.event?.kind==='message')b.event.item.textContent='x'.repeat(1024*1024)
      s.page([session([b])],false)
    }
    s.action('finish')
    expect(s.cache.read('reading','anchor')).toBeDefined()
    expect(s.cache.write('live','latest',foreground)).toBe(true)
    expect(s.cache.read('reading','anchor')).toBeDefined()
    const db=new DatabaseSync(join(s.path,TIMELINE_CACHE_FILE),{readOnly:true})
    const stats=db.prepare('SELECT metadata,bodies FROM message_sync_stats').get()!
    const actual=db.prepare('SELECT SUM(length(CAST(payload AS BLOB))) AS bodies FROM contents').get()!
    expect(Number(stats.bodies)).toBeGreaterThan(64*1024*1024)
    expect(stats.bodies).toBe(actual.bodies)
    db.close();s.reopen()
    expect(s.cache.read('reading','anchor')).toBeDefined()
    s.execute({action:'ack',account:'test:1',sourceKey:'source:chat',through:65});s.begin()
    const clean=new DatabaseSync(join(s.path,TIMELINE_CACHE_FILE),{readOnly:true})
    expect(clean.prepare('SELECT bodies FROM message_sync_stats').get()!.bodies).toBe(0);clean.close()
  } finally {s.close()}
},30000)
