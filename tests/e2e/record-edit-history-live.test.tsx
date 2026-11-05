import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { ServiceRuntime, type ArkmeServiceConfig } from '../../src/services/service.js'
import { ArkmeStateStore } from '../../src/state-store.js'
import { SourceService } from '../../src/services/source-service.js'
import { MediaService } from '../../src/services/media-service.js'
import { ChatService } from '../../src/services/chat-service.js'
import { RecordService } from '../../src/services/record-service.js'
import { RecordEditHistoryService } from '../../src/services/record-edit-history-service.js'
import { ArkmeService } from '../../src/arkme-service.js'
import { createArkmeHostApi } from '../../src/host-api.js'
import { createArkmeSdk } from '../../src/sdk/index.js'
import { createArkmeCoreToolDefinitions } from '../../src/tools/index.js'
import { ArkmeSurface } from '../../src/client/ArkmeSidebar.js'
import { ArkmeRichComposerInput } from '../../src/client/ArkmeRichComposerInput.js'
import { ArkmeRecordEditHistory } from '../../src/client/ArkmeRecordEditHistory.js'
import { arkmeAuthStore } from '../../src/client/auth-store.js'
import { arkmeChatDirectory, arkmeChatTimelineDelta } from '../../src/client/chat-directory-store.js'
import { arkmeUi } from '../../src/client/ui-controller.js'
import { recordReeditBackground } from '../../src/client/record-reedit-background.js'
import { arkmeMessageReadReceipts } from '../../src/client/message-read-receipt-store.js'
import type { ArkmeSourceItem, ArkmeTimelineItem } from '../../src/types.js'

