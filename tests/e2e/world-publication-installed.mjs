// Official installed DSH + packaged Host/SDK/Tools/UI. Business writes use only
// the explicitly supplied loopback Record/Team/World Mongo integration fixture.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
const { DSH_HOME: home, ARKME_DSH_RUNTIME: runtime, ARKME_PLAYWRIGHT_ANCHOR: playwright, WORLD_STACK_HANDOFF: handoff, ARKME_E2E_TLS_KEY: key, NODE_EXTRA_CA_CERTS: cert } = process.env
assert(home && runtime && playwright && handoff && key && cert, 'isolated runtime, stack and TLS required')
const fixture = JSON.parse(await readFile(handoff, 'utf8'))
for (const owner of ['record', 'team', 'world']) assert(Number.isSafeInteger(fixture[owner]) && fixture[owner] > 0 && fixture[owner] < 65536)
const req = createRequire(join(runtime, 'package.json')), dsh = createRequire(req.resolve('@deepseek-ai/dsh/package.json'))
const load = name => import(pathToFileURL(dsh.resolve(name)).href)
const { runProfile } = await load('@deepseek-ai/dsh/profile-boot')
const { createLaunchEnvironmentSnapshot } = await load('@deepseek-ai/dsh-launch-environment')
const { createUserMessage, createToolResultMessage } = await load('@deepseek-ai/dsh-llm')
const { chromium } = createRequire(playwright)('playwright')
const profile = join(home, 'profiles/web'), packed = createRequire(join(profile, 'package.json'))
const { createArkmeSdk } = await import(pathToFileURL(packed.resolve('@senguoyun/dsh-arkme/sdk')).href)
for (const name of Object.keys(process.env)) if (/^ARKME_DESKTOP_/.test(name)) delete process.env[name]
let shutdown, browser, agentHandle, host
const misses = new Set(), errors = [], publicBody = '官方 DSH 端到端团队世界验收'
const api = createServer({ key: await readFile(key), cert: await readFile(cert) }, async (request, response) => {
  try {
    const path = new URL(request.url, 'https://127.0.0.1').pathname, chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks), payload = JSON.parse(body.toString() || '{}')
    const route = path, owner = route.startsWith('/api/v1/team-world/') || route.startsWith('/api/v1/reactions/world/') ? 'record' : route.includes('/team/') ? 'team' : 'world'
    if (owner === 'record' && route.startsWith('/api/v1/team-world/') || owner === 'record' && route.startsWith('/api/v1/reactions/world/') || owner === 'team' && (route.startsWith('/api/v1/team/world/') || route === '/api/public/v1/team/public-card') || owner === 'world' && route.startsWith('/api/public/v1/world/') || owner === 'world' && route === '/api/v1/world-interaction/notifications') {
      const target = route === '/api/v1/world-interaction/notifications' ? '/fixture/notifications' : route
      const upstream = await fetch(`http://127.0.0.1:${fixture[owner]}${target}`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'X-Internal-Secret': fixture.secret, 'X-User-Id': String(fixture.actor) }, signal: AbortSignal.timeout(25000) })
      response.writeHead(upstream.status, { 'content-type': 'application/json' }); response.end(await upstream.text()); return
    }
    let data = { items: [], users: [], sources: [], teams: [], has_more: false }
    if (route.endsWith('/the-best-api-for-testing')) {
      assert.equal(payload.user_id, fixture.actor)
      const token = [{ alg: 'none' }, { user_id: fixture.actor, exp: Math.floor(Date.now()/1000)+3600 }].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.fixture'
      data = { access_token: token, refresh_token: 'world-fixture-session' }
    } else if (route.endsWith('/get-user-info')) data = { user_id: fixture.actor, nick_name: '验收管理员', jotmo_id: 'fixture_admin', phone: '13800000000' }
    else if (route.endsWith('/team/list-mine')) data = { teams: [{ team_id: 7, jotmo_id: 'fixture_team', name: 'Fixture team', owner_user_id: 10, role: 2, member_count: 3, avatar: { mode: 'default', key: 'default:team' } }] }
    else if (route.endsWith('/get-public-users-by-ids')) data = { items: (payload.user_ids ?? []).map(id => ({ user_id: id, jotmo_id: 'fixture_user', nick_name: '验收用户', member_type: 0 })) }
    else misses.add(path)
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ code: 200, data }))
  } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: String(error) })) }
})
try {
  api.listen(0, '127.0.0.1'); await once(api, 'listening')
  const base = `https://127.0.0.1:${api.address().port}`
  const config = { environment: 'test', stateDirectory: join(home,'world-state'), keychainServicePrefix: `com.senqisi.world-${randomUUID()}`, allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business', shareWebsite: 'https://app-test.arkme.ai' }
  for (const owner of ['auth','subject','record','data','team','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService','updateArtifact']) config[`${owner}BaseUrl`] = base
  config.updateServiceBaseUrl = base; config.updateArtifactBaseUrl = base
  const overlay = join(home, 'world-overlay.json'); await writeFile(overlay, JSON.stringify([{ id: 'arkme-self', config }]))
  const boot = await runProfile({ environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: { ...process.env, DSH_TELEMETRY: '0' } }]), profile: 'web', patchFiles: [overlay], args: ['--host','127.0.0.1','--port','0','--no-open'] })
  shutdown = boot.shutdown; const ctx = boot.ctx; host = ctx.get('arkmeData')
  assert.equal((await host.testLogin(fixture.actor)).status, 'authenticated')
  const origin = ctx.get('webServer').getOrigin()
  // Use the official connection's authenticated URL to obtain a browser session.
  browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(ctx.get('connection').authenticatedUrl(origin))
  const sdk = createArkmeSdk({ fetchImpl: async (path, init) => {
    const response = await page.request.fetch(new URL(path, origin).href, { method: init?.method, data: init?.body, headers: { ...init?.headers, Origin: origin } })
    return new Response(await response.body(), { status: response.status(), headers: response.headers() })
  } })
  const accountKey = `test:${fixture.actor}`, context = await sdk.teamWorld({ action: 'context', accountKey, jotmoId: 'fixture_team' })
  assert(context.capabilities.publish && context.capabilities.manage)
  const source = await sdk.teamWorld({ action: 'source', accountKey, version: 1, origin: { kind: 'local', sourceRef: 'fixture', itemUid: randomUUID(), textContent: publicBody, sourceLabel: 'DSH acceptance snapshot', sendAtMillis: Date.now(), hasAttachments: false } })
  const command = { action: 'submit', accountKey, teamRef: context.teamRef, requestUid: randomUUID(), expectedRevision: 0, change: 'publish', draft: { title: '团队公开验收', text: publicBody, format: 'plain', sourceRef: source.sourceRef, imageRefs: [] } }
  agentHandle = await ctx.agents.create({ sessionId: `world-${randomUUID()}`, meta: { cwd: home } })
  const { agent } = agentHandle; await agent.whenIdle()
  const names = ctx.tools.schemas(agent).map(tool => tool.name)
  for (const name of ['arkme_world_recent','arkme_world_reactions_read','arkme_world_reactions_write','arkme_team_world_read','arkme_team_world_write','arkme_world_reply']) assert(names.includes(name), name)
  let step = 0
  const invoke = async (name, args) => {
    const callId = randomUUID(), call = agent.session.append('tool/call', { turn: 1, step: ++step, callId, name, arguments: JSON.stringify(args) })
    const result = await ctx.tools.execute({ agent, name, callId, arguments: args, signal: AbortSignal.timeout(30000) })
    agent.session.append('tool/result', { turn:1, step, message: createToolResultMessage({ callId, content:result.content, isError:result.isError }) }, { surfaceOp:'append', sourceEventSeqs:[call.seq] })
    return result
  }
  assert.match(JSON.stringify(await invoke('arkme_team_world_write', { request_json: JSON.stringify(command) })), /confirmation_required/)
  agent.session.append('user/message', createUserMessage({ source:{kind:'user'}, content:[{type:'text',text:`确认以 Fixture team 团队发布以下内容：${publicBody}`}]}), {surfaceOp:'append'})
  const published = await invoke('arkme_team_world_write', { request_json: JSON.stringify(command) })
  assert(!published.isError && !JSON.stringify(published).includes('confirmation_required'), JSON.stringify(published))
  const receipt = await sdk.teamWorld({ action:'status', accountKey, requestUid:command.requestUid })
  assert(receipt && !receipt.pending && receipt.result.visibility === 'published')
  const replay = await sdk.teamWorld(command)
  assert.deepEqual({ ...replay, contentRef: undefined }, { ...receipt, contentRef: undefined })
  const original = await sdk.teamWorld({ action:'original', accountKey, contentRef:receipt.contentRef })
  const contexts = await sdk.prepareWorldReactions(accountKey, [original.recordRef]); assert.equal(contexts.items.length,1)
  const feed = await sdk.worldFeed(); assert(feed.items.some(item => item.teamAuthor?.name === 'Fixture team' && item.textContent === publicBody))
  assert(!JSON.stringify(feed).includes('source_proof'))
  assert(!(await invoke('arkme_world_recent', { notifications:true })).isError)
  assert(!(await invoke('arkme_world_reactions_read', { request_json:JSON.stringify({action:'query',accountKey,targets:[contexts.items[0].target]}) })).isError)
  await sdk.worldReplies(original.recordRef)
  await page.getByRole('button', {name:'探索',exact:true}).click()
  await page.getByRole('button', {name:'世界',exact:true}).click()
  await page.getByText(publicBody,{exact:true}).first().waitFor()
  assert((await page.locator('[data-world-record-ref]').filter({hasText:publicBody}).innerText()).includes('团队'))
  const capture = process.env.ARKME_E2E_CAPTURE_DIR
  if(capture) {await mkdir(capture,{recursive:true});await page.screenshot({path:join(capture,'world-team-feed.png')})}
  await page.getByRole('button',{name:'查看Fixture team的用户卡片',exact:true}).first().click()
  await page.getByRole('button',{name:'查看团队资料',exact:true}).click()
  const card = page.getByRole('dialog',{name:/团队资料/})
  await card.getByText('@fixture_team',{exact:true}).waitFor()
  assert(!(await card.getByRole('button',{name:'联系团队',exact:true}).isDisabled()))
  assert(!(await card.innerText()).includes('后端接口开发中'))
  if(capture) await page.screenshot({path:join(capture,'world-team-public-card.png')})
  await page.keyboard.press('Escape')
  await page.getByRole('main',{name:'团队的世界',exact:true}).getByRole('button',{name:'返回',exact:true}).click()
  await page.getByRole('button',{name:'我的团队操作',exact:true}).click()
  await page.getByRole('heading',{name:'我的团队操作',exact:true}).waitFor()
  await page.getByRole('dialog',{name:'我的团队操作',exact:true}).getByText(/当时结果/).first().waitFor()
  if(capture) await page.screenshot({path:join(capture,'world-team-activity.png')})
  const hidden=await sdk.teamWorld({action:'submit',accountKey,teamRef:context.teamRef,contentRef:receipt.contentRef,requestUid:randomUUID(),expectedRevision:original.revision,change:'unpublish'})
  assert.equal(hidden.result.visibility,'unpublished')
  assert(!(await sdk.worldFeed()).items.some(item=>item.textContent===publicBody))
  assert.deepEqual(errors, [], 'no uncaught browser errors')
  await ctx.sessions.flush(agent.session)
  console.log(JSON.stringify({acceptance:'installed-world-real-three-service',officialRuntime:'0.2.1-rc.2',toolsDiscovered:true,unrequestedWriteDenied:true,explicitGrantPublished:true,exactRetry:true,typedTeamFeed:true,privateOriginal:true,reactions:true,notifications:true,ui:true,withdrawn:true,browserErrors:errors,fixtureOnlyPeripheralRoutes:[...misses]}))
} finally {
  await writeFile(handoff.replace(/\.[^.]+$/,'.done'),'done')
  await agentHandle?.dispose(); await browser?.close(); await host?.logout(); await shutdown?.shutdown(0); api.closeAllConnections(); await new Promise(done=>api.close(done))
}
