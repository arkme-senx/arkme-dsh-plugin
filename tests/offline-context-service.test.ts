import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
import { OfflineContextService } from '../src/services/offline-context-service.js'
import type { ServiceRuntime, StateStore } from '../src/services/service.js'
import type { OfflineContextList, OfflineContextPreview } from '../src/offline-context-contract.js'
import { parseOwnerJson } from '../src/record-owner-id.js'

const databases: ArkmeLocalDatabase[] = []
const directories: string[] = []
afterEach(async () => { for (const db of databases.splice(0)) db.close(); await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
const source = { openSourceRef: vi.fn(async () => ({ kind: 'group_chat' as const, ownerRef: 'private-chat-id', displayName: '项目群' })), sealSourceRef: vi.fn(async () => 'source-ref') }
const association = { id: 'private-association', revision: 2, chat_session_uid: 'private-chat-id', state: 'linked', occurred_start: 1000, occurred_end: 2000, title: '测算讨论', summary: '尚未确认', reason: '回复测算问题', evidence: [{ id: 'private-evidence', version: 'asr-version', occurred_start: 1000, occurred_end: 2000, text: ' A🙂尚未确认 ', from: 2, to: 7, sound_source: 'unknown', contains_playback: false }], messages: [{ chat_session_uid: 'private-chat-id', relation_uid: 'private-relation', record_uid: 'private-record', record_owner: 8, occurred_at: 900, quote: '测算完成了吗？' }] }
it('keeps a Bot owner exact across timeline references, association reads and message anchors', async () => {
  const f = await fixture()
  const owner = '6690025278483443577'
  const ref = await f.service.messageReference('private-chat-id', 'private-relation', 'private-record', owner)
  expect(await f.service.messageAnchor(ref, 'private-chat-id')).toEqual({ record_uid: 'private-record', record_owner_user_id: owner })
  await expect(f.service.messageAnchor(ref, 'another-chat')).rejects.toThrow()
  const raw = parseOwnerJson(JSON.stringify(association).replace('"record_owner":8', `"record_owner":${owner}`))
  f.post.mockImplementation(async path => path.endsWith('/capability')
    ? { supported: true, version: 1, timeline_version: 2 } : { items: [raw], has_more: false })
  const page = await f.service.offlineContext({ operation: 'list', sourceRef: 'source-ref' }) as OfflineContextList
  expect(page.entries[0]?.messages[0]?.messageRef).toBe(ref)
  await expect(f.service.messageReference('private-chat-id', 'private-relation', 'private-record', Number(owner))).rejects.toThrow()
  f.service.dispose()
})
it('keeps the offline-context identifier boundary without blocking readable messages', async () => {
  const f = await fixture()
  try {
    const boundary = 'x'.repeat(200)
    const ref = await f.service.messageReference('private-chat-id', boundary, boundary, 8)
    expect(await f.service.messageAnchor(ref!, 'private-chat-id')).toEqual({ record_uid: boundary, record_owner_user_id: 8 })
    for (const ids of [['private-chat-id', 'r'.repeat(201), boundary], ['private-chat-id', boundary, 'm'.repeat(201)]]) {
      expect(await f.service.messageReference(ids[0]!, ids[1]!, ids[2]!, 8)).toBeUndefined()
    }
    await expect(f.service.messageReference('private-chat-id', '', boundary, 8)).rejects.toMatchObject({ code: 'offline-context-invalid' })
    await expect(f.service.messageReference('private-chat-id', boundary, boundary, 0)).rejects.toMatchObject({ code: 'offline-context-invalid' })
  } finally { f.service.dispose() }
})
async function fixture(invalidateProjection?: (userId: number) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'offline context scope ')); directories.push(directory)
  const store = new ArkmeStateStore(directory)
  const database = new ArkmeLocalDatabase(directory, store); databases.push(database)
  let user = 7
  const post = vi.fn(async (path: string, body: Record<string, unknown>): Promise<unknown> => {
    if (path.endsWith('/capability')) return { supported: true, version: 1, timeline_version: 2 }
    if (path.endsWith('/list')) return { items: [association], has_more: false }
    if (path.endsWith('/read')) return association
    if (path.endsWith('/preview')) return { token: 'private-backend-preview', expires_at: Date.now() + 60000, body: { title: '服务端冻结标题', summary: '服务端冻结摘要', transcript: ['🙂尚未确认'] } }
    if (path.endsWith('/result')) return { request_id: body.request_id, outcome: 'unknown' }
    throw new Error('lost acknowledgement')
  })
  const runtime = { stateStore: database as unknown as StateStore, config: { environment: 'test' }, requireSession: async () => ({ userId: user, refreshToken: 'fixture-session' }), subscribeAccountScope: () => () => {}, authenticatedChatPost: post } as unknown as ServiceRuntime
  return { directory, store, runtime, post, switchUser: (id: number) => { user = id }, service: new OfflineContextService(runtime, source, undefined, invalidateProjection) }
}
it('projects exact Unicode evidence without exposing internal ids or inventing speaker identities', async () => {
  const f = await fixture()
  const page = await f.service.offlineContext({ operation: 'list', sourceRef: 'source-ref' }) as OfflineContextList
  const entry = page.entries[0]!
  expect(entry.evidence[0]?.text).toBe('🙂尚未确认')
  expect(entry.conversationKind).toBe('group_chat')
  expect(entry.participants).toEqual([])
  expect(JSON.stringify(page)).not.toContain('private-')
  expect(await f.service.offlineContext({ operation: 'read', entryRef: entry.id })).toMatchObject({ conversationKind: 'group_chat' })
  f.switchUser(9)
  await expect(f.service.offlineContext({ operation: 'read', entryRef: entry.id })).rejects.toThrow()
  f.service.dispose()
})
it('keeps passive recovery read-only and replays the exact command only on explicit retry', async () => {
  const f = await fixture(), page = await f.service.offlineContext({ operation: 'list', sourceRef: 'source-ref' }) as OfflineContextList
  const entry = page.entries[0]!, cmd = { entryRef: entry.id, revision: entry.revision, requestId: 'command-1', action: 'dismiss' as const, reason: 'remove' as const }
  expect(await f.service.offlineContext({ operation: 'command', command: cmd })).toEqual({ requestId: 'command-1', outcome: 'unknown' })
  expect(Object.keys(await f.store.readOfflineContextJournal('test:7'))).toEqual(['command:command-1'])
  expect(await readFile(join(f.directory, 'state.json'), 'utf8')).not.toContain('private-association')
  f.service.dispose()
  const restarted = new OfflineContextService({ ...f.runtime, stateStore: new ArkmeStateStore(f.directory) as unknown as StateStore }, source)
  expect(await restarted.offlineContext({ operation: 'pending' })).toEqual([expect.objectContaining({ requestId: 'command-1', outcome: 'unknown' })])
  expect(f.post.mock.calls.filter(([path]) => path.endsWith('/apply'))).toHaveLength(1)
  const original = f.post.mock.calls.find(([path]) => path.endsWith('/apply'))![1]
  f.post.mockImplementation(async (path, body) => {
    if (path.endsWith('/capability')) return { supported: true, version: 1, timeline_version: 2 }
    if (path.endsWith('/result')) return { request_id: body.request_id, outcome: 'unknown' }
    if (path.endsWith('/apply')) {
      expect(body).toEqual(original)
      return { request_id: body.request_id, outcome: 'applied', revision: 3 }
    }
    throw new Error('unexpected request')
  })
  expect(await restarted.offlineContext({ operation: 'command', command: { action: 'retry', entryRef: entry.id, revision: entry.revision, requestId: cmd.requestId } })).toMatchObject({ outcome: 'applied', revision: '3' })
  expect(f.post.mock.calls.filter(([path]) => path.endsWith('/apply'))).toHaveLength(2)
  expect(await new ArkmeStateStore(f.directory).readOfflineContextJournal('test:7')).toEqual({})
  f.switchUser(8)
  expect(await restarted.offlineContext({ operation: 'pending' })).toEqual([])
  restarted.dispose()
})
it('shares only the frozen preview and registers recovery before transmitting', async () => {
  const f = await fixture(), page = await f.service.offlineContext({ operation: 'list', sourceRef: 'source-ref' }) as OfflineContextList
  const entry = page.entries[0]!
  const preview = await f.service.offlineContext({ operation: 'preview', entryRef: entry.id, revision: entry.revision, includeTranscript: true }) as OfflineContextPreview
  expect(preview).toMatchObject({ title: '服务端冻结标题', summary: '服务端冻结摘要', transcript: ['🙂尚未确认'] })
  expect(JSON.stringify(preview)).not.toContain('private-backend-preview')
  f.post.mockImplementation(async (path, body) => {
    if (!path.endsWith('/share')) throw new Error('unexpected')
    expect(Object.keys(await f.store.readOfflineContextJournal('test:7'))).toContain('command:share-1')
    expect(body).toEqual({ preview_token: 'private-backend-preview', request_id: 'share-1' })
    return { request_id: 'share-1', outcome: 'pending', revision: 3 }
  })
  expect(await f.service.offlineContext({ operation: 'command', command: { action: 'share', entryRef: entry.id, revision: entry.revision, requestId: 'share-1', previewRef: preview.previewRef } })).toEqual({ requestId: 'share-1', outcome: 'pending', revision: '3' })
  f.service.dispose()
})

