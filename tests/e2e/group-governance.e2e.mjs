import { createHmac, randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { CallId } from '@deepseek-ai/dsh-llm'

const dshRoot = process.env.ARKME_DSH_CHECKOUT
const profile = process.env.ARKME_PACKED_PROFILE
const ready = process.env.JOTMO_GROUP_E2E_OPENAPI_READY
if (!dshRoot || !profile || !ready) throw new Error('Use the isolated group governance runner')
const fixture = JSON.parse(await readFile(ready, 'utf8'))
if (new URL(fixture.url).hostname !== '127.0.0.1') throw new Error('Owner must be a loopback fixture')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('Officially install an immutable tgz first')
const { launchWebScaffold } = await import(/* @vite-ignore */ pathToFileURL(join(dshRoot, 'apps/web/tests/scaffold.ts')).href)

describe('packed Arkme group governance through official DSH session and MCP', () => {
  it('discovers, calls, and revokes all six atomic capabilities through the real owners', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme group governance '))
    let scaffold, agentHandle
    const tokenParts = [{ alg: 'HS256', typ: 'JWT' }, { user_id: 1001, client_id: 7, exp: Math.floor(Date.now() / 1000) + 600 }]
      .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
    const token = `${tokenParts}.${createHmac('sha256', 'isolated-group-governance').update(tokenParts).digest('base64url')}`
    const proxy = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, async (req, res) => {
      try {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const raw = Buffer.concat(chunks)
        if (req.url.startsWith('/mcp/') || req.url === '/api/public/v1/mcp/manifest') {
          const upstream = await fetch(`${fixture.url}${req.url}`, { method: req.method, headers: { ...req.headers, host: new URL(fixture.url).host }, ...(req.method === 'POST' ? { body: raw } : {}) })
          res.statusCode = upstream.status
          res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json')
          res.end(Buffer.from(await upstream.arrayBuffer())); return
        }
        let data = { items: [], users: [], has_more: false }
        if (req.url === '/api/public/v1/auth/the-best-api-for-testing') data = { access_token: token, refresh_token: 'isolated-group-refresh' }
        if (req.url === '/api/v1/auth/get-user-info') data = { user_id: 1001, nick_name: '隔离治理群主', phone: '13800000000' }
        if (req.url === '/api/v1/platform/api-key/managed/ensure') data = { state: 'issued', key_id: fixture.key.split('_')[1], generation: 1, expires_at: Date.now() + 600_000, reconcile_after_seconds: 300, api_key: fixture.key }
        if (req.url === '/api/v1/platform/api-key/managed/disconnect') data = { state: 'disconnected' }
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code: 200, data }))
      } catch { res.statusCode = 500; res.end('isolated proxy failed') }
    })
    try {
      proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
      const origin = `https://127.0.0.1:${proxy.address().port}`
      const config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: `com.senqisi.group-e2e-${randomUUID()}`, allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: true, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business' }
      for (const key of ['auth', 'subject', 'record', 'data', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[`${key}BaseUrl`] = origin
      config.shareWebsite = origin
      const overlay = join(root, 'overlay.json'); await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'arkme-group-e2e', name: '@senguoyun/dsh-arkme', config }] }]))
      scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')], compareReplaySession: false })
      const service = scaffold.ctx.get('arkmeData')
      expect(await service.testLogin(1001)).toMatchObject({ status: 'authenticated', userId: 1001 })
      const names = ['query_group_message_moderation_targets', 'withdraw_group_messages', 'batch_get_group_members', 'remove_group_members', 'set_group_join_restrictions', 'list_group_join_restrictions']
      await expect.poll(() => scaffold.ctx.tools.schemas().map(tool => tool.name), { timeout: 30_000 }).toEqual(expect.arrayContaining(names.map(name => `mcp__arkme__${name}`)))
      agentHandle = await scaffold.ctx.agents.create({ sessionId: SessionId(`group-${randomUUID()}`), meta: { cwd: scaffold.workspaceCwd }, setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx).then(() => undefined) })
      const agent = agentHandle.agent
      const session = agent.session
      for (const name of ['arkme_message_withdraw', 'arkme_group_member_remove', 'arkme_group_join_restriction_set', 'arkme_group_join_restrictions']) expect(scaffold.ctx.tools.get(name, agent)).toBeUndefined()
      let count = 0
      const call = async (name, args, error = false) => {
        const callId = CallId(`group-${++count}`); const fullName = `mcp__arkme__${name}`
        session.append('tool/call', { turn: 1, step: count, callId, name: fullName, arguments: JSON.stringify(args) })
        const result = await scaffold.ctx.tools.execute({ callId, name: fullName, arguments: args, agent, signal: new AbortController().signal })
        expect(result.isError, JSON.stringify(result.content)).toBe(error)
        return result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
      }
      const locator = { item_id: 'dsh-member', chat_session_uid: fixture.group, target_user_ref: fixture.user_ref }
      expect(await call('batch_get_group_members', { items: [locator] })).toContain('"version":0')
      await call('set_group_join_restrictions', { items: [{ ...locator, expected_version: 0 }] }, true)
      expect(await call('remove_group_members', { items: [{ ...locator, expected_version: 0, prevent_rejoin: true }] })).toContain('succeeded')
      expect(await call('remove_group_members', { items: [{ ...locator, expected_version: 0 }] })).toContain('stale_version')
      expect(await call('query_group_message_moderation_targets', { chat_session_uid: fixture.group, sender_user_refs: [fixture.user_ref] })).toContain('"sequence":3')
      expect(await call('withdraw_group_messages', { items: [{ item_id: 'dsh-message', chat_session_uid: fixture.group, sequence: 3 }] })).toContain('succeeded')
      expect(await call('list_group_join_restrictions', { chat_session_uid: fixture.group })).toContain(fixture.user_ref)
      expect(await call('set_group_join_restrictions', { items: [{ ...locator, expected_version: 1, restricted: true }] })).toContain('succeeded')
      await service.logout()
      await expect.poll(() => scaffold.ctx.tools.schemas().some(tool => tool.name.startsWith('mcp__arkme__')), { timeout: 10_000 }).toBe(false)
      await writeFile(ready + '.finished', 'verified\n', { mode: 0o600 })
    } finally {
      await scaffold?.ctx.get('arkmeData')?.logout().catch(() => {})
      await agentHandle?.dispose()
      await scaffold?.close()
      await new Promise(resolve => proxy.close(resolve))
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})
