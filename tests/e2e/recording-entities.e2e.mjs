// Packaged plugin and official DSH; only remote Audio/Relation/auth are fixtures.
import { createHmac, randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { appendFileSync, mkdirSync } from 'node:fs'
import { readFile, writeFile, mkdtemp, rm, mkdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const dshRoot = process.env.ARKME_DSH_CHECKOUT && await realpath(process.env.ARKME_DSH_CHECKOUT), profile = process.env.ARKME_PACKED_PROFILE
if (!dshRoot || !profile || !process.env.ARKME_E2E_TLS_KEY || !process.env.NODE_EXTRA_CA_CERTS) throw new Error('isolated Harness, packed profile and local TLS required')
const importFile = path => import(/* @vite-ignore */ pathToFileURL(path).href)
const { launchWebScaffold } = await importFile(join(dshRoot, 'apps/web/tests/scaffold.ts'))
const { healProfilesModuleFallback } = await importFile(join(dshRoot, 'packages/boot/app-boot/src/index.ts'))
await healProfilesModuleFallback({ installAnchor: join(dshRoot, 'apps/cli/package.json'), home: resolve(profile, '../..') })
const { chromium } = createRequire(join(dshRoot, 'apps/web/package.json'))('playwright')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('officially installed immutable tgz required')
// A consumer outside the plugin source tree resolves only the public package export.
const consumer = createRequire(join(profile, 'package.json'))
const { createArkmeSdk } = await importFile(consumer.resolve('@senguoyun/dsh-arkme/sdk'))
const userID = 987651013
const parts = [{ alg: 'HS256', typ: 'JWT' }, { user_id: userID, client_id: 20001 }].map(x => Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')
const token = `${parts}.${createHmac('sha256', 'local-entity-fixture-only').update(parts).digest('base64url')}`
const date = new Date(); date.setHours(0, 0, 0, 0)
const stamp = date.getTime(), speechStart = stamp + 9 * 3600000
const midnightStart = stamp + 86400000 + 52 * 60000
const rawText = '  (背景音) 🙂武汉欢迎你。张三正在介绍黄鹤楼。  '
const base = () => ({ day_stamp: stamp, transcript_source: 'system', status: 'succeeded', view_mode: 'official', state_revision: 3,
  projection_revision: 2, job_id: '650000000000000000000001', result_version: 'fixture-version-one', pollable: false,
  recognition_progress: { stage: 'succeeded', completed_units: 1, total_units: 1 }, entities: [
    { entity_key: 'place', official_entity_id: '650000000000000000000002', canonical_name: '武汉', type: 3, occurrence_count: 2 },
    { entity_key: 'person', official_entity_id: '650000000000000000000003', canonical_name: '张三', type: 1, occurrence_count: 1 },
  ] })

describe('packaged recording entities', () => {
  it('shares owner results across SDK, a real session Tool and wide/narrow UI', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recording entities e2e ')), calls = []
    const began = Date.now()
    const phase = name => {
      const line = `[recording-entities-e2e] ${name} +${Date.now() - began}ms\n`
      console.info(line.trim())
      if (process.env.ARKME_E2E_ARTIFACTS) {
        mkdirSync(process.env.ARKME_E2E_ARTIFACTS, { recursive: true })
        appendFileSync(join(process.env.ARKME_E2E_ARTIFACTS, 'phases.log'), line)
      }
    }
    let scaffold, browser, page, result = base()
    const startedDays = new Set()
    const server = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, async (req, res) => {
      try {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); calls.push(req.url)
        let data = { items: [], users: [], has_more: false }
        if (req.url === '/api/public/v1/auth/the-best-api-for-testing') data = { access_token: token, refresh_token: 'fixture-refresh' }
        else if (req.url === '/api/v1/auth/get-user-info') data = { user_id: userID, nick_name: '实体页面验收', phone: '13800000000' }
        else if (req.url.endsWith('/audio-day/list')) data = { ...result, day_stamp: body.day_stamp, ...(body.day_stamp !== stamp ? { status: startedDays.has(body.day_stamp) ? 'processing' : 'not_started', can_start: !startedDays.has(body.day_stamp), pollable: startedDays.has(body.day_stamp), recognition_progress: { stage: startedDays.has(body.day_stamp) ? 'queued' : 'not_started' }, entities: [] } : {}) }
        else if (req.url.endsWith('/audio-day/start')) { startedDays.add(body.day_stamp); data = { status: 'accepted', job_id: 'internal-job' } }
        else if (req.url.endsWith('/audio-day/occurrences')) data = { job_id: body.job_id, view_mode: 'official', result_version: body.result_version, official_entity_id: body.official_entity_id,
          occurrences: [{ occurrence_id: 'mention', row_id: 'session:child:0:system', session_id: 'session', child_id: 'child', item_index: 0,
            transcript_source: 'system', start_ms: speechStart, end_ms: speechStart + 10000, rune_start: 9, rune_end: 11, observed_text: '武汉' },
            { occurrence_id: 'midnight', row_id: 'session:child:1:system', session_id: 'session', child_id: 'child', item_index: 1,
              transcript_source: 'system', start_ms: midnightStart, end_ms: midnightStart + 1000, rune_start: 2, rune_end: 4, observed_text: '武汉' }] }
        else if (req.url.endsWith('/one-day-trans')) data = { session_ls: [{ id: 'session', belong_usr: userID, start_at: speechStart, end_at: midnightStart + 1000, duration: midnightStart + 1000 - speechStart }],
          child_ls: [{ id: 'child', session_id: 'session', start_at: 0, asr: [{ s: 0, e: 10000, n: 1, b: 1, t: rawText },
            { s: midnightStart - speechStart, e: midnightStart - speechStart + 1000, n: 1, t: '抵达武汉，跨日原文仍可查看。' }] }] }
        else if (req.url.endsWith('/get-calender-summary')) data = { duration_ls: Array.from({ length: Math.round((body.to_stamp - body.from_stamp) / 86400000) }, (_, i) => body.from_stamp + i * 86400000 === stamp ? 10000 : 0), un_click_session_ids_per_day: [] }
        else if (req.url.endsWith('/get-speaker-ls')) data = { spk_ls: [] }
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code: 200, data }))
      } catch { res.statusCode = 500; res.end('{}') }
    })
    try {
      server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = `https://127.0.0.1:${server.address().port}`
      const config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: `com.senqisi.entities-e2e-${randomUUID()}`, allowProduction: false,
        updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business' }
      for (const key of ['auth', 'subject', 'record', 'data', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[`${key}BaseUrl`] = origin
      config.shareWebsite = origin
      const overlay = join(root, 'overlay.json'); await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'entities-e2e', name: '@senguoyun/dsh-arkme', config }] }]))
      phase('harness-start')
      scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')] })
      phase('harness-ready')
      const service = scaffold.ctx.get('arkmeData'); expect(await service.testLogin(userID)).toMatchObject({ status: 'authenticated', userId: userID })
      phase('fixture-login-ready')
      const sdk = createArkmeSdk({ fetchImpl: (_url, init) => scaffold.hostFetch('/arkme-self/api', { ...init, headers: { ...init.headers, Origin: new URL(scaffold.authenticatedUrl).origin } }) })
      expect(await sdk.startRecordingEntities({ dateStamp: stamp })).toEqual({ status: 'accepted' })
      phase('sdk-start-ready')
      const list = await sdk.recordingEntities({ dateStamp: stamp }); expect(list.entities.map(item => item.name)).toEqual(['武汉', '张三'])
      const mentions = await sdk.recordingEntityOccurrences({ entityRef: list.entities[0].entityRef })
      expect(mentions.items[0]).toMatchObject({ observedText: '武汉', target: { start: 1, length: 2 } })
      expect(mentions.items[1]).toMatchObject({ observedText: '武汉', target: { start: 2, length: 2, sourceText: '抵达武汉，跨日原文仍可查看。' } })
      expect(JSON.stringify([list, mentions])).not.toMatch(/65000000000000000000000|session:child|fixture-version/)
      const handle = await scaffold.ctx.agents.create({ sessionId: `entities-${randomUUID()}`, meta: { cwd: scaffold.workspaceCwd }, agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
      expect(scaffold.ctx.tools.get('arkme_recording_entities', handle.agent)).toBeDefined()
      for (const args of [{ action: 'list', date_stamp: stamp }, { action: 'occurrences', entity_ref: list.entities[0].entityRef }]) {
        const output = await scaffold.ctx.tools.execute({ callId: randomUUID(), name: 'arkme_recording_entities', arguments: args, agent: handle.agent, signal: new AbortController().signal })
        expect(output.isError).toBe(false); expect(JSON.stringify(output)).toContain('武汉')
      }
      expect(scaffold.ctx.tools.get('arkme_recording_entities_start', handle.agent)).toBeDefined()
      const requestedDate = new Date(stamp); requestedDate.setDate(requestedDate.getDate() - 2)
      const started = await scaffold.ctx.tools.execute({ callId: randomUUID(), name: 'arkme_recording_entities_start', arguments: { date_stamp: requestedDate.getTime() }, agent: handle.agent, signal: new AbortController().signal })
      expect(started.isError).toBe(false); expect(JSON.stringify(started)).toContain('accepted')
      expect([...startedDays].sort()).toEqual([requestedDate.getTime(), stamp].sort())
      phase('tools-ready')
      browser = await chromium.launch({ channel: 'chrome', headless: true }); page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
      phase('browser-ready')
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' }); await page.getByRole('button', { name: '录音', exact: true }).click()
      await page.getByRole('button', { name: '查看录音实体', exact: true }).click()
      const panel = page.getByRole('dialog', { name: /^实体 ·/ })
      await expect.poll(() => panel.innerText(), { timeout: 15000 }).toContain('武汉')
      expect(await panel.locator('.arkme-entity-status').count()).toBe(0)
      phase('ui-ready')
      expect(await panel.evaluate(node => getComputedStyle(node).width)).toBe('405px')
      await panel.getByRole('button', { name: '人物', exact: true }).click()
      expect(await panel.locator('.arkme-entity-item').count()).toBe(1)
      await panel.getByRole('button', { name: '地点', exact: true }).click()
      await panel.locator('.arkme-entity-item-title').click()
      await expect.poll(() => panel.locator('.arkme-entity-occurrence').count(), { timeout: 15000 }).toBe(2)
      await panel.locator('.arkme-entity-occurrence').first().click()
      await expect.poll(() => page.locator('[data-recording-entity-highlight]').allTextContents(), { timeout: 15000 }).toEqual(['武汉'])
      await panel.locator('.arkme-entity-occurrence').nth(1).click()
      expect(await panel.getByRole('region', { name: '提及原文' }).innerText()).toContain('抵达武汉，跨日原文仍可查看。')
      expect(await panel.locator('.arkme-entity-source [data-recording-entity-highlight]').allTextContents()).toEqual(['武汉'])
      const artifacts = process.env.ARKME_E2E_ARTIFACTS
      if (artifacts) { await mkdir(artifacts, { recursive: true }); await page.screenshot({ path: join(artifacts, 'entities-wide.png') }) }
      await panel.getByRole('button', { name: '关闭实体列表' }).click()
      await page.setViewportSize({ width: 900, height: 900 })
      await page.getByRole('button', { name: '查看录音实体' }).click()
      const dialog = page.getByRole('dialog', { name: /^实体 ·/ })
      await expect.poll(() => dialog.count()).toBe(1)
      if (artifacts) await page.screenshot({ path: join(artifacts, 'entities-narrow.png') })
      await page.keyboard.press('Escape')
      await expect.poll(() => dialog.count()).toBe(0)
      expect(await page.getByRole('button', { name: '查看录音实体' }).evaluate(node => node === document.activeElement)).toBe(true)
      result = { ...base(), status: 'processing', pollable: true, transcript_health: { ready_units: 1, processing_units: 1, unavailable_units: 1 }, recognition_progress: { stage: 'waiting_more_transcript' } }
      await page.getByRole('button', { name: '查看录音实体' }).click()
      await expect.poll(() => dialog.innerText()).toContain('部分转写异常，已有实体可查看')
      expect(await dialog.locator('.arkme-entity-item').count()).toBeGreaterThan(0)
      result.transcript_health.unavailable_units = 0
      await page.getByRole('button', { name: '刷新实体', exact: true }).click()
      await expect.poll(() => dialog.innerText()).toContain('等待剩余转写完成')
      result = { ...base(), status: 'source_mismatch', entities: [], state_revision: 4 }
      await page.getByRole('button', { name: '刷新实体', exact: true }).click()
      await expect.poll(() => dialog.innerText()).toContain('录音内容已更新')
      expect(await dialog.locator('.arkme-entity-item').count()).toBe(0)
      await page.setViewportSize({ width: 1680, height: 1050 })
      const previousDay = new Date(stamp); previousDay.setDate(previousDay.getDate() - 1)
      await page.getByRole('button', { name: new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(previousDay), exact: true }).click()
      await expect.poll(() => page.locator('.arkme-entity-panel').count()).toBe(0)
      await page.getByRole('button', { name: '查看录音实体' }).click()
      await expect.poll(() => panel.innerText(), { timeout: 15000 }).toContain('尚未识别实体')
      expect(await panel.locator('.arkme-entity-item').count()).toBe(0)
      expect(calls.filter(path => path.endsWith('/start'))).toHaveLength(2)
      expect(calls.filter(path => path.endsWith('/ensure'))).toHaveLength(0)
      expect(await panel.innerText()).toContain('仅支持手动识别，并且会消耗AI额度的积分')
      await panel.getByRole('button', { name: '开始识别', exact: true }).click()
      await expect.poll(() => panel.innerText()).toContain('等待实体识别')
      expect(calls.filter(path => path.endsWith('/start'))).toHaveLength(3)
      phase('ui-manual-start-ready')
      if (artifacts) await page.screenshot({ path: join(artifacts, 'manual-start-queued.png') })
    } catch (error) {
      if (page && process.env.ARKME_E2E_ARTIFACTS) {
        await mkdir(process.env.ARKME_E2E_ARTIFACTS, { recursive: true })
        await page.screenshot({ path: join(process.env.ARKME_E2E_ARTIFACTS, 'failure.png') })
        await writeFile(join(process.env.ARKME_E2E_ARTIFACTS, 'failure.txt'), await page.locator('body').innerText())
      }
      throw error
    } finally {
      phase('cleanup-start')
      await browser?.close(); await scaffold?.ctx.get('arkmeData')?.logout().catch(() => {}); await scaffold?.close()
      server.closeAllConnections(); await new Promise(done => server.close(done)); await rm(root, { recursive: true, force: true })
      phase('cleanup-done')
    }
  }, 120000)
})
