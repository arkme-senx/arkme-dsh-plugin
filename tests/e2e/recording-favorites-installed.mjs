// Immutable package, official DSH session and real TEST APIs. Uses explicitly supplied isolated fixture accounts.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const runtime = process.env.ARKME_DSH_RUNTIME, home = process.env.DSH_HOME, anchor = process.env.ARKME_PLAYWRIGHT_ANCHOR, capture = process.env.ARKME_E2E_CAPTURE_DIR
const sid = process.env.ARKME_FAVORITE_TEST_SID, collector = Number(process.env.ARKME_FAVORITE_TEST_COLLECTOR), owner = Number(process.env.ARKME_FAVORITE_TEST_OWNER)
assert(runtime && home && anchor && capture && /^[A-Za-z0-9]{16}$/.test(sid ?? '') && collector > 99000000 && owner > 99000000, 'explicit isolated TEST fixture required')
const req = createRequire(join(runtime, 'package.json')), dshReq = createRequire(req.resolve('@deepseek-ai/dsh/package.json'))
const load = name => import(pathToFileURL(dshReq.resolve(name)).href)
const { runProfile } = await load('@deepseek-ai/dsh/profile-boot')
const { createLaunchEnvironmentSnapshot } = await load('@deepseek-ai/dsh-launch-environment')
const { createUserMessage, createToolResultMessage } = await load('@deepseek-ai/dsh-llm')
const { chromium } = createRequire(anchor)('playwright')
for (const name of ['ARKME_DESKTOP_BRIDGE_URL', 'ARKME_DESKTOP_BRIDGE_TOKEN', 'ARKME_DESKTOP_BRIDGE_SESSION_ID']) delete process.env[name]
const profile = join(home, 'profiles/web'), manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
assert.match(manifest.dependencies['@senguoyun/dsh-arkme'], /^file:.*\.tgz$/)
await mkdir(capture, { recursive: true })
const config = { environment: 'test', allowProduction: false, stateDirectory: join(home, 'favorite-state'), keychainServicePrefix: 'com.senqisi.favorite-e2e-' + randomUUID(), updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business', shareWebsite: 'https://jotmo.senguo.me', authBaseUrl: 'https://jotmo.senguo.me' }
for (const key of ['subject', 'record', 'data', 'team', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish']) config[`${key}BaseUrl`] = `https://jotmo-${key === 'openApi' ? 'openapi' : key === 'extensionPublish' ? 'extension-publish' : key}.senguo.me`
const overlay = join(home, 'favorite-test-overlay.json'); await writeFile(overlay, JSON.stringify([{ id: 'arkme-self', config }]))
let boot, browser, page, agentHandle
const checks = [], pageErrors = [], audioResponses = []
const check = (name, value) => { assert(value, name); checks.push({ name, passed: true }); console.log('PASS', name) }
const eventually = async (fn, message, timeout = 30000) => { const until = Date.now() + timeout; while (!await fn()) { if (Date.now() > until) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 100)) } }
try {
  boot = await runProfile({ environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: { ...process.env, DSH_TELEMETRY: '0' } }]), profile: 'web', patchFiles: [overlay], args: ['--host', '127.0.0.1', '--port', '0', '--no-open'] })
  const ctx = boot.ctx, host = ctx.get('arkmeData')
  check('TEST account authenticated', (await host.testLogin(collector)).status === 'authenticated')
  const before = await host.recordingFavorites({ action: 'status', sid })
  const saved = before.saved ? await host.recordingFavorites({ action: 'detail', favoriteRef: before.favoriteRef, accountKey: before.accountKey }) : await host.recordingFavorites({ action: 'save', sid, expectedVersion: before.version, accountKey: before.accountKey })
  check('real TEST collection uses ordered clips', saved.saved && saved.available && saved.audio.clips.length === saved.segments.length)
  agentHandle = await ctx.agents.create({ sessionId: 'recording-favorites-' + randomUUID(), meta: { cwd: home } })
  const agent = agentHandle.agent; await agent.whenIdle()
  check('real DSH session discovers both tools', ['arkme_recording_favorites', 'arkme_recording_favorites_change'].every(name => ctx.tools.schemas(agent).some(tool => tool.name === name)))
  let step = 0
  const invoke = async (name, args) => {
    const callId = randomUUID(), call = agent.session.append('tool/call', { turn: 1, step: ++step, callId, name, arguments: JSON.stringify(args) })
    const result = await ctx.tools.execute({ agent, name, callId, arguments: args, signal: AbortSignal.timeout(30000) })
    agent.session.append('tool/result', { turn: 1, step, message: createToolResultMessage({ callId, content: result.content, isError: result.isError }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    return result
  }
  check('real session read tool succeeds without marking read', !(await invoke('arkme_recording_favorites', { action: 'page' })).isError)
  const command = { action: 'remove', account_key: saved.accountKey, favorite_ref: saved.favoriteRef, expected_version: saved.version }
  check('mutation tool requires conversational authorization', JSON.stringify(await invoke('arkme_recording_favorites_change', command)).includes('confirmation_required'))
  check('unapproved mutation does not change collection', (await host.recordingFavorites({ action: 'status', sid })).saved)
  agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '确认取消刚才选定的这段测试录音收藏。' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  check('authorized tool removes the exact collection', !(await invoke('arkme_recording_favorites_change', command)).isError)
  const removed = await host.recordingFavorites({ action: 'status', sid })
  check('removed collection is absent', !removed.saved)
  await host.recordingFavorites({ action: 'save', sid, accountKey: removed.accountKey, expectedVersion: removed.version })
  browser = await chromium.launch({ channel: 'chrome', args: ['--mute-audio'] })
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  await page.addInitScript(() => { const Audio = window.Audio; window.__favoriteAudio = []; window.Audio = class extends Audio { constructor(...args) { super(...args); window.__favoriteAudio.push(this) } } })
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('response', response => { if (response.url().includes('/api/media?ref=') && response.headers()['content-type']?.startsWith('audio/')) audioResponses.push(response.status()) })
  const origin = ctx.get('webServer').getOrigin()
  await page.goto(ctx.get('connection').authenticatedUrl(origin))
  const consumer = join(profile, 'recording-favorite-consumer'); await mkdir(consumer, { recursive: true })
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ type: 'module', private: true }))
  await copyFile(join(repo, 'tests/consumers/recording-favorites/consumer.ts'), join(consumer, 'consumer.ts'))
  execFileSync(process.execPath, [join(repo, 'node_modules/typescript/bin/tsc'), '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--strict', '--skipLibCheck', '--outDir', join(consumer, 'out'), join(consumer, 'consumer.ts')], { cwd: consumer, stdio: 'pipe' })
  const { verifyInstalledFavorites } = await import(pathToFileURL(join(consumer, 'out/consumer.js')).href)
  const sdk = await verifyInstalledFavorites(async (path, init) => {
    const response = await page.request.fetch(new URL(path, origin).href, { method: init?.method, data: init?.body, headers: { ...init?.headers, Origin: origin } })
    return new Response(await response.body(), { status: response.status(), headers: response.headers() })
  }, sid)
  check('external consumer compiles and calls installed SDK against TEST', sdk.clipCount > 0)
  await page.getByRole('button', { name: '录音', exact: true }).click()
  await page.getByRole('button', { name: '我收藏的录音', exact: true }).waitFor()
  await page.screenshot({ path: join(capture, '01-recording-entry.png') })
  await page.getByRole('button', { name: '我收藏的录音', exact: true }).click()
  await page.locator('.arkme-favorite-row').first().waitFor()
  await page.screenshot({ path: join(capture, '02-favorites-list.png') })
  await page.locator('.arkme-favorite-row').first().click()
  await page.locator('[data-arkme-shared-recording-segment]').first().waitFor()
  check('collector has no source or revoke control', await page.getByRole('button', { name: '查看原录音', exact: true }).count() === 0 && await page.getByRole('button', { name: '撤销授权', exact: true }).count() === 0)
  await page.getByRole('button', { name: '播放全部', exact: true }).last().click()
  await eventually(() => page.evaluate(() => window.__favoriteAudio.some(audio => audio.currentTime > .1 && !audio.paused)), 'actual TEST audio did not advance')
  await page.evaluate(() => { window.__favoritePlayed = window.__favoriteAudio.filter(audio => audio.src.includes('/api/media?ref=')) })
  check('browser plays real TEST clip bytes', audioResponses.some(status => status === 200 || status === 206))
  await page.screenshot({ path: join(capture, '03-favorite-playing.png') })
  await page.emulateMedia({ colorScheme: 'dark' })
  await eventually(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme')), 'DSH did not apply system dark theme')
  await page.screenshot({ path: join(capture, '03b-favorite-dark.png') })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.getByRole('button', { name: '播放速度', exact: true }).click()
  await eventually(() => page.evaluate(() => window.__favoriteAudio.filter(audio => audio.src.includes('/api/media?ref=')).some(audio => audio.currentTime > .1 && audio.playbackRate === 1.25) && window.__favoritePlayed[0].paused && !window.__favoritePlayed[0].getAttribute('src')), 'second real clip did not play at selected speed', 20000)
  check('ordered clips advance with selected playback speed', true)
  await page.evaluate(() => { window.__favoritePlayed = window.__favoriteAudio.filter(audio => audio.src.includes('/api/media?ref=')) })
  await page.getByRole('button', { name: '取消收藏', exact: true }).click()
  await page.getByRole('dialog', { name: '取消收藏？', exact: true }).getByRole('button', { name: '取消收藏', exact: true }).click()
  await eventually(async () => !(await host.recordingFavorites({ action: 'status', sid })).saved, 'UI removal was not persisted')
  await eventually(() => page.evaluate(() => window.__favoritePlayed.length > 0 && window.__favoritePlayed.every(audio => audio.paused && !audio.getAttribute('src'))), 'removed favorite playback was not released')
  await eventually(() => page.locator('.arkme-favorite-row').count().then(count => count === 0), 'removed favorite remained in its list')
  check('UI removal is persisted and playback released', true)
  await host.testLogin(owner)
  const notices = await host.recordingFavorites({ action: 'notifications' })
  const notice = notices.items.find(item => item.preview === saved.preview)
  check('sharer receives durable notification after collection removal', !!notice)
  const retained = await host.recordingFavorites({ action: 'detail', accountKey: notices.accountKey, favoriteRef: notice.favoriteRef })
  check('sharer retains playback after collector removes', retained.available && retained.audio.clips.length > 0)
  await page.reload()
  await page.getByRole('button', { name: '对话', exact: true }).click()
  const skipTour = page.getByRole('button', { name: '跳过引导', exact: true }); await skipTour.waitFor(); await skipTour.click(); await skipTour.waitFor({ state: 'hidden' })
  await page.getByRole('treeitem', { name: /通知/ }).first().click()
  await page.getByRole('button', { name: /^查看收藏片段/ }).first().waitFor()
  await page.screenshot({ path: join(capture, '04-favorite-notifications.png') })
  await page.getByRole('button', { name: /^查看收藏片段/ }).first().click()
  await page.locator('[data-arkme-shared-recording-segment]').first().waitFor()
  await page.screenshot({ path: join(capture, '05-sharer-detail.png') })
  check('notification opens read-only selected excerpt', await page.getByRole('button', { name: '取消收藏', exact: true }).count() === 0)
  await writeFile(join(capture, 'checks.json'), JSON.stringify({ checks, sdk, audioResponses, pageErrors, runtimeVersion: '0.2.1-rc.2' }, null, 2))
} catch (error) { process.exitCode = 1; console.error('FAVORITE_E2E_FAILED', error) } finally {
  if (page) await page.screenshot({ path: join(capture, 'last-state.png') }).catch(() => {})
  await writeFile(join(capture, 'checks-partial.json'), JSON.stringify({ checks, audioResponses, pageErrors }, null, 2))
  await agentHandle?.dispose().catch(() => {}); await browser?.close(); if (boot) boot.shutdown.shutdown(process.exitCode ?? 0)
}
