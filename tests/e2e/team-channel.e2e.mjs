// Real Team + Record processes and Mongo/RabbitMQ; only the account directory
// and unrelated legacy panes are fixtures. Chat/Subject/OpenAPI are not started.
import { createHmac, randomUUID } from 'node:crypto'
import { createServer as httpServer } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const dshRoot = process.env.ARKME_DSH_CHECKOUT
const profile = process.env.ARKME_PACKED_PROFILE
const teamOrigin = process.env.ARKME_TEAM_E2E_ORIGIN
const recordOrigin = process.env.ARKME_RECORD_E2E_ORIGIN
const accountPort = Number(process.env.ARKME_ACCOUNT_FIXTURE_PORT)
const signingKey = process.env.ARKME_TEAM_E2E_SIGNING_KEY
if (!dshRoot || !profile || !signingKey || !accountPort
  || [teamOrigin, recordOrigin].some(origin => !origin || new URL(origin).hostname !== '127.0.0.1')) {
  throw new Error('Supply isolated local service origins, account fixture port and synthetic signing key')
}
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('Install the immutable tgz with the official CLI first')
const { launchWebScaffold } = await import(pathToFileURL(join(dshRoot, 'apps/web/tests/scaffold.ts')).href)
const { chromium } = createRequire(join(dshRoot, 'apps/web/package.json'))('playwright')
const users = { owner: 99001001, member: 99001002, otherMember: 99001003, visitor: 99001004, stranger: 99001005 }
const names = new Map(Object.entries(users).map(([name, id]) => [id, `验收-${name}`]))
function token(user) {
  const body = [{ alg: 'HS256', typ: 'JWT' }, { user_id: user, client_id: user + 1, iss: 'jotmo', exp: Math.floor(Date.now() / 1000) + 3600 }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
  return `${body}.${createHmac('sha256', signingKey).update(body).digest('base64url')}`
}
async function teamCall(user, path, body = {}, failure = false) {
  const response = await fetch(`${teamOrigin}/api/v1/team/${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${token(user)}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const result = await response.json()
  if (!failure) expect(result, path).toMatchObject({ code: 200 })
  return failure ? result : result.data
}

describe('independent Team channel, installed artifact on official DSH', () => {
  it('isolates visitors, shares replies and receipts, edits the same Record, and revokes current member access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme team acceptance '))
    let scaffold, browser, page
    const failures = [], upstreamRequests = []
    const identity = value => ({ user_id: value, nick_name: names.get(value), jotmo_id: `fixture_${value}`, head_img: '', identity_ready: true })
    const handler = async (req, res) => {
      try {
        const buffers = []; for await (const chunk of req) buffers.push(chunk)
        const body = Buffer.concat(buffers), input = body.length ? JSON.parse(body) : {}
        const path = new URL(req.url, 'http://localhost').pathname
        let result
        if (path === '/api/internal/v1/auth/public-user-identities/query') result = { code: 200, data: { items: (input.user_ids ?? []).map(identity) } }
        else if (path === '/api/internal/v1/auth/ensure-jotmo-id') result = { code: 200, data: { created: true, name: input.name } }
        else if (path === '/api/public/v1/auth/the-best-api-for-testing') result = { code: 200, data: { access_token: token(input.user_id), refresh_token: `fixture-${input.user_id}` } }
        else if (path === '/api/v1/auth/get-user-info') {
          const id = JSON.parse(Buffer.from(req.headers.authorization.split(' ')[1].split('.')[1], 'base64url')).user_id
          result = { code: 200, data: { ...identity(id), phone: '13800000000' } }
        } else if (/^\/api\/(v1|public\/v1)\/team\//.test(path) || /^\/api\/v1\/(records|files)\//.test(path)) {
          upstreamRequests.push(path)
          const origin = path.includes('/team/') ? teamOrigin : recordOrigin
          const upstream = await fetch(`${origin}${req.url}`, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : body })
          res.writeHead(upstream.status, Object.fromEntries([...upstream.headers].filter(([key]) => !['transfer-encoding', 'content-encoding', 'content-length'].includes(key))))
          res.end(Buffer.from(await upstream.arrayBuffer())); return
        } else result = { code: 200, data: { items: [], users: [], sources: [], has_more: false } }
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result))
      } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: String(error) })) }
    }
    const accounts = httpServer(handler)
    const proxy = httpsServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, handler)
    try {
      accounts.listen(accountPort, '127.0.0.1'); await once(accounts, 'listening')
      proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
      const origin = `https://127.0.0.1:${proxy.address().port}`
      const existing = await teamCall(users.owner, 'list-mine')
      const team = existing.teams.find(item => item.jotmo_id === 'arkme_cn') ?? (await teamCall(users.owner, 'create', { request_uid: randomUUID(), name: '即我团队验收', jotmo_id: 'arkme_cn' })).team
      let channel = await teamCall(users.owner, 'message-channel/get', { team_id: team.team_id })
      channel = await teamCall(users.owner, 'message-channel/configure', { team_id: team.team_id, expected_revision: channel.revision, enabled: true, rotate_link: true })
      expect(channel.public_ref).toMatch(/^[a-f0-9]{32}$/)
      for (const user of [users.member, users.otherMember]) {
        const application = await teamCall(user, 'join-requests/create', { team_id: team.team_id, request_uid: randomUUID() }, true)
        if (application.code === 200) await teamCall(users.owner, 'join-requests/decide', { team_id: team.team_id, user_id: user, revision: application.data.revision, approve: true })
        else expect(application.data.reason).toBe('already_member')
      }
      const conversation = (await teamCall(users.visitor, 'conversations/open', { public_ref: channel.public_ref })).conversation
      const uid = conversation.conversation_uid
      const marker = `真实团队链路 ${randomUUID()}`
      const command = { conversation_uid: uid, side: 'external', client_message_uid: randomUUID(), content: { text_content: marker, template_kind: 1 } }
      const message = await teamCall(users.visitor, 'conversations/messages/send', command)
      expect(message.state).toBe('published')
      expect((await teamCall(users.visitor, 'conversations/messages/send', command)).message_uid).toBe(message.message_uid)
      expect((await teamCall(users.stranger, 'conversations/timeline/page', { conversation_uid: uid, side: 'external' }, true)).data.reason).toBe('not_accessible')
      expect((await teamCall(users.stranger, 'join-by-jotmo-id', { jotmo_id: 'arkme_cn' }, true)).data.reason).toBe('approval_required')
      for (const user of [users.owner, users.member, users.otherMember]) {
        expect((await teamCall(user, 'conversations/timeline/page', { conversation_uid: uid, side: 'team' })).messages.some(item => item.message_uid === message.message_uid)).toBe(true)
      }
      const config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: `com.senqisi.team-e2e-${randomUUID()}`, allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'disabled', shareWebsite: origin }
      for (const key of ['auth', 'subject', 'record', 'data', 'team', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[`${key}BaseUrl`] = origin
      const overlay = join(root, 'overlay.json')
      await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'arkme-team-e2e', name: '@senguoyun/dsh-arkme', config }] }]))
      scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')], replayFixture: resolve(dshRoot, 'snapshots/web/plan-narrow-viewport/session.v3.jsonl'), replayProvidersOnly: true, compareReplaySession: false })
      const service = scaffold.ctx.get('arkmeData')
      expect(await service.testLogin(users.member)).toMatchObject({ status: 'authenticated' })
      browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
      page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      await page.goto(scaffold.authenticatedUrl)
      await page.getByRole('button', { name: '团队消息', exact: true }).click()
      const panel = page.getByRole('dialog', { name: '团队消息', exact: true })
      expect(await panel.evaluate(node => getComputedStyle(node).display)).toBe('flex')
      expect(await panel.locator('..').evaluate(node => getComputedStyle(node).position)).toBe('fixed')
      await panel.getByRole('navigation', { name: '团队会话' }).getByRole('button', { name: /验收-visitor/ }).click()
      await panel.getByText(marker, { exact: true }).waitFor()
      const reply = `插件真实回复 ${randomUUID()}`
      await panel.getByRole('textbox', { name: '团队消息内容' }).fill(reply)
      await panel.getByRole('button', { name: '发送', exact: true }).click()
      await panel.locator('article').getByText(reply, { exact: true }).waitFor()
      const published = (await teamCall(users.visitor, 'conversations/timeline/page', { conversation_uid: uid, side: 'external' })).messages.find(item => item.record?.text_content === reply)
      expect(published.sender.nickname).toBe('验收-member')
      expect(published.actor_user_id).toBeUndefined()
      await teamCall(users.otherMember, 'conversations/read/advance', { conversation_uid: uid, side: 'team', read_seq: published.seq })
      const receipt = await teamCall(users.owner, 'conversations/read-receipts/query', { conversation_uid: uid, side: 'team', message_uid: published.message_uid })
      expect(receipt.members.find(item => item.user_id === users.otherMember).read).toBe(true)
      const externalReceipt = await teamCall(users.visitor, 'conversations/read-receipts/query', { conversation_uid: uid, side: 'external', message_uid: message.message_uid })
      expect(externalReceipt.team_read).toBe(true); expect(externalReceipt.members).toBeUndefined()
      const article = panel.locator('article').filter({ hasText: reply })
      await article.getByRole('button', { name: '编辑', exact: true }).click()
      await panel.getByRole('textbox', { name: '修改消息内容' }).fill(`${reply} 已修改`)
      await panel.getByRole('button', { name: '确认修改', exact: true }).click()
      await panel.locator('article').getByText(`${reply} 已修改`, { exact: true }).waitFor()
      expect((await teamCall(users.visitor, 'conversations/timeline/page', { conversation_uid: uid, side: 'external' })).messages.find(item => item.message_uid === published.message_uid).record.text_content).toBe(`${reply} 已修改`)
      if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: process.env.ARKME_E2E_SCREENSHOT })
      await teamCall(users.owner, 'members/remove', { team_id: team.team_id, target_user_id: users.member })
      await panel.locator('.team-conversation-pane').getByRole('button', { name: '刷新', exact: true }).click()
      await panel.getByRole('alert').filter({ hasText: /权限|访问|不可/ }).waitFor()
      expect(await panel.getByText(`${reply} 已修改`, { exact: true }).count()).toBe(0)
      expect((await teamCall(users.member, 'conversations/timeline/page', { conversation_uid: uid, side: 'team' }, true)).data.reason).toBe('not_accessible')
      await service.logout(); await service.testLogin(users.visitor)
      await page.reload()
      await page.getByRole('button', { name: '团队消息', exact: true }).click()
      await page.getByText('通过通道链接联系团队', { exact: true }).click()
      await page.getByRole('textbox', { name: '团队消息通道链接' }).fill(`${origin}/team-message?channel=${channel.public_ref}`)
      await page.getByRole('button', { name: '打开通道', exact: true }).click()
      await page.getByText(`${reply} 已修改`, { exact: true }).waitFor()
      await page.getByRole('button', { name: '我的咨询', exact: true }).click()
      await page.getByRole('navigation', { name: '团队会话' }).getByRole('button', { name: /即我团队验收/ }).click()
      await page.getByText(`${reply} 已修改`, { exact: true }).waitFor()
      expect(await page.getByRole('heading', { name: '团队成员', exact: true }).count()).toBe(0)
      expect(upstreamRequests.some(path => path.endsWith('/messages/send'))).toBe(true)
    } catch (error) {
      failures.push(error)
      if (page && process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: `${process.env.ARKME_E2E_SCREENSHOT}.failure.png` }).catch(() => {})
    } finally {
      const cleanup = async action => { try { await action() } catch (error) { failures.push(error) } }
      await cleanup(() => browser?.close())
      if (scaffold) await cleanup(() => scaffold.ctx.get('arkmeData').logout())
      await cleanup(() => scaffold?.close())
      for (const server of [proxy, accounts]) { server.closeAllConnections(); await cleanup(() => new Promise(done => server.close(done))) }
      await cleanup(() => rm(root, { recursive: true, force: true }))
      if (failures.length) throw new AggregateError(failures, 'Team real-process acceptance failed')
    }
  })
})
