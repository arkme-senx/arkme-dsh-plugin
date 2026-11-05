// Run against an installed official DSH and a seeded TEST task on macOS or Windows.
// Edge-case queue snapshots are browser-only overlays; this test makes no business writes.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { platform, release } from 'node:os'

const { ARKME_DSH_RUNTIME_LOG: log, ARKME_CODEX_UI_CAPTURE_DIR: capture,
  PLAYWRIGHT_MODULE_ANCHOR: anchor, ARKME_CODEX_UI_TASK_TITLE: title } = process.env
assert.ok(log && capture && anchor && title, 'Supply runtime log, capture directory, Playwright anchor and seeded TEST task title')
const target = (await readFile(log, 'utf8')).match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/)?.[0]
assert.ok(target, 'Official DSH bootstrap URL is missing')
await mkdir(capture, { recursive: true })
const { chromium } = createRequire(resolve(anchor))('playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const report = { platform: platform(), osRelease: release(), browser: browser.version(), checks: [], layouts: [], errors: [] }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  let queueMode
  await page.route('**/arkme-self/api', async route => {
    const body = route.request().postDataJSON()
    if (!queueMode || body.operation !== 'team.codex.state') return route.continue()
    const response = await route.fetch()
    const json = await response.json()
    for (const task of json.value?.tasks ?? []) {
      if (task.title !== title) continue
      const items = Array.from({ length: queueMode === 'empty' ? 0 : queueMode === 'single' ? 1 : 8 }, (_, index) => ({
        id: `layout-${index}`, text: `布局验收 ${index + 1}：${'保留原有排队操作与状态，长文本应当省略并可查看完整提示。'.repeat(8)}`,
        createdAt: Date.now(), delivery: 'queue', state: index === 1 ? 'unknown' : 'queued', paused: index === 2, attachmentCount: index === 3 ? 2 : 0, truncated: false,
      }))
      task.queueCloud = 'ready'
      task.queue = { version: 1, availability: 'ready', reason: 'none', checkedAt: Date.now() - (queueMode === 'stale' ? 120_000 : 0), changedAt: Date.now(), sourceAt: Date.now(), items }
    }
    await route.fulfill({ response, json })
  })
  await page.goto(target)
  await page.evaluate(() => history.replaceState(null, '', '/'))
  await page.locator('button[aria-label="Codex"]').click()
  const surface = page.locator('.arkme-codex-surface:visible')
  await page.locator('.arkme-codex-task-trigger').waitFor()
  if (!(await page.locator('.arkme-codex-task-trigger').innerText()).includes(title)) {
    await page.locator('.arkme-codex-task-trigger').click()
    await page.locator('.arkme-codex-task-picker .arkme-team-codex-task-toggle').filter({ hasText: title }).click()
  }
  await surface.getByText('TEST final', { exact: true }).waitFor()
  const older = surface.getByRole('button', { name: '加载更早记录', exact: true })
  if (await older.count()) await older.click()
  await surface.getByText('ABCDEFGH', { exact: true }).waitFor()
  assert.equal(await surface.locator('[data-event-kind="Progress"]').count(), 60)
  assert.equal(await surface.locator('[data-event-kind="Stop"]').count(), 1)
  report.checks.push('live TEST pagination retains 60 progress messages, prompt and final')

  const progress = surface.locator('[data-event-kind="Progress"]').last()
  await progress.locator('.arkme-codex-copy').click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'TEST progress 60')
  await surface.locator('[data-event-kind="Stop"] .arkme-codex-copy').click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'TEST final')
  report.checks.push('progress and final copying retain original text')

  await progress.locator('[data-codex-body]').dblclick({ position: { x: 40, y: 12 } })
  const toolbar = page.getByRole('toolbar', { name: '选中文字操作', exact: true })
  await toolbar.waitFor()
  assert.ok(await toolbar.getByRole('button', { name: '标记', exact: true }).isVisible())
  assert.ok(await toolbar.getByRole('button', { name: '转发', exact: true }).isVisible())
  const selection = await page.evaluate(() => document.getSelection()?.toString())
  assert.ok(selection)
  await toolbar.getByRole('button', { name: '复制', exact: true }).click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), selection)
  await surface.locator('.arkme-codex-project-context').click()
  await toolbar.waitFor({ state: 'hidden' })
  report.checks.push('native text selection and copying work; marking and personal-excerpt entries remain visible')

  await progress.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '多选', exact: true }).click()
  assert.ok(await page.getByRole('button', { name: '复制链接', exact: true }).isVisible())
  assert.ok(await page.getByRole('button', { name: '转发', exact: true }).isVisible())
  await page.getByRole('button', { name: '复制文本', exact: true }).click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'TEST progress 60')
  await page.getByRole('button', { name: '退出多选', exact: true }).click()
  report.checks.push('progress context menu, multiselect, copy, link and forwarding entries remain available')

  const measure = () => surface.evaluate(node => {
    const column = node.querySelector('.arkme-codex-reading-column'), panel = node.querySelector('.arkme-codex-queue-panel')
    const progress = node.querySelector('[data-event-kind="Progress"]'), final = node.querySelector('[data-event-kind="Stop"]')
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, width: r.width } }
    const style = getComputedStyle(column), left = column.getBoundingClientRect().x + parseFloat(style.paddingLeft)
    return { viewport: innerWidth, column: rect(column), queue: panel && rect(panel), contentLeft: left,
      contentRight: column.getBoundingClientRect().right - parseFloat(style.paddingRight),
      progressMargin: parseFloat(getComputedStyle(progress).marginBottom), finalMargin: parseFloat(getComputedStyle(final).marginBottom),
      progressHeight: progress.getBoundingClientRect().height, metaVisible: !!progress.querySelector('time') && progress.querySelector('button').getBoundingClientRect().height >= 24,
      overflow: node.scrollWidth > node.clientWidth || node.querySelector('.arkme-codex-transcript').scrollWidth > node.querySelector('.arkme-codex-transcript').clientWidth }
  })
  const screenshot = async name => { await surface.screenshot({ path: join(capture, name + '.png') }) }
  const bottom = () => surface.locator('.arkme-codex-transcript').evaluate(el => { el.scrollTop = el.scrollHeight })
  for (const width of [1440, 2246, 960]) {
    await page.setViewportSize({ width, height: width === 2246 ? 1374 : 1000 })
    await bottom()
    const value = await measure()
    assert.ok(value.progressMargin < value.finalMargin && value.progressMargin + value.progressHeight < 76, 'Progress rows must remain compact')
    assert.ok(value.metaVisible && !value.overflow, 'Metadata and controls must remain visible without horizontal overflow')
    assert.ok(Math.abs(value.queue.x - value.contentLeft) < 10 && Math.abs(value.queue.x + value.queue.width - value.contentRight) < 10, 'Queue must align with the reading column')
    report.layouts.push(value)
    await screenshot(`live-${width}`)
  }
  report.checks.push('live UI at 960, 1440 and 2246 pixels: compact progress, visible metadata and aligned queue')

  const refresh = async mode => {
    queueMode = mode
    await page.evaluate(() => window.dispatchEvent(new Event('arkme-codex-changed')))
  }
  await refresh('multi')
  const header = surface.locator('.arkme-codex-queue-header')
  await header.waitFor()
  assert.equal(await header.getAttribute('aria-expanded'), 'false')
  assert.ok((await header.innerText()).includes('发送结果待确认'))
  await header.focus()
  await page.keyboard.press('Enter')
  await surface.locator('.arkme-codex-queue-row').last().waitFor()
  assert.equal(await surface.locator('.arkme-codex-queue-row').count(), 8)
  assert.ok((await surface.locator('.arkme-codex-queue-preview').first().getAttribute('title')).length > 100)
  assert.ok((await surface.locator('.arkme-codex-queue-list').innerText()).includes('等待继续'))
  assert.ok((await surface.locator('.arkme-codex-queue-list').innerText()).includes('2 个附件'))
  assert.ok(await surface.locator('.arkme-codex-queue-status').evaluateAll(nodes => nodes.every(node => node.clientWidth >= node.scrollWidth)), 'Queue statuses must remain fully readable beside long text')
  assert.ok(await surface.locator('.arkme-codex-queue-list').evaluate(el => el.scrollHeight > el.clientHeight))
  assert.equal((await measure()).overflow, false)
  await screenshot('queue-expanded-long-text')
  await refresh('stale')
  await surface.getByText('队列状态待更新', { exact: false }).waitFor()
  assert.equal(await header.getAttribute('aria-expanded'), 'true')
  assert.equal(await surface.locator('.arkme-codex-queue-row').count(), 8)
  await screenshot('queue-stale-expanded')
  await header.click()
  assert.equal(await header.getAttribute('aria-expanded'), 'false')
  await refresh('single')
  await page.waitForFunction(() => document.querySelectorAll('.arkme-codex-surface .arkme-codex-queue-row').length === 1)
  assert.equal(await header.count(), 0)
  await refresh('empty')
  await surface.locator('[data-codex-queue-dock]').waitFor({ state: 'detached' })
  report.checks.push('browser-only queue cases: long text, eight rows, keyboard toggle, scrolling, pending/paused/attachment statuses, stale retention, single and empty')
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.passed = false
  report.failure = String(error).replace(/(\?token=)[^\s"']+/g, '$1[redacted]')
  throw new Error(report.failure)
} finally {
  await writeFile(join(capture, 'result.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))
