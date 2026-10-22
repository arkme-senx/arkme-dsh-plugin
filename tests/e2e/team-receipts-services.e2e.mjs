// Real Team/Record/IM processes, Mongo replica set, RabbitMQ and Redis.
// Only account identities and unrelated legacy panes are fixtures.
import { createHmac, randomUUID } from 'node:crypto'
import { createServer as httpServer } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { expect, it } from 'vitest'

const dsh = process.env.ARKME_DSH_CHECKOUT, profile = process.env.ARKME_PACKED_PROFILE
const signing = process.env.ARKME_TEAM_E2E_SIGNING_KEY
const origins = Object.fromEntries(['team', 'record', 'im'].map(k => [k, process.env[`ARKME_${k.toUpperCase()}_E2E_ORIGIN`]]))
const accountPort = Number(process.env.ARKME_ACCOUNT_FIXTURE_PORT)
if (!dsh || !profile || !signing || !accountPort || Object.values(origins).some(v => !v || new URL(v).hostname !== '127.0.0.1')) throw new Error('Isolated service origins, profile and synthetic signing key required')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('Install immutable tgz through official CLI')
const { launchWebScaffold } = await import(pathToFileURL(join(dsh, 'apps/web/tests/scaffold.ts')).href)
const { chromium } = createRequire(join(dsh, 'apps/web/package.json'))('playwright')
const users = { owner: 99102001, member: 99102002, other: 99102003, visitor: 99102004, late: 99102005 }
const names = new Map(Object.entries(users).map(([k, v]) => [v, `回执实链-${k}`]))
const poll = callback => expect.poll(callback, { timeout: 15_000 })
const identity = id => ({ user_id: id, nick_name: names.get(id), jotmo_id: `receipt_${id}`, head_img: '', identity_ready: true })
function token(id) {
  const body = [{ alg: 'HS256', typ: 'JWT' }, { user_id: id, client_id: id + 1, iss: 'jotmo', exp: Math.floor(Date.now() / 1000) + 3600 }].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')
  return `${body}.${createHmac('sha256', signing).update(body).digest('base64url')}`
}
async function teamCall(id, path, body = {}, denied = false) {
  const response = await fetch(`${origins.team}/api/v1/team/${path}`, { method: 'POST', headers: { authorization: `Bearer ${token(id)}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json()
  if (denied) { expect(result.code).not.toBe(200); return result }
  expect(result, path).toMatchObject({ code: 200 }); return result.data
}

it('runs incoming, colleague and own receipts through real services and revokes an open reader without leaking history membership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'team receipts real services ')), calls = [], errors = [], streams = new Set()
  let scaffold, browser, page
  const handler = async (req, res) => {
    const cancel = new AbortController()
    res.on('close', () => cancel.abort())
    try {
      const chunks = []; for await (const part of req) chunks.push(part)
      const body = Buffer.concat(chunks), input = body.length ? JSON.parse(body) : {}, path = new URL(req.url, 'http://localhost').pathname
      let data = { items: [], users: [], sources: [], has_more: false }
      if (path === '/api/internal/v1/auth/public-user-identities/query') data = { items: (input.user_ids ?? []).map(identity) }
      else if (path === '/api/internal/v1/auth/ensure-jotmo-id') data = { created: true, name: input.name }
      else if (path.endsWith('/the-best-api-for-testing')) data = { access_token: token(input.user_id), refresh_token: `synthetic-${input.user_id}` }
      else if (path.endsWith('/get-user-info')) {
        const id = JSON.parse(Buffer.from(req.headers.authorization.split(' ')[1].split('.')[1], 'base64url')).user_id
        data = { ...identity(id), phone: '13800000000' }
      } else if (/^\/api\/(v1|public\/v1)\/team\//.test(path) || /^\/api\/v1\/(records|files|sse)\//.test(path) || path.startsWith('/api/internal/v1/record/')) {
        calls.push({ path, input })
        const upstreamOrigin = path.startsWith('/api/internal/v1/record/') ? origins.record : path.includes('/team/') ? origins.team : path.includes('/sse/') ? origins.im : origins.record
        const upstream = await fetch(`${upstreamOrigin}${req.url}`, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : body, signal: cancel.signal })
        res.writeHead(upstream.status, Object.fromEntries([...upstream.headers].filter(([k]) => !['transfer-encoding', 'content-encoding', 'content-length'].includes(k))))
        if (path.includes('/sse/')) {
          streams.add(res); res.on('close', () => streams.delete(res))
          Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res)
        } else res.end(Buffer.from(await upstream.arrayBuffer()))
        return
      }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code: 200, data }))
    } catch (error) { if (!cancel.signal.aborted) { res.writeHead(500); res.end(JSON.stringify({ error: String(error) })) } }
  }
  const account = httpServer(handler), proxy = httpsServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, handler)
  try {
    account.listen(accountPort, '127.0.0.1'); await once(account, 'listening')
    proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
    const team = (await teamCall(users.owner, 'create', { request_uid: randomUUID(), name: `真实回执链路团队 ${randomUUID().slice(0, 8)}`, jotmo_id: `receipts_${randomUUID().replaceAll('-', '').slice(0, 12)}` })).team
    let channel = await teamCall(users.owner, 'message-channel/get', { team_id: team.team_id })
    channel = await teamCall(users.owner, 'message-channel/configure', { team_id: team.team_id, expected_revision: channel.revision, enabled: true })
    const joinMember = async id => {
      const application = await teamCall(id, 'join-requests/create', { team_id: team.team_id, request_uid: randomUUID() })
      await teamCall(users.owner, 'join-requests/decide', { team_id: team.team_id, user_id: id, revision: application.revision, approve: true })
    }
    await joinMember(users.member); await joinMember(users.other)
    const conversation = (await teamCall(users.visitor, 'conversations/open', { public_ref: channel.public_ref })).conversation, uid = conversation.conversation_uid
    const send = async (id, side, text) => teamCall(id, 'conversations/messages/send', { conversation_uid: uid, side, client_message_uid: randomUUID(), content: { text_content: text, template_kind: 1 } })
    const incoming = await send(users.visitor, 'external', '真实来信：请共同查看'), reply = await send(users.member, 'team', '真实同事回复')
    await joinMember(users.late)
    const summaryBody = { conversation_uid: uid, side: 'team', message_uids: [incoming.message_uid, reply.message_uid] }
    const historical = await teamCall(users.late, 'conversations/read-receipts/summary-list', summaryBody)
    expect(historical.items.map(v => v.summary.recipient_count)).toEqual([3, 2])
    expect((await teamCall(users.late, 'conversations/timeline/page', { conversation_uid: uid, side: 'team' })).messages).toHaveLength(2)

    const origin = `https://127.0.0.1:${proxy.address().port}`, config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: `com.senqisi.receipts-real-${randomUUID()}`, allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'disabled', shareWebsite: origin }
    for (const key of ['auth', 'subject', 'record', 'data', 'team', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[`${key}BaseUrl`] = origin
    const overlay = join(root, 'overlay.json'); await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'receipts-real-services', name: '@senguoyun/dsh-arkme', config }] }]))
    scaffold = await launchWebScaffold({ harnessHome: resolve(profile, '../..'), extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')], replayFixture: resolve(dsh, 'snapshots/web/plan-narrow-viewport/session.v3.jsonl'), replayProvidersOnly: true, compareReplaySession: false })
    expect(await scaffold.ctx.get('arkmeData').testLogin(users.member)).toMatchObject({ status: 'authenticated' })
    browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message))
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: '联系人', exact: true }).click()
    const section = page.locator('[data-directory-section="teams"]'), toggle = section.locator('.arkme-contact-directory-section-header')
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    await section.getByRole('button', { name: new RegExp(team.name) }).click()
    await page.locator('.arkme-team-detail').getByRole('button', { name: '团队消息通道', exact: true }).click()
    await page.getByRole('dialog', { name: /团队消息通道/ }).getByRole('button', { name: '查看团队对话', exact: true }).click()
    await page.getByRole('treeitem').filter({ hasText: names.get(users.visitor) }).click()
    const pane = page.locator('.team-conversation-pane'), row = pane.locator('article').filter({ hasText: '真实来信：请共同查看' }), editor = pane.getByRole('textbox', { name: '团队消息内容' })
    await row.getByRole('button', { name: /查看阅读状态.*团队已读 1\/3/ }).waitFor()
    await poll(() => streams.size).toBeGreaterThan(0)
    await editor.fill('保留的真实草稿')
    await row.getByRole('button', { name: /查看阅读状态/ }).click()
    const details = page.getByRole('dialog', { name: '查看阅读状态', exact: true })
    await details.getByText(names.get(users.other), { exact: true }).waitFor()
    expect(await details.getByText(names.get(users.late), { exact: true }).count()).toBe(0)
    const bodyReads = calls.filter(c => c.path.endsWith('/timeline/page')).length
    const recordReads = calls.filter(c => c.path === '/api/internal/v1/record/team/read').length
    expect(recordReads).toBeGreaterThan(0)
    await row.locator('.arkme-timed-bubble').evaluate(n => window.__realReceiptBubble = n)
    const advance = async id => teamCall(id, 'conversations/read/advance', { conversation_uid: uid, side: 'team', read_seq: reply.seq })
    await advance(users.owner)
    await poll(() => details.innerText()).toContain('2/3')
    await advance(users.other)
    await poll(() => details.innerText()).toContain('3/3')
    await poll(() => details.getByText('已读', { exact: true }).count()).toBe(3)
    expect(calls.filter(c => c.path.endsWith('/timeline/page')).length).toBe(bodyReads)
    expect(calls.filter(c => c.path === '/api/internal/v1/record/team/read').length).toBe(recordReads)
    expect(await editor.textContent()).toBe('保留的真实草稿')
    expect(await row.locator('.arkme-timed-bubble').evaluate(n => n === window.__realReceiptBubble)).toBe(true)
    const external = await teamCall(users.visitor, 'conversations/read-receipts/summary-list', { conversation_uid: uid, side: 'external', message_uids: [incoming.message_uid] })
    expect(external.items).toEqual([{ message_uid: incoming.message_uid, team_read: true }])
    await teamCall(users.visitor, 'conversations/read-receipts/summary-list', { conversation_uid: uid, side: 'external', message_uids: [reply.message_uid] }, true)
    await page.keyboard.press('Escape'); await details.waitFor({ state: 'hidden' })
    await teamCall(users.visitor, 'conversations/read/advance', { conversation_uid: uid, side: 'external', read_seq: reply.seq })
    const replyRow = pane.locator('article').filter({ hasText: '真实同事回复' })
    await replyRow.getByRole('button', { name: /查看阅读状态.*对方已读.*团队已读 2\/2/ }).click()
    await details.getByText('外部联系人', { exact: true }).waitFor()
    expect(await details.getByText(names.get(users.member), { exact: true }).count()).toBe(0)
    await page.keyboard.press('Escape'); await details.waitFor({ state: 'hidden' })
    await editor.fill('真实页面发出的后续回复')
    await pane.getByRole('button', { name: '发送', exact: true }).click()
    await pane.locator('article').filter({ hasText: '真实页面发出的后续回复' }).waitFor()
    let own
    await poll(async () => {
      const timeline = await teamCall(users.owner, 'conversations/timeline/page', { conversation_uid: uid, side: 'team' })
      own = timeline.messages.find(m => m.record?.text_content === '真实页面发出的后续回复')
      return own?.state
    }).toBe('published')
    expect(own).toMatchObject({ actor_user_id: users.member, state: 'published', record: { status: 'available' } })
    const ownReceipts = await teamCall(users.owner, 'conversations/read-receipts/query', { conversation_uid: uid, side: 'team', message_uid: own.message_uid, limit: 50 })
    expect(ownReceipts.members.map(m => m.user_id).sort()).toEqual([users.owner, users.other, users.late].sort())
    await row.getByRole('button', { name: /查看阅读状态.*团队已读 3\/3/ }).click(); await details.waitFor()
    if (process.env.ARKME_E2E_CAPTURE_DIR) { await mkdir(process.env.ARKME_E2E_CAPTURE_DIR, { recursive: true }); await page.screenshot({ path: join(process.env.ARKME_E2E_CAPTURE_DIR, 'team-receipts-real-services.png') }) }
    await teamCall(users.owner, 'members/remove', { team_id: team.team_id, target_user_id: users.member })
    await details.waitFor({ state: 'hidden' })
    await poll(() => page.getByText('真实来信：请共同查看', { exact: true }).count()).toBe(0)
    await teamCall(users.member, 'conversations/read-receipts/summary-list', summaryBody, true)
    expect(errors).toEqual([])
  } catch (error) {
    console.log(JSON.stringify({ calls: calls.slice(-15), page: await page?.locator('body').innerText() }))
    throw error
  } finally {
    await browser?.close()
    if (scaffold) { await scaffold.ctx.get('arkmeData').logout(); await scaffold.close() }
    for (const stream of streams) stream.destroy()
    for (const server of [proxy, account]) { server.closeAllConnections(); await new Promise(done => server.close(done)) }
    await rm(root, { recursive: true, force: true })
  }
})
