// Manual browser QA: serve a real, installed DSH UI while replacing only Arkme Host responses.
// All Arkme API paths are intercepted; this fixture cannot forward a business write upstream.
// Usage: node tests/fixtures/private-chat-actions-browser.mjs http://127.0.0.1:<isolated-dsh-port>
import http from 'node:http'
import net from 'node:net'
import { WebSocketServer } from 'ws'

const upstream = new URL(process.argv[2])
if (upstream.hostname !== '127.0.0.1' || upstream.protocol !== 'http:') throw new Error('Use an isolated loopback DSH')
let staff = true; let delay = 0; let failure = false; let unknownBan = false
let ownRefused = false; let revision = Date.now(); let banned = false
const calls = []
const source = { sourceRef: 'fixture-private', sourceKey: 'chat:fixture-private', kind: 'private_chat',
  displayName: '菜单验收联系人', peerUserId: 42, activeAtMillis: Date.now(), unreadCount: 0,
  latestPreview: '仅本地测试数据', latestSequence: 0, directMessageAdmissionApplicable: true }
const admission = () => ({ ownRefused, ownRevision: revision, counterpartRefused: false, counterpartRevision: 0,
  state: ownRefused ? 'refused_by_self' : 'allowed', canSend: !ownRefused, refusalCreationEnabled: true })
const profile = () => ({ profile: { userId: 7, displayName: '菜单验收账号', nickname: '菜单验收账号', avatarRef: '',
  arkmeId: 'menu-test', accountType: staff ? 2 : 1, createdAt: 1,
  bindings: { apple: false, wechat: false, google: false }, contact: {} }, cachedAtMillis: Date.now(), revision: 1 })
const record = () => ({ sourceRef: source.sourceRef, displayName: source.displayName, status: banned ? 'banned' : 'unbanned',
  remark: '', bannedAtMillis: 1, unbannedAtMillis: 0, updatedAtMillis: Date.now() })
const json = (response, value, status = 200) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)) }

