import { createHmac, randomInt, randomUUID } from 'node:crypto'
import { createServer, request as proxyRequest } from 'node:http'
import { once } from 'node:events'
import { connect } from 'node:net'
import { describe, expect, it } from 'vitest'
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import { type StateStore } from '../src/services/service.js'
import { createArkmeHostApi } from '../src/host-api.js'
import { createArkmeSdk } from '../src/sdk/index.js'
import { TeamService } from '../src/services/team-service.js'
import { HttpOpenApiCapabilityGateway } from '../src/openapi-capability-gateway.js'
import { SecretValue } from '../src/secret-value.js'
import { createContactDirectoryState, contactDirectoryReducer } from '../src/client/redesign/contacts/contact-directory-state.js'

// Explicit opt-in against the repository's isolated Chat compose stack. Never a remote account.
const chatOrigin = process.env.ARKME_DIRECTORY_E2E_CHAT_ORIGIN
const dshOrigin = process.env.ARKME_DIRECTORY_E2E_DSH_ORIGIN
function loopback(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/') throw new Error('Fixture requires a loopback HTTP origin')
  return url
}

describe.skipIf(chatOrigin === undefined)('directory UI / SDK → Host → real Chat / Mongo / Redis', () => {
  it('runs five owners, counts, stable pagination, technical recovery, partial refresh and account isolation', async () => {
    const chat = loopback(chatOrigin!)
    const dsh = dshOrigin === undefined ? undefined : loopback(dshOrigin)
    const userId = randomInt(7_000_000, 70_000_000)
    const token = (id: number) => {
      const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
      const body = Buffer.from(JSON.stringify({ user_id: id, client_id: 3001, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
      return `${head}.${body}.${createHmac('sha256', 'chat-e2e-access-token-secret').update(`${head}.${body}`).digest('base64url')}`
    }
    let session = { userId, accessToken: token(userId), refreshToken: 'synthetic-fixture-login' }
    const sessionStore = { async read() { return session }, async write(value: typeof session) { session = value }, async delete() {} }
    const json = (data: unknown, code = 200) => new Response(JSON.stringify({ code, message: code === 200 ? '' : '服务器繁忙', data }), { headers: { 'content-type': 'application/json' } })
    const seed = async (path: string, body: object, internal = false) => {
      const res = await fetch(new URL(path, chat), { method: 'POST', headers: { 'content-type': 'application/json', ...(internal ? { 'X-Internal-Secret': 'compose-e2e-internal-secret' } : { Authorization: `Bearer ${session.accessToken}` }) }, body: JSON.stringify(body) })
      const result = await res.json() as { code: number; message?: string; data: unknown }
      expect(result.code, `${path}: ${result.message ?? ''}`).toBe(200)
      return result.data
    }
    const directUid = randomUUID()
    await seed('/api/v1/chats/create-private', { chat_session_uid: directUid, peer_user_id: userId + 1, create_at: Date.now() })
    await seed('/api/v1/chats/create-private', { chat_session_uid: randomUUID(), peer_user_id: userId + 2, create_at: Date.now() })
    await seed('/api/internal/v1/chat/extensions/private/supplement/batch-upsert', { items: [{ chat_session_uid: directUid, user_id: userId, counterpart_user_id: userId + 1, contact_state: 1, pre_chat_state: 1, status: 1, updated_at: Date.now(), remark: '联系人甲' }] }, true)
    for (const title of ['验收群甲', '验收群乙']) await seed('/api/v1/chats/create-group', { chat_session_uid: randomUUID(), title, member_user_ids: [userId + 1], create_at: Date.now() })

    const calls: Array<{ path: string; body: Record<string, unknown> }> = []
    let directFailure = false
    let botFailures = 1
    let teamFailures = 1
    // Only Chat is a real service here; Auth presentation, Bot, Audio and OpenAPI are explicit boundary fixtures.
    const upstreamFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input))
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ path: url.pathname, body })
      if (url.origin === chat.origin) {
        if (!['/api/v1/chats/list', '/api/v1/chats/contacts/list', '/api/v1/chats/group-avatar-snapshots', '/api/v1/chats/display-snapshots', '/api/v1/chats/unread-snapshot'].includes(url.pathname)) throw new Error(`Unregistered Chat write/read: ${url.pathname}`)
        if (directFailure && url.pathname === '/api/v1/chats/list' && body.session_kind === 1) return json(null, 1002)
        return fetch(input, init)
      }
      if (url.origin !== 'https://directory-fixture.invalid') throw new Error('Fixture blocked an external origin')
      if (url.pathname === '/api/v1/auth/get-public-users-by-ids') return json({ items: (body.user_ids as number[]).map(id => ({ user_id: id, nick_name: `验收用户${id - userId}`, jotmo_id: `test_${id}`, head_img: '' })) })
      if (url.pathname === '/api/v1/bot/list') return botFailures-- > 0 ? json(null, 1002) : json({ bots: [{ bot_id: 'fixture-bot', name: '验收 Bot', provider: 'webhook' }] })
      if (url.pathname === '/api/v1/audio/unmarked-speakers/list') return json({ items: body.limit === 0 ? [] : [{ candidate_id: 'fixture-candidate', status: 'single_day', label: '1', speaker_display_number: 1, day_count: 1, segment_count: 2 }], cross_day_count: 0, single_day_count: 1, has_more: false, projection_state: 'fresh' })
      if (url.pathname === '/api/v1/teams/list') {
        if (teamFailures-- > 0) return new Response('', { status: 429, headers: { 'retry-after': '1' } })
        return new Response(JSON.stringify({ code: 200, data: { items: [{ team_ref: `team_v1_${'a'.repeat(32)}`, name: '验收团队', jotmo_id: 'test_team', current_user_role: 'owner', created_at: 1, updated_at: 1 }], total_count: 1, has_more: false } }))
      }
      throw new Error(`Unregistered fixture dependency: ${url.pathname}`)
    }
    const dependency = 'https://directory-fixture.invalid'
    const config: ArkmeServiceConfig = { environment: 'test', chatBaseUrl: chat.origin, authBaseUrl: dependency, botBaseUrl: dependency, audioBaseUrl: dependency,
      subjectBaseUrl: dependency, recordBaseUrl: dependency, imBaseUrl: dependency, webrtcBaseUrl: dependency, worldBaseUrl: dependency, relationBaseUrl: dependency,
      intelligentBaseUrl: dependency, routePath: '/arkme-self/api', requestTimeoutMs: 5000, maxTextLength: 20000, geetestCaptchaId: '', interwovenMomentsEnabled: false }
    const service = new ArkmeService(config, sessionStore, { async uniqueCode() { return 'directory-e2e-synthetic-key' } } as StateStore, upstreamFetch)
    const teamGateway = new HttpOpenApiCapabilityGateway(dependency, { async executeWithCredential(_signal, operation) { return await operation(new SecretValue('fixture-openapi-token'), _signal) } }, upstreamFetch)
    const teams = new TeamService(teamGateway, { async publicAvatarPresentationsByArkmeIds() { return new Map() } }, service.ownerReads)
    const hostOptions = { expectedPort: 0, allowNonLoopback: false, teamService: teams }
    const host = createArkmeHostApi(service, hostOptions)
    let finishBrowser: (() => void) | undefined
    const browserDone = new Promise<void>(resolve => { finishBrowser = resolve })
    const server = createServer(async (req, res) => {
      const url = new URL(req.url!, 'http://localhost')
      if (url.pathname === '/__fixture') {
        if (url.searchParams.has('directFailure')) directFailure = url.searchParams.get('directFailure') === 'true'
        if (url.searchParams.has('finish')) finishBrowser?.()
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ directFailure, calls })); return
      }
      if (url.pathname === '/arkme-self/api') {
        // Peek the operation without replacing the production Host dispatch for directory/capability reads.
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const bytes = Buffer.concat(chunks)
        const operation = (JSON.parse(bytes.toString()) as { operation: string }).operation
        if (operation === 'directory.list' || operation === 'provider.capabilities') {
          req[Symbol.asyncIterator] = async function* () { yield bytes }
          await host(req, res); return
        }
        const shell: Record<string, unknown> = {
          'auth.status': { status: 'authenticated', environment: 'test', userId },
          'auth.config': { environment: 'test', recordingWorkbenchEnabled: true },
          'provider.instance': { instanceId: 'directory-e2e' },
          'user.profile': { profile: { userId, displayName: '目录验收账号', nickname: '目录验收账号', avatarRef: '', arkmeId: 'fixture', accountType: 1, createdAt: 1, bindings: {}, contact: {} }, revision: 1, cachedAtMillis: Date.now() },
          'sources.list': { items: [], hasMore: false }, 'files.send.tasks': [], 'source.record-reedit.resume': null,
          'calls.outgoing.intent.claim': null, 'arko.profile': { displayName: 'Arko', version: 1 },
          'billing.quota': { availableNanoCny: '0', totalNanoCny: '0', reservedNanoCny: '0', currency: 'CNY' },
          'chat.attention.summary': { totalUnreadCount: 0, sources: [], items: [] }, 'plugin.update.status': { enabled: false, state: 'idle' },
        }
        const known = Object.hasOwn(shell, operation)
        res.writeHead(known ? 200 : 403, { 'content-type': 'application/json' })
        res.end(JSON.stringify(known ? { ok: true, value: shell[operation] } : { ok: false, error: { code: 'fixture-blocked', message: '验收仅允许目录读取', retryable: false } })); return
      }
      if (url.pathname.startsWith('/arkme-self/api')) {
        if (url.pathname.endsWith('/events')) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': fixture\n\n') }
        else { res.writeHead(404); res.end() }
        return
      }
      if (dsh === undefined) { res.writeHead(404); res.end(); return }
      const proxy = proxyRequest(new URL(req.url!, dsh), { method: req.method, headers: { ...req.headers, host: dsh.host, origin: dsh.origin } }, incoming => { res.writeHead(incoming.statusCode!, incoming.headers); incoming.pipe(res) })
      proxy.on('error', () => { res.writeHead(502); res.end() }); req.pipe(proxy)
    })
    server.on('upgrade', (req, socket, head) => {
      if (!dsh) { socket.destroy(); return }
      const target = connect(Number(dsh.port), dsh.hostname, () => {
        const headers = { ...req.headers, host: dsh.host, origin: dsh.origin }
        target.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`)
        target.write(head); target.pipe(socket); socket.pipe(target)
      })
      target.on('error', () => socket.destroy()); socket.on('error', () => target.destroy())
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    hostOptions.expectedPort = address.port
    const origin = `http://127.0.0.1:${address.port}`
    const sdk = createArkmeSdk({ fetchImpl: (input, init) => fetch(new URL(String(input), origin), init) })
    try {
      const sections = ['groups', 'bots', 'unmarked-speakers', 'teams', 'contacts'] as const
      const counts = await Promise.all(sections.map(section => sdk.call('directory.list', { section, countOnly: true })))
      expect(counts.map(value => (value as { total: number }).total)).toEqual([2, 1, 1, 1, 2])
      const callsAfterCount = calls.length
      const first = await sdk.listDirectory('contacts', { limit: 1 })
      const second = await sdk.listDirectory('contacts', { limit: 1, cursor: first.nextCursor })
      expect(first).toMatchObject({ total: 2, coverage: 'complete', hasMore: true })
      expect(second).toMatchObject({ total: 2, coverage: 'complete', hasMore: false })
      expect(second.items).not.toEqual(first.items)
      expect(calls.slice(callsAfterCount).every(call => call.path === '/api/v1/auth/get-public-users-by-ids')).toBe(true)
      const group = await sdk.listDirectory('groups', { limit: 1 })
      expect(group.hasMore).toBe(true)
      const groupNext = await sdk.listDirectory('groups', { limit: 1, cursor: group.nextCursor })
      expect(groupNext.items[0]).not.toEqual(group.items[0])
      for (const section of ['bots', 'unmarked-speakers', 'teams'] as const) expect((await sdk.listDirectory(section)).items).toHaveLength(1)
      expect(calls.filter(call => call.path === '/api/v1/bot/list')).toHaveLength(2)
      expect(calls.filter(call => call.path === '/api/v1/teams/list').length).toBeGreaterThanOrEqual(2)

      let state = createContactDirectoryState('fixture')
      state.sections.contacts = { ...state.sections.contacts, items: [...first.items, ...second.items], total: 2, generation: 1 }
      directFailure = true
      const beforeFailure = calls.length
      const partial = await sdk.listDirectory('contacts', { refresh: true })
      expect(partial).toMatchObject({ coverage: 'partial', total: 1, projectionState: 'stale' })
      expect(calls.slice(beforeFailure).filter(call => call.path === '/api/v1/chats/list')).toHaveLength(3)
      state = contactDirectoryReducer(state, { type: 'load-success', section: 'contacts', accountKey: 'fixture', generation: 1, mode: 'replace', page: partial })
      expect(state.sections.contacts.items).toHaveLength(2)
      directFailure = false
      const restored = await sdk.listDirectory('contacts', { refresh: true })
      expect(restored).toMatchObject({ coverage: 'complete', total: 2 })
      await expect(sdk.listDirectory('contacts', { cursor: first.nextCursor })).resolves.toMatchObject({ cursorStale: true })
      session = { userId: userId + 10, accessToken: token(userId + 10), refreshToken: 'second-fixture-login' }
      await expect(sdk.listDirectory('contacts')).resolves.toMatchObject({ items: [], total: 0, coverage: 'complete' })
      await expect(sdk.listDirectory('contacts', { cursor: first.nextCursor })).rejects.toMatchObject({ body: { code: 'directory-cursor-invalid' } })
      session = { userId, accessToken: token(userId), refreshToken: 'synthetic-fixture-login' }
      if (dsh) {
        console.log(`Directory browser acceptance: ${origin}`)
        await browserDone
      }
    } finally {
      service.dispose(); server.closeAllConnections(); server.close()
    }
  }, 15 * 60_000)
})
