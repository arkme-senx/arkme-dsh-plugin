// Run with Electron and a read-only compiled snapshot of the actual native client.
// The editor and IPC are real; only this isolated Provider is deterministic.
import { app, BrowserWindow, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [pluginArg, bundleArg, nativeArg, captureArg] = process.argv.slice(2)
if (!pluginArg || !bundleArg || !nativeArg || !captureArg) throw new Error('Pass plugin root, editor bundle, native snapshot, evidence directory')
const plugin = resolve(pluginArg), bundle = resolve(bundleArg), native = resolve(nativeArg), capture = resolve(captureArg)
const { installLongArticleWindowIpc } = await import(pathToFileURL(join(native, 'long-article-window-ipc.js')).href)
app.setPath('userData', join(capture, 'electron-profile'))
let main, origin, failSend = false
const drafts = new Map(), sends = [], checks = [], errors = []
const draftKey = p => JSON.stringify([p.sourceRef, p.draftScope])
for (const name of ['arkme-session-selection:bootstrap', 'arkme-runtime:harness-version', 'arkme-desktop:attention-capabilities', 'arkme-runtime:page-ready-nonce', 'arkme-app-update:app-version', 'arkme-app-update:app-version-code', 'arkme-desktop:branding-snapshot', 'arkme-device-lock:available', 'arkme:desktop-notification:permission-state']) {
  ipcMain.on(name, event => { event.returnValue = null })
}
for (const name of ['arkme-app-update:notice', 'arkme:runtime-update-notice:snapshot']) ipcMain.handle(name, () => null)
app.on('web-contents-created', (_event, contents) => contents.on('console-message', details => { if (details.level === 'error') errors.push(details.message) }))
const manager = installLongArticleWindowIpc({ main: () => main, origin: () => origin, scope: () => origin, preload: () => join(native, 'preload.cjs') })
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, origin || 'http://localhost').pathname
    if (pathname === '/arkme-self/api') {
      let raw = ''; for await (const part of request) raw += part
      const { operation, params = {} } = JSON.parse(raw)
      let value
      if (operation === 'auth.status') value = { status: 'authenticated', userId: 7, environment: 'prod' }
      else if (operation === 'auth.config') value = {}
      else if (operation === 'provider.capabilities') value = { features: { markdownLongArticles: true } }
      else if (operation === 'source.long-article.draft.get') value = drafts.get(draftKey(params))
      else if (operation === 'source.long-article.draft.put') drafts.set(draftKey(params), params)
      else if (operation === 'source.long-article.draft.delete') drafts.delete(draftKey(params))
      else if ((operation === 'source.send-rich' || operation === 'source.long-article.publish')) {
        sends.push(params)
        if (failSend) throw new Error('模拟发送失败')
        value = { itemUid: 'native-team-record', status: 1, sequence: 9, messageActionRef: 'accepted-native-action' }
      } else if (operation === 'source.long-article.detail') {
        assert.equal(params.messageActionRef, 'accepted-native-action')
        value = { itemUid: 'native-team-record', title: sends.at(-1)?.title, textContent: sends.at(-1)?.textContent, textFormat: 'markdown',
          actionItem: { itemUid: 'native-team-record', senderName: '真实作者', isMe: true, sendAtMillis: sends.at(-1)?.sendAtMillis, status: 1, representation: { ...sends.at(-1)?.representation, name: '接待团队', jotmoId: 'team_7' } } }
      }
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true, value })); return
    }
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/light.css"><link rel="stylesheet" href="/dark.css"></head><body><div id="root"></div><script type="module" src="/editor.js"></script></body></html>'); return
    }
    const name = pathname.slice(1)
    const file = name.endsWith('.css') ? join(plugin, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/styles', name) : join(bundle, name)
    response.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript'); response.end(await readFile(file))
  } catch (error) {
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: false, error: { code: 'native-identity-smoke', message: error.message, retryable: true } }))
  }
})
const wait = async (check, label) => {
  const end = Date.now() + 20_000
  while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 50)) }
  throw new Error('Timeout: ' + label)
}
const js = (window, code) => window.webContents.executeJavaScript(code, true)
const click = (window, label) => js(window, `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click()`)
const composition = (draftScope, teamRef) => ({ draftScope, representation: { teamRef, membershipKind: 'member', membershipRevision: 3, groupJoinAt: 9 } })
const team7 = composition('stable-team-7', 'frozen-team-7'), team8 = composition('stable-team-8', 'frozen-team-8')
const open = value => js(main, `window.smokeOpen(undefined, ${JSON.stringify(value)})`)
const child = () => BrowserWindow.getAllWindows().find(w => w !== main)
const ready = window => wait(() => js(window, '!!document.querySelector(".tiptap[contenteditable=true]")'), 'original editor')
const fill = async (window, title, body) => js(window, `(() => { const input=document.querySelector('input[aria-label="长文标题"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(title)}); input.dispatchEvent(new Event('input',{bubbles:true})); const editor=document.querySelector('.tiptap'); editor.focus(); document.execCommand('insertText',false,${JSON.stringify(body)}); })()`)
async function run() {
try {
  await mkdir(capture, { recursive: true }); await app.whenReady()
  await new Promise(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${server.address().port}`
  main = new BrowserWindow({ show: false, webPreferences: { preload: join(native, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } })
  console.log('Native IPC and preload ready'); await main.loadURL(origin); await wait(() => js(main, 'typeof window.smokeOpen === "function"'), 'main boot')
  console.log('Main plugin ready'); await open(team7); const first = child(); assert(first); await ready(first)
  await open({ ...team7, representation: { ...team7.representation, teamRef: 'rotated-team-7' } })
  assert.equal(manager.size, 1); checks.push('rotating refs reuse the same team window')
  assert.equal(manager.context(first.webContents.id).composition, undefined, 'actual native target whitelist is exercised')
  await fill(first, '团队7长文', '团队7冻结身份的正文')
  await wait(() => drafts.get(JSON.stringify(['source-A', team7.draftScope]))?.title === '团队7长文', 'team7 autosave')
  await writeFile(join(capture, 'native-original-editor.png'), (await first.webContents.capturePage()).toPNG())
  await open(team8); const second = BrowserWindow.getAllWindows().find(w => w !== main && w !== first); await ready(second)
  await fill(second, '团队8草稿', '另一个团队的正文')
  await wait(() => drafts.get(JSON.stringify(['source-A', team8.draftScope]))?.title === '团队8草稿', 'team8 autosave')
  await open(undefined); const personal = BrowserWindow.getAllWindows().find(w => ![main, first, second].includes(w)); await ready(personal)
  assert.equal(manager.size, 3)
  assert.equal(await js(personal, 'document.querySelector("input").value'), '')
  assert.equal(await js(second, 'document.querySelector("input").value'), '团队8草稿')
  checks.push('personal and two teams have separate native windows and draft namespaces')
  // Main-window navigation must never change an already-open editor target.
  await js(main, 'document.getElementById("root").textContent = "已切到其他会话"')
  failSend = true; await click(first, '发送')
  await wait(() => js(first, 'document.body.textContent.includes("模拟发送失败")'), 'send failure')
  assert.equal(manager.size, 3); assert(drafts.has(JSON.stringify(['source-A', team7.draftScope])))
  failSend = false; await click(first, '发送'); await wait(() => manager.size === 2, 'accepted send closes only team7')
  assert.equal(sends.length, 2)
  for (const sent of sends) { assert.equal(sent.sourceRef, 'source-A'); assert.equal(sent.expectedUserId, 7); assert.deepEqual(sent.representation, team7.representation) }
  assert.equal(sends[0].recordUid, sends[1].recordUid); assert.equal(sends[0].relationUid, sends[1].relationUid)
  const receipts = await js(main, 'window.smokeReceipts')
  assert.equal(receipts.length, 1); assert.equal(receipts[0].sourceKey, 'chat:A'); assert.equal(receipts[0].sourceRef, 'source-A'); assert.deepEqual(receipts[0].composition, team7)
  assert.equal(receipts[0].item.representation.jotmoId, 'team_7'); assert.equal(receipts[0].item.senderName, '真实作者'); assert.equal(receipts[0].item.sequence, 9); checks.push('authoritative relation attribution, actor and sequence survive the native receipt')
  assert(!drafts.has(JSON.stringify(['source-A', team7.draftScope]))); assert(drafts.has(JSON.stringify(['source-A', team8.draftScope])))
  checks.push('failure retains identity and draft', 'retry keeps record/relation ids', 'canonical source and frozen identity reach send', 'decoded receipt reaches original main conversation', 'only sent team draft is removed')
  await js(main, 'window.arkmeLongArticle.account("prod:8")')
  await wait(() => js(second, 'document.body.textContent.includes("账号已切换")'), 'native account invalidation')
  assert.equal(sends.length, 2); checks.push('native account invalidation blocks old team editor')
  await writeFile(join(capture, 'result.json'), JSON.stringify({ checks, sends, receipts, errors, provider: 'deterministic isolated fixture; real native manager, preload, IPC and production editor' }, null, 2))
  console.log(`Native team article: ${checks.length} checks passed`)
} catch (error) {
  console.error(error); process.exitCode = 1
  const windows = []
  for (const w of BrowserWindow.getAllWindows()) windows.push({ id: w.webContents.id, body: await js(w, 'document.body.innerText'), context: manager.context(w.webContents.id) })
  await writeFile(join(capture, 'failure.json'), JSON.stringify({ windows, sends, drafts: [...drafts], errors }, null, 2))
}
finally {
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  server.closeAllConnections(); await new Promise(r => server.close(r)); app.exit(process.exitCode || 0)
}

}
void run()
