import { createHmac, randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const dshRoot = process.env.ARKME_DSH_CHECKOUT
const profile = process.env.ARKME_PACKED_PROFILE
const ready = process.env.JOTMO_GROUP_E2E_OPENAPI_READY
if (!dshRoot || !profile || !ready) throw new Error('Use the isolated group governance runner')
const fixture = JSON.parse(await readFile(ready, 'utf8'))
if (new URL(fixture.url).hostname !== '127.0.0.1') throw new Error('Owner must be a loopback fixture')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('Officially install an immutable tgz first')
const { launchWebScaffold } = await import(/* @vite-ignore */ pathToFileURL(join(dshRoot, 'apps/web/tests/scaffold.ts')).href)
const { connectFreshWorkspace } = await import(/* @vite-ignore */ pathToFileURL(join(dshRoot, 'apps/web/tests/support.ts')).href)
const { LlmAdapter } = await import(/* @vite-ignore */ pathToFileURL(join(dshRoot, 'packages/llm/llm/src/index.ts')).href)
const { chromium } = createRequire(join(dshRoot, 'apps/web/package.json'))('playwright')

describe('packed Arkme group governance through official DSH session and MCP', () => {
  it('discovers, calls, and revokes all six atomic capabilities through the real owners', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme group governance '))
    let scaffold, browser
    const dispatchedWrites = []
    const tokenParts = [{ alg: 'HS256', typ: 'JWT' }, { user_id: 1001, client_id: 7, exp: Math.floor(Date.now() / 1000) + 600 }]
      .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
    const token = `${tokenParts}.${createHmac('sha256', 'isolated-group-governance').update(tokenParts).digest('base64url')}`
    const proxy = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, async (req, res) => {
      try {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const raw = Buffer.concat(chunks)
        if (req.url.startsWith('/mcp/') || req.url === '/api/public/v1/mcp/manifest') {
          if (req.method === 'POST') {
            const call = JSON.parse(raw.toString())
            if (call.method === 'tools/call' && ['remove_group_members', 'withdraw_group_messages', 'set_group_join_restrictions'].includes(call.params?.name)) dispatchedWrites.push(call.params.name)
          }
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
      scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')], compareReplaySession: false, toolsMode: 'both' })
      const service = scaffold.ctx.get('arkmeData')
      const memberInvalidations = []
      service.subscribeChatRealtime(event => { if (event.type === 'members-invalidated') memberInvalidations.push(event) })
      expect(await service.testLogin(1001)).toMatchObject({ status: 'authenticated', userId: 1001 })
      const names = ['query_group_message_moderation_targets', 'withdraw_group_messages', 'batch_get_group_members', 'remove_group_members', 'set_group_join_restrictions', 'list_group_join_restrictions']
      await expect.poll(() => scaffold.ctx.tools.schemas().map(tool => tool.name), { timeout: 30_000 }).toEqual(expect.arrayContaining(names.map(name => `mcp__arkme__${name}`)))
      for (const name of ['arkme_message_withdraw', 'arkme_group_member_remove', 'arkme_group_join_restriction_set', 'arkme_group_join_restrictions']) expect(scaffold.ctx.tools.schemas().some(tool => tool.name === name)).toBe(true)
      const events = []
      const codeDispatches = []
      scaffold.ctx.on('session/event', (_session, event) => { if (event.type === 'tool/result') events.push(event); if (event.type === 'tool/code-dispatch') codeDispatches.push(event) })
      let group, userRef
      const locator = () => ({ item_id: 'dsh-member', chat_session_uid: group, target_user_ref: userRef })
      const succeeded = value => expect(value.items[0].status).toBe('succeeded')
      const steps = [
        ['list_chat_conversations', () => ({ scopes: ['group_chat'] }), value => {
          group = value.items.find(item => item.display_name === '隔离群治理验收')?.chat_session_uid
          expect(group).toBeTruthy()
        }],
        ['list_chat_members', () => ({ chat_session_uid: group }), value => {
          userRef = value.items.find(item => item.display_name === '待治理成员')?.user_ref
          expect(userRef).toBeTruthy()
        }],
        ['batch_get_group_members', () => ({ items: [locator()] }), value => expect(value.items[0].member.membership_status).toBe('active')],
        ['remove_group_members', () => ({ items: [{ ...locator(), prevent_rejoin: true }] }), succeeded],
        ['remove_group_members', () => ({ items: [{ ...locator(), }] }), succeeded],
        ['query_group_message_moderation_targets', () => ({ chat_session_uid: group, sender_user_refs: [userRef] }), value => expect(value.items[0].sequence).toBe(3)],
        ['withdraw_group_messages', () => ({ items: [{ item_id: 'dsh-message', chat_session_uid: group, sequence: 3 }] }), succeeded],
        ['list_group_join_restrictions', () => ({ chat_session_uid: group }), value => expect(value.items).toContainEqual(expect.objectContaining({ user_ref: userRef, display_name: '待治理成员' }))],
        ['set_group_join_restrictions', () => ({ items: [{ ...locator(), restricted: true }] }), succeeded],
        ['set_group_join_restrictions', () => ({ items: [{ ...locator(), restricted: false }] }), value => {
          succeeded(value); expect(value.items[0].member).toMatchObject({ membership_status: 'removed', join_restricted: false })
        }],
        ['list_group_join_restrictions', () => ({ chat_session_uid: group }), value => expect(value.items).toEqual([])],
        ['set_group_join_restrictions', () => ({ items: [{ ...locator(), restricted: true }] }), succeeded],
        ['list_group_join_restrictions', () => ({ chat_session_uid: group }), value => expect(value.items).toContainEqual(expect.objectContaining({ user_ref: userRef, display_name: '待治理成员' }))],
      ]
      // Only model output is deterministic. Every target reference is discovered
      // through official tools; confirmation comes from actual browser user turns.
      class GovernanceAdapter extends LlmAdapter {
        index = 0
        processed = 0
        calls = 0
        question = undefined
        cancelNext = false
        providerInfo() { return { id: 'group-e2e', name: 'Group E2E' } }
        async listModels() { return [{ provider: 'group-e2e', id: 'governance', name: 'Group Governance' }] }
        async resolveModel() { return { provider: 'group-e2e', id: 'governance', name: 'Group Governance', contextWindow: 128000 } }
        async *stream() {
          let reply
          if (this.cancelNext) { this.cancelNext = false; reply = '已取消，本次没有执行写入。' }
          else if (events.length > this.processed) {
            const result = events.at(-1).data.message.content[0]
            let value = JSON.parse(result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'))
            if (value.structuredContent !== undefined) value = value.structuredContent
            this.processed = events.length
            if (value.status === 'confirmation_required') {
              this.question = value.question
              reply = value.question
            } else {
              expect(result.isError, JSON.stringify(result)).toBe(false)
              steps[this.index][2](value)
              this.index++
              this.question = undefined
            }
          }
          if (!reply && this.index === steps.length) reply = 'GROUP_GOVERNANCE_E2E_OK'
          if (reply) {
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
            yield { type: 'finish', reason: { kind: 'stop' } }
            return
          }
          const step = steps[this.index]
          const id = `group-browser-${++this.calls}`
          const tool = `mcp__arkme__${step[0]}`
          // Exercise the shipped worker runtime as well as direct MCP calls.
          const code = ['withdraw_group_messages', 'set_group_join_restrictions'].includes(step[0])
          const name = code ? 'run_code' : tool
          const input = step[1]()
          const args = JSON.stringify(code ? { code: `try { console.log(JSON.stringify(await tools.${tool}(${JSON.stringify(input)}))) } catch (error) { console.log(error.message) }`, description: '执行已选定的群治理操作' } : input)
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
          yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
        }
      }
      const adapter = new GovernanceAdapter()
      scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter(['group-e2e'], adapter))
      await scaffold.ctx.agentDefaultModel.saveSelection({ provider: 'group-e2e', model: 'governance' })
      browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
      const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'en-US' })
      await page.addInitScript(() => localStorage.setItem('dsh.locale', 'en'))
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      const frameElement = await page.waitForSelector('iframe[title="DeepSeek Harness"]')
      const frame = await frameElement.contentFrame()
      await connectFreshWorkspace(frame, scaffold.workspaceCwd)
      const input = frame.locator('[data-composer-input]').first()
      const send = async text => {
        await input.fill(text)
        const settled = scaffold.whenTurnSettled(60000)
        await input.press('Enter')
        await settled
      }
      await send('在隔离群治理验收群中，移出待治理成员并禁止再次加入，撤回其历史消息，然后核验、解除并重新设置入群限制。')
      expect(adapter.question, JSON.stringify({ events, page: await frame.locator('body').innerText() })).toContain('移出')
      expect(dispatchedWrites).toEqual([])
      await frame.getByText(adapter.question, { exact: true }).last().waitFor()
      adapter.cancelNext = true
      await send('取消此次操作。')
      expect(dispatchedWrites).toEqual([])
      await frame.getByText('已取消，本次没有执行写入。', { exact: true }).last().waitFor()
      let confirmations = 0
      while (adapter.index < steps.length && confirmations < 8) {
        expect(adapter.question).toBeTruthy()
        await send('现在确认执行刚才列出的操作。')
        confirmations++
      }
      expect(adapter.index, await frame.locator('body').innerText()).toBe(steps.length)
      expect(confirmations).toBe(6)
      expect(dispatchedWrites).toHaveLength(6)
      expect(codeDispatches).toHaveLength(8)
      expect(codeDispatches.filter(event => event.data.isError)).toHaveLength(4)
      expect(memberInvalidations).toHaveLength(2)
      expect(events).toHaveLength(steps.length + confirmations)
      await frame.getByText('GROUP_GOVERNANCE_E2E_OK', { exact: true }).last().waitFor()
      if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: process.env.ARKME_E2E_SCREENSHOT })
      await service.logout()
      await expect.poll(() => scaffold.ctx.tools.schemas().some(tool => tool.name.startsWith('mcp__arkme__')), { timeout: 10_000 }).toBe(false)
      await writeFile(ready + '.finished', 'verified\n', { mode: 0o600 })
    } finally {
      await scaffold?.ctx.get('arkmeData')?.logout().catch(() => {})
      await browser?.close()
      await scaffold?.close()
      await new Promise(resolve => proxy.close(resolve))
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})
