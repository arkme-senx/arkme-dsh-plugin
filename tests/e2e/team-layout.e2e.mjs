// Visual/interaction acceptance of the installed artifact on unmodified DSH.
// Identity/upstream and Team browser DTOs are synthetic fixtures; this is not a backend E2E.
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
const dshRoot = process.env.ARKME_DSH_CHECKOUT, profile = process.env.ARKME_PACKED_PROFILE
if (!dshRoot || !profile || !process.env.ARKME_E2E_TLS_KEY || !process.env.NODE_EXTRA_CA_CERTS) throw new Error('Supply official DSH, fresh artifact profile and isolated TLS fixture')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('Install the immutable tgz with the official CLI first')
const { launchWebScaffold } = await import(pathToFileURL(join(dshRoot, 'apps/web/tests/scaffold.ts')).href)
const { chromium } = createRequire(join(dshRoot, 'apps/web/package.json'))('playwright')
it('keeps Team detail compact, uses shared menus and respects member permissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arkme team layout '))
  let scaffold, browser, page
  const failures = [], calls = []
  const api = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const input = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const path = new URL(req.url, 'https://localhost').pathname
    let data = { items: [], users: [], sources: [], has_more: false }
    if (path.endsWith('/the-best-api-for-testing')) {
      const token = [{ alg: 'none' }, { user_id: input.user_id, exp: Math.floor(Date.now() / 1000) + 3600 }].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.') + '.fixture'
      data = { access_token: token, refresh_token: 'layout-fixture' }
    } else if (path.endsWith('/get-user-info')) data = { user_id: 99001001, nick_name: '布局验收', jotmo_id: 'layout_test', phone: '13800000000' }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code: 200, data }))
  })
  try {
    api.listen(0, '127.0.0.1'); await once(api, 'listening')
    const origin = `https://127.0.0.1:${api.address().port}`
    const config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: `com.senqisi.layout-${randomUUID()}`, allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'disabled', shareWebsite: origin }
    for (const key of ['auth', 'subject', 'record', 'data', 'team', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[`${key}BaseUrl`] = origin
    const overlay = join(root, 'overlay.json')
    await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'arkme-team-layout', name: '@senguoyun/dsh-arkme', config }] }]))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')], replayFixture: resolve(dshRoot, 'snapshots/web/plan-narrow-viewport/session.v3.jsonl'), replayProvidersOnly: true, compareReplaySession: false })
    expect(await scaffold.ctx.get('arkmeData').testLogin(99001001)).toMatchObject({ status: 'authenticated' })
    browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
    let owner = true, enabled = true
    const teamRef = `team_v1_${'a'.repeat(32)}`, publicRef = 'b'.repeat(32)
    const channel = () => ({ teamRef, name: 'Arkme Internal Interview', jotmoId: 'arkme_cn', publicRef, link: `https://example.com/team-message?channel=${publicRef}`, enabled, revision: 3, canManage: owner })
    await page.route('**/arkme-self/api', async route => {
      const { operation: op, params = {} } = route.request().postDataJSON()
      calls.push(op)
      let value
      if (op === 'team.app.channel' || op === 'team.app.official') value = channel()
      else if (op === 'team.app.channel.configure') { enabled = params.enabled; value = channel() }
      else if (op === 'team.app.members') value = { team: { teamRef, name: channel().name, jotmoId: channel().jotmoId, currentUserRole: owner ? 'owner' : 'member', createdAtMillis: 1, updatedAtMillis: 1 }, items: ['Loki1999', 'Jotmoer', '设计讨论小组', '510'].map((name, i) => ({ userRef: `usr_v1_${String(i).repeat(32)}`, displayName: name, jotmoId: `member_${i}`, identityState: 'ready', role: i === 0 ? 'owner' : 'member', joinedAtMillis: 1, canRemove: owner && i > 0 })), totalCount: 4, hasMore: false }
      else if (op === 'team.app.directory') value = { section: 'teams', items: params.countOnly ? [] : [{ kind: 'team', teamRef, displayName: channel().name, publicId: 'arkme_cn', role: owner ? 'owner' : 'member' }], total: 1, hasMore: false }
      else if (op === 'directory.list') value = { section: params.section, items: [], total: 0, hasMore: false }
      else if (op === 'team.app.applications' || op === 'team.app.conversations') value = { items: [], hasMore: false }
      else if (op === 'team.app.attention') value = { team: false, external: false, applications: false }
      else { await route.continue(); return }
      await route.fulfill({ json: { ok: true, value } })
    })
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: '联系人', exact: true }).click()
    const section = page.locator('[data-directory-section="teams"]')
    const toggle = section.locator('.arkme-contact-directory-section-header')
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    await section.getByRole('button', { name: /Arkme Internal Interview/ }).click()
    const detail = page.locator('.arkme-team-detail')
    await detail.getByRole('heading', { name: '团队成员', exact: true }).waitFor()
    await detail.getByRole('switch', { name: '接收外部消息' }).waitFor()
    expect(await detail.getByRole('listitem').count()).toBe(4)
    const geometry = await detail.evaluate(node => {
      const header = node.querySelector('.arkme-team-detail-header').getBoundingClientRect()
      const members = node.querySelector('.arkme-team-members').getBoundingClientRect()
      const settings = node.querySelector('.team-settings').getBoundingClientRect()
      return { memberGap: members.top - header.bottom, settingsTop: settings.top, membersBottom: members.bottom, overflow: getComputedStyle(node).overflowY }
    })
    expect(geometry.memberGap).toBeLessThan(40)
    expect(geometry.settingsTop).toBeGreaterThanOrEqual(geometry.membersBottom - 1)
    expect(geometry.overflow).toBe('auto')
    const output = process.env.ARKME_E2E_CAPTURE_DIR
    const capture = async name => { if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: join(output, `${name}.png`) }) } }
    await capture('plugin-owner-team')
    await section.getByRole('button', { name: '团队操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '创建团队', exact: true }).waitFor()
    await capture('plugin-team-menu')
    await page.keyboard.press('Escape')
    expect(await page.getByRole('menuitem', { name: '创建团队', exact: true }).count()).toBe(0)
    for (const label of ['创建团队', '加入团队', '通过链接发消息']) {
      await section.getByRole('button', { name: '团队操作', exact: true }).click()
      await page.getByRole('menuitem', { name: label, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: label, exact: true })
      await dialog.waitFor(); await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    }
    await detail.getByRole('button', { name: '复制消息链接', exact: true }).click()
    await detail.getByText('通道链接已复制', { exact: true }).waitFor()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(channel().link)
    await detail.getByRole('switch').click()
    await expect.poll(() => detail.getByRole('switch').getAttribute('aria-checked')).toBe('false')
    await detail.getByRole('switch').click()
    await expect.poll(() => detail.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    await page.setViewportSize({ width: 1024, height: 768 })
    const edges = await detail.evaluate(node => ['.arkme-team-detail-header-main', '.arkme-team-members-container', '.team-settings'].map(selector => { const rect = node.querySelector(selector).getBoundingClientRect(); return { left: rect.left, right: rect.right } }))
    expect(Math.max(...edges.map(v => v.left)) - Math.min(...edges.map(v => v.left))).toBeLessThan(2)
    expect(Math.max(...edges.map(v => v.right)) - Math.min(...edges.map(v => v.right))).toBeLessThan(2)
    await capture('plugin-owner-compact')
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
    expect(await detail.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgb(255, 255, 255)')
    await capture('plugin-owner-dark')
    await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
    await page.setViewportSize({ width: 1024, height: 768 })
    owner = false; await page.reload()
    await page.getByRole('button', { name: '联系人', exact: true }).click()
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    await section.getByRole('button', { name: /Arkme Internal Interview/ }).click()
    await detail.getByRole('button', { name: '退出团队', exact: true }).waitFor()
    expect(await detail.getByRole('switch').count()).toBe(0)
    expect(await detail.getByRole('button', { name: '移除', exact: true }).count()).toBe(0)
    await capture('plugin-member-team')
    expect(calls).toContain('team.app.members')
  } catch (error) {
    failures.push(error)
    if (page && process.env.ARKME_E2E_CAPTURE_DIR) await page.screenshot({ path: join(process.env.ARKME_E2E_CAPTURE_DIR, 'failure.png') }).catch(() => {})
  } finally {
    await browser?.close().catch(e => failures.push(e))
    if (scaffold) await scaffold.ctx.get('arkmeData').logout().catch(e => failures.push(e))
    await scaffold?.close().catch(e => failures.push(e))
    await new Promise(resolve => api.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
  if (failures.length) throw new AggregateError(failures, failures.map(String).join('\n'))
})