const transport = vi.hoisted(() => {
  const fetch = globalThis.fetch
  let origin = 'http://127.0.0.1'
  globalThis.fetch = (url, init) => fetch(new URL(String(url), origin), init)
  return { fetch, base(value: string) { origin = value }, shell: undefined as undefined | ((op: string, p?: any, signal?: AbortSignal) => Promise<unknown>) }
})
// Shell directory/timeline fixtures only. All edit, draft, receipt, history and
// snapshot operations pass through the actual public SDK and Host HTTP.
vi.mock('../../src/client/api.js', async original => {
  const actual = await original<typeof import('../../src/client/api.js')>()
  return { ...actual, callArkme: (op: string, p?: any, signal?: AbortSignal) => op.startsWith('source.record-')
    ? actual.callArkme(op as never, p, signal) : transport.shell!(op, p, signal) }
})
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }))
vi.mock('../../src/client/recordings/recording-import-journal.js', async original => ({
  ...await original<typeof import('../../src/client/recordings/recording-import-journal.js')>(),
  createImportJournal: () => ({ list: async () => [], change: async () => undefined }),
}))
vi.mock('../../src/client/ArkmeMessageUnderlines.js', () => ({ useMessageUnderlines: () => ({ layer: null }) }))
vi.mock('../../src/client/ArkmeMessageTextSelection.js', async original => ({
  ...await original<typeof import('../../src/client/ArkmeMessageTextSelection.js')>(), ArkmeMessageTextSelectionToolbar: () => null,
}))
const fixture = process.env.JOTMO_RECORD_HISTORY_FRONTEND_FIXTURE
it.skipIf(!fixture)('shipped edit UI → Host → public Record → Chat history → shipped snapshot UI', async () => {
  const f = JSON.parse(readFileSync(fixture!, 'utf8'))
  for (const url of [f.chatUrl, f.recordUrl]) expect(new URL(url).hostname).toBe('127.0.0.1')
  const root = await mkdtemp(join(tmpdir(), 'record-history-live-'))
  const state = new ArkmeStateStore(root), requests: string[] = []
  const session = { userId: f.owner, accessToken: f.chatToken, refreshToken: 'isolated-only' }
  const config = { environment: 'test', chatBaseUrl: f.chatUrl, recordBaseUrl: f.recordUrl,
    authBaseUrl: 'http://127.0.0.1:1', requestTimeoutMs: 15000, maxTextLength: 40000, fileStateDirectory: root } as ArkmeServiceConfig
  const runtime = new ServiceRuntime(config, { read: async () => session, write: async () => {}, delete: async () => {} }, state, async (input, init) => {
    const url = new URL(String(input)); requests.push(url.pathname)
    // These isolated services deliberately use different JWT fixture secrets.
    const headers = new Headers(init?.headers)
    if (url.origin === f.recordUrl) headers.set('Authorization', `Bearer ${f.recordToken}`)
    return transport.fetch(input, { ...init, headers })
  })
  const profile = { sealProfileImageRef: async () => '', publicProfileSummariesByUserIds: async () => new Map() }
  const source = new SourceService(runtime, profile as never, {} as never)
  const media = new MediaService(runtime, {} as never, {} as never, {} as never)
  const chat = new ChatService(runtime, source, profile as never, media, {} as never, {} as never, {} as never, {} as never, {} as never)
  const record = new RecordService(runtime, media, source, undefined, undefined, undefined, undefined,
    async () => ({ nickname: 'frozen editor' }))
  const history = new RecordEditHistoryService(runtime, { projectPage: async (snapshots, target, signal) => {
    const pages = await media.hydrateRecordSnapshotMediaPage(snapshots, session, target.kind === 'chat' ? target : undefined, signal)
    return snapshots.map((snapshot, i) => ({ title: String(snapshot.title ?? ''), textContent: String(snapshot.text_content),
      contentBlocks: media.richContentBlocks(snapshot, session.userId, pages[i]) }))
  } })
  const owner = { config, runtime, chat, recordEditHistory: history, record, relatedRecording: { isEnabled: () => false } }
  const facade = { ...owner, providerCapabilities: ArkmeService.prototype.providerCapabilities,
    recordEditHistoryPage: ArkmeService.prototype.recordEditHistoryPage.bind(owner as never),
    recordRevisionSnapshot: ArkmeService.prototype.recordRevisionSnapshot.bind(owner as never),
    recordReeditEditor: record.recordReeditEditor.bind(record), saveRecordReeditDraft: record.saveRecordReeditDraft.bind(record),
    submitRecordReedit: record.submitRecordReedit.bind(record), recordReeditSubmissions: record.recordReeditSubmissions.bind(record),
    resumeRecordReeditSubmissions: record.resumeRecordReeditSubmissions.bind(record), acknowledgeRecordReeditSubmission: record.acknowledgeRecordReeditSubmission.bind(record) }
  const sourceRef = await source.sealSourceRef(f.owner, 'private_chat', f.session, 'history acceptance')
  const secret = await state.uniqueCode()
  const actionRef = (chat as any).sealMessageActionRef((chat as any).messageActionRefPayload({ sourceKind: 'chat_relation', userId: f.owner,
    sourceOwnerRef: f.session, chatSessionUid: f.session, relationUid: f.relation, recordOwnerUserId: f.owner, recordUid: f.record,
    senderUserId: f.owner, senderName: '我', title: '', textContent: f.text, textFormat: 'plain', sendAtMillis: 1, sourceSequence: f.sequence,
    templateKind: 1, displayKind: 0 }), secret)
  let handler: ReturnType<typeof createArkmeHostApi>
  const server = createServer((req, res) => void handler(req, res)); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  handler = createArkmeHostApi(facade as never, { expectedPort: port, allowNonLoopback: false })
  transport.base(`http://127.0.0.1:${port}`)
  const sdk = createArkmeSdk({ fetchImpl: (url, init) => transport.fetch(new URL(String(url), `http://127.0.0.1:${port}`), init) })
  const sourceItem: ArkmeSourceItem = { sourceRef, sourceKey: `chat:${f.session}`, kind: 'private_chat', displayName: 'history acceptance', activeAtMillis: 1, latestSequence: 1, unreadCount: 0 }
  const item: ArkmeTimelineItem = { itemUid: f.record, messageActionRef: actionRef, textContent: f.text, title: '', senderName: '我', isMe: true,
    sendAtMillis: 1, templateKind: 1, recordVersion: f.version, status: 1 }
  transport.shell = async (op, p) => {
    if (op === 'user.profile.refresh') return { profile: { userId: f.owner, contact: { phoneMasked: '138****0000' } } }
    if (op === 'source.timeline' && p?.cursor?.unified?.cacheOnly) throw new Error('empty isolated cache')
    if (op === 'source.timeline') return { source: sourceItem, items: [item], hasMore: false }
    if (op === 'sources.list') return { directory: 'root', items: [sourceItem], hasMore: false }
    if (op === 'source.members') return { source: sourceItem, items: [], total: 0, activeCount: 0 }
    if (op === 'source.interwoven-moments') return { state: 'disabled', moments: [], preparedAtMillis: 1 }
    if (op === 'source.related-quick-notes.from-message' || op === 'records.tags.list') return { items: [] }
    if (op === 'files.capabilities') return { version: 1, maxFileBytes: 10000, maxImageBytes: 10000, maxAttachments: 9 }
    throw new Error(`unrelated shell operation ${op}`)
  }
  const storage = new Map<string, string>()
  const storageApi = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) }
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, setInterval, clearInterval, innerHeight: 900, localStorage: storageApi, sessionStorage: storageApi })
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {})
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: f.owner })
  arkmeChatDirectory.activateAccount(f.owner); arkmeChatDirectory.publish([sourceItem]); arkmeUi.selectSource(sourceItem)
  arkmeMessageReadReceipts.activateAccount(f.owner)
  let view: ReactTestRenderer | undefined
  const wait = async (check: () => void) => vi.waitFor(async () => { await act(async () => {}); check() }, { timeout: 20000, interval: 100 })
  try {
    await act(async () => { view = create(<ArkmeSurface productChrome={false} productNavigation={false}/>, { createNodeMock: el => el.props.className === 'arkme-conversation-panel'
      ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) } : null }) })
    await wait(() => expect(view!.root.findAllByProps({ 'aria-label': '打开快记详情' })).toHaveLength(1))
    act(() => view!.root.findByProps({ 'aria-label': '打开快记详情' }).props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 120, clientY: 180 }))
    const entry = view!.root.findByProps({ 'aria-label': '消息操作' }).findAllByProps({ role: 'menuitem' }).find(n => n.findAllByType('span').some(s => s.children.includes('重新编辑')))!
    await act(async () => entry.props.onClick())
    await wait(() => {
      expect(view!.root.findByType(ArkmeRichComposerInput).props.value).toBe(f.text)
      expect(view!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.disabled).not.toBe(true)
    })
    act(() => view!.root.findByType(ArkmeRichComposerInput).props.onTextChange('edited through shipped UI'))
    await act(async () => view!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.onClick())
    try { await wait(() => expect(requests).toContain('/api/v1/records/update')) }
    catch (error) {
      console.log('UI submission states:', view!.root.findAll(n => n.props.role === 'alert' || n.props['aria-label'] === '重新编辑保存状态').map(n => n.children.filter(c => typeof c === 'string')))
      console.log('Host submission states:', (await record.recordReeditSubmissions(sourceRef)).map(j => ({ state: j.state, error: j.error })))
      throw error
    }
    let page = await sdk.recordEditHistory(sourceRef, actionRef)
    await vi.waitFor(async () => expect(await record.recordReeditSubmissions(sourceRef)).toEqual(expect.arrayContaining([expect.objectContaining({ state: 'committed' })])), { timeout: 20000 })
    page = await sdk.recordEditHistory(sourceRef, actionRef)
    expect(page.items[0]).toMatchObject({ version: 56, senderName: 'frozen editor', content: { textContent: 'edited through shipped UI' } })
    expect(page.items).toHaveLength(50); expect(page.hasMore).toBe(true)
    const older = await sdk.recordEditHistory(sourceRef, actionRef, page.nextCursorVersion)
    expect(older.items).toHaveLength(6); expect(older.hasMore).toBe(false)
    expect(new Set([...page.items, ...older.items].map(i => i.revisionUid)).size).toBe(56)
    const exact = await sdk.recordRevisionSnapshot(sourceRef, actionRef, page.items[1]!.revisionUid)
    expect(exact).toMatchObject({ textContent: 'history 54', editDurationMillis: 100, durationState: 'complete', captureContext: { clientName: 'historical device', electric: 0 } })
    const zero = await sdk.recordRevisionSnapshot(sourceRef, actionRef, page.items[2]!.revisionUid)
    expect(zero).toMatchObject({ textContent: 'history 53', editDurationMillis: 0, durationState: 'complete' })
    const tool = createArkmeCoreToolDefinitions(facade as never).find(t => t.name === 'arkme_record_history')!
    const output = JSON.stringify(await tool.execute({ source_ref: sourceRef, message_action_ref: actionRef, revision_uid: exact.revisionUid }, { callId: 'real-read', signal: new AbortController().signal } as never))
    expect(output).toContain('history 54'); expect(output).not.toContain('historical device')
    await act(async () => { view!.unmount(); view = create(<ArkmeRecordEditHistory sourceRef={sourceRef} messageActionRef={actionRef} author={{ isMe: true }}/>) })
    await wait(() => expect(view!.root.findAllByProps({ 'data-arkme-history-bubble': true }).length).toBe(50))
    const more = view!.root.findAllByType('button').find(n => n.children.includes('加载更多'))!
    await act(async () => more.props.onClick())
    await wait(() => expect(view!.root.findAllByProps({ 'data-arkme-history-bubble': true }).length).toBe(56))
    vi.stubGlobal('HTMLElement', class {})
    vi.stubGlobal('document', { body: {}, addEventListener() {}, removeEventListener() {} })
    act(() => view!.root.findAllByProps({ 'data-arkme-history-bubble': true })[1]!.props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 50, clientY: 50 }))
    const snapshotButton = view!.root.findAllByProps({ role: 'menuitem' }).find(n => JSON.stringify(n.children.map(c => typeof c === 'string' ? c : c.children)).includes('记忆快照'))!
    await act(async () => snapshotButton.props.onClick())
    await wait(() => expect(JSON.stringify(view!.toJSON())).toContain('historical device'))
    expect(requests).not.toContain('/api/v1/search/records/query')
    console.log('PASS: original re-edit menu/composer/save → durable Host write → real Record/Mongo → 56-version Chat pages → exact SDK/Tool → original history right-click memory dialog')
  } finally {
    await act(async () => view?.unmount()); record.dispose(); runtime.dispose(); sdk.dispose(); recordReeditBackground.clear()
    arkmeChatDirectory.clear(); arkmeChatTimelineDelta.publish([]); arkmeMessageReadReceipts.activateAccount(undefined)
    vi.unstubAllGlobals(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true })
  }
}, 120000)