it('loads current range options and maps Unicode boundaries without accepting caller text', async () => {
  const f = await fixture()
  const page = await f.service.offlineContext({ operation: 'list', sourceRef: 'source-ref' }) as OfflineContextList
  const entry = page.entries[0]!
  f.post.mockImplementation(async(path, body) => {
    if (path.endsWith('/range-options')) return {revision:2,selected_evidence_ids:[],evidence:[{...association.evidence[0], id:'restored-speech',version:'fresh-version',text:'甲🙂乙丙',from:0,to:4}]}
    if (path.endsWith('/apply')) {
      expect(body.selections).toEqual([{evidence_id:'restored-speech',version:'fresh-version',from:1,to:3}])
      return {request_id:body.request_id,outcome:'applied',revision:3}
    }
    throw new Error('unexpected request')
  })
  const range = await f.service.offlineContext({operation:'range-options',entryRef:entry.id,revision:entry.revision}) as import('../src/offline-context-contract.js').OfflineContextRangeOptions
  expect(range.evidence[0]?.text).toBe('甲🙂乙丙')
  expect(JSON.stringify(range)).not.toContain('restored-speech')
  const command = {action:'range' as const,requestId:'range-1',entryRef:entry.id,revision:entry.revision,evidenceRefs:[range.evidence[0]!.id],startOffset:1,endOffset:3}
  expect(await f.service.offlineContext({operation:'command',command})).toMatchObject({outcome:'applied'})
  await expect(f.service.offlineContext({operation:'command',command:{...command,requestId:'range-2',endOffset:5}})).rejects.toThrow()
  expect(f.post.mock.calls.filter(([path])=>path.endsWith('/apply'))).toHaveLength(1)
  f.service.dispose()
})

