import { createHmac, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import { createArkmeHostApi } from '../src/host-api.js'
import { dshAgentInputRecordUid } from '../src/dsh-agent-input-sync.js'
import { ArkmeSearchSurface, RecordRow } from '../src/client/ArkmeSearchSurface.js'
import { ArkmeSdk } from '../src/sdk/index.js'
import { arkmeSourceIdentityKey } from '../src/client/source-identity.js'

const bridge = vi.hoisted(() => ({ call: vi.fn(), has: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: bridge.call, ArkmeClientError: class extends Error {} }))
vi.mock('../src/client/DeepSeekHarnessSurface.js', () => ({ hasEmbeddedDshSession: bridge.has }))

// Run only against the disposable record E2E stack, never a user's account or archive.
it.skipIf(!process.env.ARKME_RECORD_E2E_URL).each([false, true])('search UI and SDK cross real HTTP without persisted origins: local=%s', async local => {
  const base = new URL(process.env.ARKME_RECORD_E2E_URL!)
  if (base.hostname !== '127.0.0.1' || base.protocol !== 'http:') throw new Error('isolated loopback backend required')
  const userId = 99101
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ user_id: userId, client_id: 99101 })}`
  const accessToken = `${payload}.${createHmac('sha256', 'record-e2e-access-token-secret').update(payload).digest('base64url')}`
  const session = { userId, accessToken, refreshToken: 'isolated-test' }
  const sessionId = `review-${randomUUID()}`
  const recordUid = dshAgentInputRecordUid(sessionId, 7)
  const query = `review${randomUUID().replaceAll('-', '')}`
  const result = await fetch(new URL('/api/v1/records/dsh-agent-input/create', base), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ record_uid: recordUid, template_kind: 1, text_content: query, send_at: Date.now() }),
  }).then(response => response.json())
  expect(result.code).toBe(0)
  const config = { environment: 'test', recordBaseUrl: base.origin, routePath: '/arkme-self/api',
    authBaseUrl: base.origin, subjectBaseUrl: base.origin, chatBaseUrl: base.origin, botBaseUrl: base.origin,
    imBaseUrl: base.origin, webrtcBaseUrl: base.origin, worldBaseUrl: base.origin, relationBaseUrl: base.origin,
    intelligentBaseUrl: base.origin, audioBaseUrl: base.origin, requestTimeoutMs: 5000, maxTextLength: 20000,
    geetestCaptchaId: 'fixture' } satisfies ArkmeServiceConfig
  const service = new ArkmeService(config, { read: async () => session, write: async () => {}, delete: async () => {} },
    { uniqueCode: async () => 'isolated-search-e2e', cachedSnapshot: async () => undefined } as never, undefined, undefined, undefined, undefined, undefined,
    () => ({ listSessions: async () => local ? [{ header: { id: sessionId, cwd: '/fixture' } }] : [],
      filterEvents: async () => [{ sessionId, seq: 7, type: 'user/message', surface: 'current' }] }))
  const server = createServer(createArkmeHostApi(service, { expectedPort: 0 }))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address() as { port: number }
  const fetchHost: typeof fetch = (input, init) => fetch(new URL(String(input), `http://127.0.0.1:${address.port}`), init)
  const sdk = new ArkmeSdk({ fetchImpl: fetchHost })
  let renderer: ReactTestRenderer | undefined
  try {
    const hits = await sdk.searchRemote(query, { limit: 20 })
    if (local) expect(hits.items[0]?.dshOrigin).toEqual({ sessionId, eventSeq: 7 })
    else expect(hits.items[0]).not.toHaveProperty('dshOrigin')
    expect(hits.items[0]?.targetSource?.kind).toBe('topic')
    const directory = await service.listSources('send_to_self', { limit: 100 })
    const target = hits.items[0]!.targetSource!
    expect(target.topicHierarchyKey).toBeTruthy()
    expect(directory.items.some(item => item.kind === 'topic' && arkmeSourceIdentityKey(item) === arkmeSourceIdentityKey(target))).toBe(true)
    bridge.has.mockResolvedValue(local)
    bridge.call.mockImplementation(async (operation, params, signal) => {
      const response = await fetchHost('/arkme-self/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, params }), signal })
      const envelope = await response.json()
      if (!envelope.ok) throw new Error(envelope.error.message)
      return envelope.value
    })
    const openDsh = vi.fn()
    const opened = vi.fn(async (item) => {
      const page = await bridge.call('source.timeline', { sourceRef: item.targetSource.sourceRef, limit: 100 })
      expect(page.source.kind).toBe('topic')
      expect(page.source.topicKind).toBe(3)
      expect(page.items.some((row: { itemUid: string }) => row.itemUid === recordUid)).toBe(true)
    })
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
      addEventListener: vi.fn(), removeEventListener: vi.fn() })
    await act(async () => { renderer = create(<ArkmeSearchSurface variant="dialog" initialQuery={query} onOpenRecord={opened} onOpenDshSession={openDsh} onClose={() => {}} />) })
    await act(async () => { renderer!.root.findByProps({ "aria-label": "搜索" }).props.onChange({ target: { value: query } }) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1000)) })
    const row = renderer!.root.findAllByType(RecordRow).find(node => node.props.item.recordUid === recordUid)
    expect(row).toBeDefined()
    await act(async () => { await row!.props.onClick(); await new Promise(resolve => setTimeout(resolve, 300)) })
    if (local) { expect(openDsh).toHaveBeenCalledWith(sessionId); expect(opened).not.toHaveBeenCalled() }
    else { expect(opened).toHaveBeenCalledOnce(); await opened.mock.results[0]!.value }
  } finally {
    if (renderer) await act(async () => { renderer!.unmount() })
    vi.unstubAllGlobals()
    service.dispose()
    server.closeAllConnections(); server.close(); await once(server, 'close')
  }
}, 20000)