async function operation(name, params) {
  if (name === 'calls.outgoing.intent.claim') return null
  if (name === 'arko.profile') return { displayName: 'Arko', version: 1 }
  if (name === 'files.send.tasks') return []
  if (name === 'source.record-reedit.resume') return null
  if (name === 'auth.status') return { status: 'authenticated', environment: 'test', userId: 7 }
  if (name === 'auth.config') return { captchaId: '', environment: 'test', testLoginEnabled: false,
    jiwoScanLoginEnabled: false, callAssetBasePath: '', voiceprintEnrollmentPath: '', recordingImportPath: '',
    mediaPath: '/arkme-self/api/media', shareWebsite: '', recordingWorkbenchEnabled: true }
  if (name === 'provider.instance') return { instanceId: 'private-menu-fixture' }
  if (name === 'user.profile' || name === 'user.profile.refresh') return profile()
  if (name === 'sources.list') return { directory: params.directory ?? 'root', items: [source], hasMore: false }
  if (name === 'directory.list') return { items: [], total: 0, hasMore: false }
  if (name === 'bots.list') return { items: [], hasMore: false }
  if (name === 'source.timeline') return { source, items: [], hasMore: false }
  if (name === 'source.members.cached') return null
  if (name === 'source.members.page') return { kind: 'membership', source, selfRole: 'member', items: [],
    joinEvents: [], hasMore: false, removedMemberRefs: [] }
  if (name === 'source.interwoven-moments') return { state: 'disabled', moments: [], preparedAtMillis: Date.now() }
  if (name === 'chat.direct-message-admission') return admission()
  if (name === 'chat.direct-message-refusal.set') {
    if (params.expectedRevision !== revision) throw new Error('fixture revision conflict')
    ownRefused = params.refused; revision += 1; return admission()
  }
  if (name === 'related-recordings.eligibility' || name === 'user-ban.status') {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    if (failure) throw new Error('模拟网络失败')
    return name === 'related-recordings.eligibility' ? { allowed: true }
      : { sourceRef: source.sourceRef, displayName: source.displayName, exists: banned, banned }
  }
  if (name === 'user-ban.ban' || name === 'user-ban.unban') {
    if (!staff) throw new Error('fixture permission denied')
    banned = name === 'user-ban.ban'
    if (unknownBan) { unknownBan = false; throw new Error('模拟事实已写入，投影发布失败') }
    return record()
  }
  if (name === 'related-recordings.page') return { state: 'empty', stateMessage: '', items: [], monthBuckets: [], hasMore: false }
  if (name === 'billing.quota') return { availableNanoCny: '0', totalNanoCny: '0', reservedNanoCny: '0', currency: 'CNY' }
  if (name === 'source.background-sound.preference') return { enabled: false }
  if (name === 'chat.attention.summary') return { totalUnreadCount: 0, sources: [], items: [] }
  if (name === 'plugin.update.status') return { enabled: false, state: 'idle' }
  if (name === 'provider.capabilities') return { contractVersion: 1, provider: '@senguoyun/dsh-arkme',
    features: { directMessageAdmission: true, markdownQuickNotes: true } }
  throw new Error(`本地验收未提供 ${name}`)
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname === '/__fixture') {
    if (url.searchParams.has('staff')) staff = url.searchParams.get('staff') === 'true'
    if (url.searchParams.has('delay')) delay = Math.min(30_000, Math.max(0, Number(url.searchParams.get('delay'))))
    if (url.searchParams.has('failure')) failure = url.searchParams.get('failure') === 'true'
    if (url.searchParams.has('unknownBan')) unknownBan = url.searchParams.get('unknownBan') === 'true'
    json(response, { staff, delay, failure, ownRefused, banned, calls }); return
  }
  if (url.pathname.startsWith('/arkme-self/api')) {
    if (request.method !== 'POST' || url.pathname !== '/arkme-self/api') {
      json(response, { ok: false, error: { code: 'fixture-read-unavailable', message: '本地验收无此资源', retryable: false } }, 404); return
    }
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk)
      const { operation: name, params = {} } = JSON.parse(Buffer.concat(chunks).toString())
      calls.push({ operation: name, params, at: Date.now() })
      json(response, { ok: true, value: await operation(name, params) })
    } catch (error) { json(response, { ok: false, error: { code: 'fixture-failure', message: error.message, retryable: true } }, 503) }
    return
  }
  const proxy = http.request(new URL(request.url, upstream), { method: request.method,
    headers: { ...request.headers, host: upstream.host, ...(request.headers.origin ? { origin: upstream.origin } : {}) },
  }, incoming => { response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response) })
  proxy.on('error', () => { response.writeHead(502); response.end('Isolated DSH unavailable') }); request.pipe(proxy)
})
const fixtureEvents = new WebSocketServer({ noServer: true })
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  if (pathname === '/arkme-self/api/events') {
    fixtureEvents.handleUpgrade(request, socket, head, client => {
      client.on('error', () => client.terminate())
      client.on('message', () => client.close(1008))
      client.send(JSON.stringify({ type: 'reconcile', revision: 1, connected: true, connectionGeneration: 1, refresh: 'none' }))
    })
    return
  }
  if (pathname.startsWith('/arkme-self/api')) { socket.destroy(); return }
  const target = net.connect(Number(upstream.port), upstream.hostname, () => {
    const headers = { ...request.headers, host: upstream.host, origin: upstream.origin }
    target.write(`${request.method} ${request.url} HTTP/1.1\r\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`)
    target.write(head); target.pipe(socket); socket.pipe(target)
  })
  target.on('error', () => { socket.destroy() }); socket.on('error', () => { target.destroy() })
})
server.listen(Number(process.argv[3] ?? 0), '127.0.0.1', () => { console.log(`Browser QA fixture: http://127.0.0.1:${server.address().port}`) })