it('replays an uncertain share from the encrypted journal without changing its preview or recipient', async () => {
  const f = await fixture()
  const page = await f.service.offlineContext({ operation: 'list', sourceRef: 'source-ref' }) as OfflineContextList
  const entry = page.entries[0]!
  const preview = await f.service.offlineContext({ operation: 'preview', entryRef: entry.id, revision: entry.revision, includeTranscript: true }) as OfflineContextPreview
  const requestId = 'lost-share'
  await f.service.offlineContext({ operation: 'command', command: { action: 'share', entryRef: entry.id, revision: entry.revision, requestId, previewRef: preview.previewRef } })
  const original = f.post.mock.calls.find(([path]) => path.endsWith('/share'))![1]
  f.post.mockImplementation(async (path, body) => {
    if (path.endsWith('/result')) return { request_id: requestId, outcome: 'unknown' }
    if (path.endsWith('/share')) {
      expect(body).toEqual(original)
      return { request_id: requestId, outcome: 'pending', revision: 3 }
    }
    throw new Error('unexpected')
  })
  expect(await f.service.offlineContext({ operation: 'command', command: { action: 'retry', requestId, entryRef: entry.id, revision: '99' } })).toMatchObject({ outcome: 'pending' })
  expect(Object.keys(await f.store.readOfflineContextJournal('test:7'))).toContain('command:lost-share')
  f.service.dispose()
})

it('never converts a retired receipt or a retry failure into proof that the original write was not applied', async () => {
  const f = await fixture()
  const page = await f.service.offlineContext({ operation: 'list', sourceRef: 'source-ref' }) as OfflineContextList
  const entry = page.entries[0]!, command = { action: 'confirm' as const, requestId: 'retired', entryRef: entry.id, revision: entry.revision }
  await f.service.offlineContext({ operation: 'command', command })
  expect(await f.service.offlineContext({ operation: 'command', command: { ...command, action: 'retry' } })).toMatchObject({ outcome: 'unknown' })
  expect(Object.keys(await f.store.readOfflineContextJournal('test:7'))).toContain('command:retired')
  await expect(f.service.offlineContext({ operation: 'command', command: { ...command, action: 'restore' } })).rejects.toThrow()
  f.switchUser(8)
  await expect(f.service.offlineContext({ operation: 'command', command: { ...command, action: 'retry' } })).rejects.toThrow()
  f.service.dispose()
})

