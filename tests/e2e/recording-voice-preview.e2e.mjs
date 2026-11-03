// UI review only: real packed plugin/Host/React under unmodified official DSH.
// Backend examples are deterministic fixtures, not a new backend E2E claim.
import { createHmac, randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, mkdir, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
const checkoutInput = process.env.ARKME_DSH_CHECKOUT, profile = process.env.ARKME_PACKED_PROFILE, output = process.env.ARKME_VOICE_UI_CAPTURE
if (!checkoutInput || !profile || !output) throw new Error('Official DSH, fresh packed profile and screenshot output required')
const checkout = await realpath(checkoutInput)
const importFile = path => import(/* @vite-ignore */pathToFileURL(path).href)
const { launchWebScaffold } = await importFile(join(checkout, 'apps/web/tests/scaffold.ts'))
const { connectFreshWorkspaceZh } = await importFile(join(checkout, 'apps/web/tests/support.ts'))
const { chromium } = createRequire(join(checkout, 'apps/web/package.json'))('playwright')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('Immutable .tgz required')
it('captures the existing voice UI and confirms uncertain text once on its card', async () => {
  await mkdir(output, { recursive: true })
  const root = await mkdtemp(join(tmpdir(), 'recording voice UI review ')), writes = []
  const tokenParts = [{ alg: 'HS256', typ: 'JWT' }, { user_id: 10001, client_id: 20001 }].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')
  const token = `${tokenParts}.${createHmac('sha256', 'isolated-ui-review-only').update(tokenParts).digest('base64url')}`
  const now = Date.now()
  const rules = [{ id: 'note-to-self', phrase: '帮我记一下', aliases: [], enabled: true, autoSaveSelf: true, action: 'save-self' }]
  const candidates = [
    { id: 'a'.repeat(64), revision: 1, phrase: rules[0].phrase, text: '周五下午联系李经理，先核对合同金额。', start_at: now - 600000, end_at: now - 570000, speaker: 'self', speaker_label: '本人', status: 'pending', boundary: 'uncertain', evidence: { kind: 'transcript', model: 'deepseek-v4.1-flash', match: 'literal' } },
    { id: 'b'.repeat(64), revision: 1, phrase: rules[0].phrase, text: '明天下午三点给王姐回电话。', start_at: now - 300000, end_at: now - 280000, speaker: 'unknown', speaker_label: '未识别说话人', status: 'pending', boundary: 'complete', evidence: { kind: 'transcript', model: 'deepseek-v4.1-flash', match: 'literal' } },
  ]
  const titles = { personal_profile: '个人档案', record_thought: '阿森有想法（快记）', chat_thought: '阿森有想法（聊天）', arrangement_recognition: '安排', goal_insight: '目标', offline_context: '线下交流关联', recording_voice_trigger: '录音语音触发' }
  const settings = Object.entries(titles).map(([key, title]) => ({ key, title, enabled: false, version: 0, enabled_at: 0 }))
  const server = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, async (req, res) => {
    try {
      const chunks = []; for await (const c of req) chunks.push(c)
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
      let data = { items: [], users: [], has_more: false }
      if (req.url === '/api/public/v1/auth/the-best-api-for-testing') data = { access_token: token, refresh_token: 'isolated-ui-refresh' }
      if (req.url === '/api/v1/auth/get-user-info') data = { user_id: 10001, nick_name: '界面验收示例', phone: '13800000000', phone_binding_policy: { mode: 'none' } }
      // Record uses code=0; Audio/Auth/Intelligent use code=200.
      if (req.url === '/api/v1/settings/capabilities/query') data = settings
      if (req.url === '/api/v1/managed-ai/points/query') data = { unit: 'ai_points', points_per_cny: 100, available_points: '0', reserved_points: '0', granted_points: '0', purchased_points: '0', observed_at: now, grants: [] }
      if (req.url === '/api/v1/premium/get/member') data = { file_size: 1073741824 }
      if (req.url === '/api/v1/premium/get/used-size') data = { used_file_size: 0 }
      if (req.url === '/api/v1/premium/get/vop-limited-opt') data = { used_sec: 0, able_sec: 3600 }
      if (req.url === '/api/v1/premium/get/recording-transcription-usage') data = { month: new Date(now).toISOString().slice(0, 7), total_seconds: 3600, used_seconds: 0, remaining_seconds: 3600, statistics_started_at: 0, breakdown: [1, 2, 3].map(recording_kind => ({ recording_kind, speech_duration_ms: 0, requested_seconds: 0, deducted_seconds: 0, waived_seconds: 0 })) }
      if (req.url === '/api/v1/audio/recording-billing/pending') data = { pending_child_count: 0 }
      if (req.url === '/api/v1/settings/capabilities/update') throw new Error('UI preview must not enable paid analysis')
      if (req.url === '/api/v1/audio/voice-triggers/capabilities') data = { user_id: 10001, ready: true, version: 2, detector: 'transcript', sources: ['upload', 'long-recording', 'all-day'] }
      if (req.url === '/api/v1/audio/voice-triggers/rules/query') data = { user_id: 10001, revision: 1, rules }
      if (req.url === '/api/v1/audio/voice-triggers/candidates/query') data = { user_id: 10001, items: candidates }
      if (req.url === '/api/v1/audio/voice-triggers/candidates/decide') {
        writes.push(body)
        const value = candidates.find(c => c.id === body.id)
        if (!value || body.expected_revision !== value.revision || body.decision !== 'save' || !body.confirmed_range) throw new Error('Explicit current-range confirmation missing')
        value.status = 'saved'; value.revision++; value.record_uid = '71e10a14-e7f6-5274-b4ec-f8c64adad0fd'
        data = { user_id: 10001, candidate: value }
      }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code: req.url.startsWith('/api/v1/settings/capabilities/') ? 0 : 200, data }))
    } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ code: 500, message: String(e) })) }
  })
  let scaffold, browser, page, failure
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const origin = `https://127.0.0.1:${server.address().port}`
    const config = { environment: 'test', stateDirectory: join(root, 'state'), fileStateDirectory: join(root, 'files'), keychainServicePrefix: `com.senqisi.voice-review-${randomUUID()}`, allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business' }
    for (const key of ['memoryCore', 'auth', 'subject', 'record', 'data', 'team', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[`${key}BaseUrl`] = origin
    config.shareWebsite = origin
    const overlay = join(root, 'overlay.json'); await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'arkme-voice-ui-review', name: '@senguoyun/dsh-arkme', config }] }]))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'node_modules/@senguoyun/dsh-arkme/package.json')] })
    expect(await scaffold.ctx.get('arkmeData').testLogin(10001)).toMatchObject({ status: 'authenticated', userId: 10001 })
    browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
    page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1.5, locale: 'zh-CN' })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspaceZh(page.frameLocator('iframe[title="DeepSeek Harness"]'), scaffold.workspaceCwd)
    await page.getByRole('button', { name: '录音', exact: true }).click()
    await page.getByRole('button', { name: '更多录音操作' }).click()
    await page.getByRole('menuitem', { name: '语音触发' }).click()
    const dialog = page.getByRole('dialog', { name: '语音触发', exact: true })
    await dialog.getByRole('button', { name: '确认保存当前内容', exact: true }).waitFor()
    await dialog.screenshot({ path: join(output, 'plugin-candidates.png') })
    await dialog.getByRole('button', { name: '编辑', exact: true }).click()
    await dialog.getByRole('form', { name: '编辑语音触发规则' }).waitFor()
    await dialog.screenshot({ path: join(output, 'plugin-rules.png') })
    await dialog.getByRole('form').getByRole('button', { name: '取消', exact: true }).click()
    expect(writes).toHaveLength(0)
    await dialog.getByRole('button', { name: '确认保存当前内容', exact: true }).click()
    await dialog.getByText('已保存到发给自己，可继续标记说话人。', { exact: true }).waitFor()
    expect(writes).toHaveLength(1); expect(writes[0].confirmed_range).toBe(true)
    expect(await page.getByRole('dialog').count()).toBe(1)
    expect(await dialog.locator('article').first().innerText()).not.toContain('请试听核对后保存')
    await dialog.screenshot({ path: join(output, 'plugin-saved.png') })
    await dialog.getByRole('button', { name: '关闭语音触发' }).click()
    await page.getByRole('button', { name: /^(个人资料|Profile)$/ }).click()
    await page.getByRole('button', { name: /^(查看用量与额度详情|View usage and limits)$/ }).click()
    const automatic = page.getByRole('region', { name: '自动使用额度', exact: true })
    const voice = automatic.getByRole('switch', { name: '录音口令记事', exact: true })
    await voice.waitFor()
    expect(await automatic.locator('details').count()).toBe(0)
    expect(await automatic.getByRole('switch').count()).toBe(7)
    for (const text of ['「探索 → 个人档案」', '左侧「安排」', '「探索 → 目标」', '录音日历「更多 → 语音触发」', '阅读新快记，有想法时在快记下方回应你。', '在私聊和群聊消息下方提供建议，仅你可见。', '在聊天中回看相关的线下交流，仅你可见。']) await automatic.getByText(text, { exact: true }).waitFor({ state: 'visible' })
    expect(await automatic.getByRole('switch').evaluateAll(nodes => nodes.every(node => {
      const guidance = document.getElementById(node.getAttribute('aria-describedby'))
      return guidance && guidance.getBoundingClientRect().right <= node.getBoundingClientRect().left
    }))).toBe(true)
    await automatic.screenshot({ path: join(output, 'plugin-allowance.png') })
    await voice.click()
    const consent = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: '同意并开启', exact: true }) })
    expect(await consent.innerText()).toContain('录音时说「帮我记一下」')
    expect(await consent.innerText()).toContain('仅处理开启后新上传的录音')
    await consent.screenshot({ path: join(output, 'plugin-allowance-consent.png') })
    await consent.getByRole('button', { name: '取消', exact: true }).click()
    await writeFile(join(output, 'result.json'), JSON.stringify({ passed: true, scope: 'actual packed UI with example HTTP data; no model or paid analysis', uncertainSaveRequests: writes.length, extraConfirmationDialogs: 0, settingsGuidance: { fixedEntries: 4, contextualEffects: 3, visibleBeforeConsent: true } }, null, 2))
  } catch (e) { failure = e; if (page) { await page.screenshot({ path: join(output, 'failure.png') }); console.error(await page.locator('body').innerText()) }; throw e }
  finally { await browser?.close(); if (scaffold) await scaffold.ctx.get('arkmeData').logout(); try { await scaffold?.close() } catch (e) { if (!failure) throw e }; server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true }) }
}, 180000)
