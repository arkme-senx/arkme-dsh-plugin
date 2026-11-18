// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomUUID, webcrypto } from 'node:crypto'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { SourceService } from '../../src/services/source-service.js'
import { ChatService } from '../../src/services/chat-service.js'
import { ArkmeService } from '../../src/arkme-service.js'
import { createArkmeHostApi } from '../../src/host-api.js'
import { createArkmeSdk } from '../../src/sdk/index.js'
import { createArkmeCoreToolDefinitions } from '../../src/tools/index.js'
import { MessageQuoteThreadsProvider, MessageQuoteThreadBadge } from '../../src/client/MessageQuoteThreads.js'
import { ArkmeMessageContent } from '../../src/client/ArkmeRichContent.js'
import { ArkmeTimelineDetailDrawer } from '../../src/client/ArkmeNoteDetails.js'
import { invalidateMessageQuoteSources } from '../../src/client/message-quote-invalidations.js'
import type { ArkmeTimelineItem } from '../../src/types.js'

const transport = vi.hoisted(() => {
  const nativeFetch = globalThis.fetch
  let base = 'http://127.0.0.1'
  // The browser SDK captures fetch on import, before the ephemeral HTTP port
  // exists. Route that real transport once the isolated Host is listening.
  globalThis.fetch = (url, init) => nativeFetch(new URL(String(url), base), init)
  return { nativeFetch, setBase(value: string) { base = value } }
})
const fixture = process.env.JOTMO_EXTENSION_SUMMARY_FRONTEND_FIXTURE
it.skipIf(!fixture)('cold original → real summary owner → badge → existing detail pages', async () => {
  const f = JSON.parse(readFileSync(fixture!, 'utf8'))
  for (const origin of [f.chatUrl, f.recordUrl]) expect(new URL(origin).hostname).toBe('127.0.0.1')
  const credentials = { userId: f.owner, accessToken: f.chatToken, refreshToken: 'isolated-only' }
  const secret = randomUUID(), requests: string[] = []
  const config = { environment: 'test', chatBaseUrl: f.chatUrl, recordBaseUrl: f.recordUrl, requestTimeoutMs: 15000, maxTextLength: 40000 } as ArkmeServiceConfig
  const nativeFetch = transport.nativeFetch
  const runtime = new ServiceRuntime(config, { read: async () => credentials, write: async () => {}, delete: async () => {} }, { uniqueCode: async () => secret } as StateStore,
    async (input, init) => { requests.push(new URL(String(input)).pathname); return nativeFetch(input, init) })
  // Auth/profile identity is synthetic; all summary, tree, version, privacy,
  // quote and lifecycle decisions come from the real Chat and Record owners.
  const profile = { sealProfileImageRef: async () => '', publicProfileSummariesByUserIds: async () => new Map(), refreshProfile: async () => ({ profile: { nickname: '我', displayName: '我', avatarRef: '' } }) }
  const source = new SourceService(runtime, profile as never, {} as never)
  const chat = new ChatService(runtime, source, profile as never, {} as never, {} as never, {} as never, {} as never, {} as never, { scheduleChatSessionProjection: () => {} } as never)
  const sourceRef = await source.sealSourceRef(f.owner, 'private_chat', f.session, 'summary acceptance')
  const actionRef = (chat as any).sealMessageActionRef((chat as any).messageActionRefPayload({ sourceKind: 'chat_relation', userId: f.owner, sourceOwnerRef: f.session, chatSessionUid: f.session,
    relationUid: f.relation, recordOwnerUserId: f.owner, recordUid: f.record, senderUserId: f.owner, senderName: '我', title: '', textContent: f.text, textFormat: 'plain', sendAtMillis: 1, sourceSequence: f.sequence, templateKind: 1, displayKind: 0 }), secret)
  const facade = { config, runtime, relatedRecording: { isEnabled: () => false }, providerCapabilities: ArkmeService.prototype.providerCapabilities,
    sourceMessageExtensionSummaries: chat.sourceMessageExtensionSummaries.bind(chat), sourceMessageExtensionContext: chat.sourceMessageExtensionContext.bind(chat),
    sourceRelatedQuickNotesFromMessage: async () => ({ items: [] }), sourceMessageThoughtContinuations: async () => ({ items: [] }) }
  let handler: ReturnType<typeof createArkmeHostApi>
  const server = createServer((req, res) => void handler(req, res)); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  transport.setBase(`http://127.0.0.1:${port}`)
  handler = createArkmeHostApi(facade as never, { expectedPort: port, allowNonLoopback: false })
  const hostFetch: typeof fetch = (url, init) => nativeFetch(new URL(String(url), `http://127.0.0.1:${port}`), init)
  const sdk = createArkmeSdk({ fetchImpl: hostFetch })
  vi.stubGlobal('fetch', hostFetch); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  const highlights = new Map<string, { ranges: Range[] }>()
  vi.stubGlobal('CSS', { highlights }); vi.stubGlobal('Highlight', class { ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges } })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 200, 100))
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const item: ArkmeTimelineItem = { itemUid: f.record, recordOwnerUserId: f.owner, recordVersion: 1, sequence: f.sequence, messageActionRef: actionRef, status: 1, title: '', textContent: f.text, senderName: '我', isMe: true, sendAtMillis: 1 }
  function Fixture() {
    const [opened, setOpened] = useState(false)
    return <MessageQuoteThreadsProvider scope="isolated-live-owner" sourceRef={sourceRef} chat items={[item]} onOpenComments={() => setOpened(true)}>
      <ArkmeMessageContent item={item} sourceRef={sourceRef}/><MessageQuoteThreadBadge item={item}/>
      {opened && <ArkmeTimelineDetailDrawer item={item} sourceRef={sourceRef} sourceKind="private_chat" canExtend={false} showOriginal={false} onClose={() => setOpened(false)} onToggleOriginal={() => {}}/>}
    </MessageQuoteThreadsProvider>
  }
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element)
  const wait = async (check: () => void) => vi.waitFor(async () => { await act(async () => {}); check() }, { timeout: 15000 })
  try {
    const wire = await sdk.sourceMessageExtensionSummaries(sourceRef, [actionRef])
    expect(wire[0]!.summary).toMatchObject({ commentCount: 126, quoteCount: 125, complete: true, accessible: true })
    expect(wire[0]!.summary.anchors).toHaveLength(1)
    const tool = createArkmeCoreToolDefinitions(facade as never).find(tool => tool.name === 'arkme_message_comments_summary')!
    expect(tool).toBeDefined()
    expect(JSON.stringify(await tool.execute({ source_ref: sourceRef, message_action_ref: actionRef }, { callId: 'live-read', signal: new AbortController().signal } as never))).toContain('126')
    await act(async () => root.render(<Fixture/>))
    await wait(() => expect(element.querySelector('[data-arkme-quote-comments]')?.textContent).toContain('126'))
    await wait(() => expect([...highlights.values()].flatMap(value => value.ranges).some(range => range.toString() === '可以' && range.startOffset === 3)).toBe(true))
    expect(requests).not.toContain('/api/v1/chats/extensions/tree/page')
    await act(async () => (element.querySelector('[data-arkme-quote-comments]') as HTMLButtonElement).click())
    await wait(() => expect(document.querySelector('[data-arkme-note-extension-count]')?.textContent).toContain('126'))
    await wait(() => expect(requests.filter(path => path === '/api/v1/chats/extensions/tree/page').length).toBeGreaterThanOrEqual(2))
    await wait(() => expect(document.querySelectorAll('[data-arkme-note-extension-item]')).toHaveLength(126))
    expect(document.body.textContent).not.toContain('延展加载失败')
    console.log('PASS: cold PC summary + exact second occurrence underline + badge opens shipped detail + 126 real replies in existing two-page owner; SDK and Tools use the same authenticated Host HTTP')
  } finally {
    sdk.dispose(); runtime.dispose(); await act(async () => root.unmount()); element.remove(); invalidateMessageQuoteSources(); vi.restoreAllMocks(); vi.unstubAllGlobals()
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
}, 120000)