it('invalidates Host timeline after a completed command even without a mounted card', async () => {
 const invalidate = vi.fn(async () => {})
 const f = await fixture(invalidate)
 const entry = (await f.service.offlineContext({operation:'list',sourceRef:'source-ref'}) as OfflineContextList).entries[0]!
 const original = f.post.getMockImplementation()!
 f.post.mockImplementation(async (path,body) => path.endsWith('/apply') ? {request_id:body.request_id,outcome:'applied',revision:3} : original(path,body))
 await f.service.offlineContext({operation:'command',command:{action:'confirm',entryRef:entry.id,revision:entry.revision,requestId:'native-confirm'}})
 expect(invalidate).toHaveBeenCalledExactlyOnceWith(7)
 f.service.dispose()
})

it('projects the authoritative current selection into opaque range references', async () => {
  const f = await fixture()
  const page = await f.service.offlineContext({ operation: 'list', sourceRef: 'source-ref' }) as OfflineContextList
  const entry = page.entries[0]!
  const option = association.evidence[0]!
  let selected: string[] = [option.id]
  f.post.mockImplementation(async () => ({ revision: 2, evidence: [option], selected_evidence_ids: selected }))
  const request = { operation: 'range-options' as const, entryRef: entry.id, revision: entry.revision }
  const range = await f.service.offlineContext(request) as import('../src/offline-context-contract.js').OfflineContextRangeOptions
  expect(range.selectedEvidenceIds).toEqual([range.evidence[0]!.id])
  expect(JSON.stringify(range)).not.toContain(option.id)
  selected = ['not-an-option']
  await expect(f.service.offlineContext(request)).rejects.toThrow()
  selected = [option.id, option.id]
  await expect(f.service.offlineContext(request)).rejects.toThrow()
  f.service.dispose()
})

it.each([
  ['第一条结论。\n第二条🙂结论。', ['第一条结论。', '第二条🙂结论。']],
  ['单条结论。', ['单条结论。']],
  ['\r\n保留  原文空格。\r\n\r\n第二条。\r\n', ['保留  原文空格。', '第二条。']],
])('preserves backend summary points in the original card projection: %s', async (summary, points) => {
  const f = await fixture()
  f.post.mockImplementation(async path => {
    if (path.endsWith('/capability')) return { supported: true, version: 1, timeline_version: 2 }
    if (path.endsWith('/list')) return { items: [{ ...association, summary }], has_more: false }
    throw new Error('unexpected request')
  })
  const page = await f.service.offlineContext({ operation: 'list', sourceRef: 'source-ref' }) as OfflineContextList
  expect(page.entries[0]!.summary).toEqual(points)
  f.service.dispose()
})

it('filters linked entries by scoped message references and binds pagination to the same filter', async () => {
  const f = await fixture()
  const ref = await f.service.messageReference('private-chat-id', 'private-relation', 'private-record', 8)
  const other = await f.service.messageReference('other-chat', 'private-relation', 'private-record', 8)
  f.post.mockImplementation(async (path, body) => {
    if (path.endsWith('/capability')) return { supported: true, version: 1, timeline_version: 2 }
    expect(body.message_uids).toEqual(['private-relation'])
    return { items: [association], has_more: true, next: { at: 1000, id: 'private-association' } }
  })
  const request = { operation: 'list' as const, sourceRef: 'source-ref', state: 'linked' as const, messageRefs: [ref] }
  const page = await f.service.offlineContext(request) as OfflineContextList
  expect(page.entries[0]?.messages[0]?.messageRef).toBe(ref)
  expect(JSON.stringify(page)).not.toContain('private-')
  await f.service.offlineContext({ ...request, cursor: page.nextCursor! })
  const count = f.post.mock.calls.length
  await expect(f.service.offlineContext({ ...request, messageRefs: [other] })).rejects.toThrow()
  await expect(f.service.offlineContext({ operation: 'list', sourceRef: 'source-ref', state: 'linked', cursor: page.nextCursor! })).rejects.toThrow()
  await expect(f.service.offlineContext({ ...request, messageRefs: [] })).rejects.toThrow()
  expect(f.post.mock.calls).toHaveLength(count)
  f.switchUser(9)
  await expect(f.service.offlineContext(request)).rejects.toThrow()
  f.service.dispose()
})
