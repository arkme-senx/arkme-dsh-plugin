// Run after `pnpm build`: node scripts/verify-harness-trajectory-native.mjs <harness-directory>
// Uses the supplied installation's real Header and Menu, without starting a
// Host, reading accounts, changing a profile, or embedding copies in the plugin.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { JSDOM } from 'jsdom'

const nativeRoot = process.argv[2]
if (!nativeRoot) throw new Error('Supply the directory containing Harness node_modules')
const nativeRequire = createRequire(join(resolve(nativeRoot), 'trajectory-smoke.cjs'))
const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://localhost/arkme-self/harness-frame?arkme-harness-embed=1', pretendToBeVisual: true,
})
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLIFrameElement', 'Element', 'Node', 'MutationObserver']) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
const React = nativeRequire('react')
const jsx = nativeRequire('react/jsx-runtime')
const { createRoot } = nativeRequire('react-dom/client')
const nativePackage = name => join(resolve(nativeRoot), 'node_modules/@deepseek-ai', name)
const primitiveSource = readFileSync(join(nativePackage('dsh-client-ui-primitives'), 'lib/index.js'), 'utf8')
const conversationSource = readFileSync(join(nativePackage('dsh-client-ui-conversation'), 'lib/client.js'), 'utf8')
const exportSource = readFileSync(join(nativePackage('dsh-session-log-export'), 'lib/client.js'), 'utf8')

function region(source, suffix) {
  const marker = source.split('\n').find(line => line.includes('//#region ') && line.trim().endsWith(suffix))
  assert.ok(marker, `Native region ${suffix} must be reviewed after upstream changes`)
  return source.slice(source.indexOf(marker) + marker.length).split('//#endregion')[0]
}
// The desktop Host compiles primitive CSS imports at boot. For this isolated
// DOM check use its unchanged Menu function, with CSS-module names resolved
// locally. Decorative icons and the unrelated download-result dialog are stubs.
const cssNames = new Proxy({}, { get: (_target, key) => String(key) })
const icon = () => jsx.jsx('svg', { 'aria-hidden': true })
const menuRegion = region(primitiveSource, 'lib/types/Menu.js')
const pointerRegion = primitiveSource.slice(primitiveSource.indexOf('function usePointerGrace(')).split('//#endregion')[0]
assert.ok(pointerRegion.includes('function usePointerGrace('))
const hookNames = ['useRef', 'useState', 'useLayoutEffect', 'useEffect', 'useCallback']
const Menu = new Function(...hookNames, 'jsx', 'jsxs', 'clsx', 'css$7', 'createPortal', 'IconCheckOutline16',
  `${pointerRegion}\n${menuRegion}; return Menu;`
)(...hookNames.map(key => React[key]), jsx.jsx, jsx.jsxs, (...values) => values.filter(Boolean).join(' '),
  cssNames, nativeRequire('react-dom').createPortal, icon)
const primitives = { Menu, IconEllipsisOutline16: icon, IconDownloadOutline16: icon }
const headerCss = new Function(`${region(conversationSource, 'ConversationRoot.module.css.mjs')}; return ConversationRoot_module_css_default;`)()
const actionCss = new Function(`${region(exportSource, 'HeaderAction.module.css.mjs')}; return HeaderAction_module_css_default;`)()
const Header = new Function('react', 'react_jsx_runtime', 'clsx', 'ConversationRoot_module_css_default', 'conversationPhase',
  `${region(conversationSource, 'lib/types/client/view-selection.js')}\n${region(conversationSource, 'lib/types/client/skeleton/ConversationSession.js')}; return ConversationSessionHeader;`
)(React, jsx, (...values) => values.filter(Boolean).join(' '), headerCss, () => 'conversation')
const Action = new Function('react', 'react_jsx_runtime', '_deepseek_ai_dsh_client_ui_primitives', 'HeaderAction_module_css_default', 'SessionLogDownloadDialog',
  `${region(exportSource, 'lib/types/client/HeaderAction.js')}; return SessionLogDownloadHeaderAction;`
)(React, jsx, primitives, actionCss, () => null)

const transitions = []
const downloads = []
const h = React.createElement
function NativeHarness() {
  const [view, setView] = React.useState('chat')
  const sessionId = 'smoke-session'
  const action = h(Action, {
    sessionId, useSessionLogDownload: select => select({ bySession: {} }),
    request: id => { downloads.push(id) },
    t: key => ({ 'header.more': '更多操作', 'menu.download': '下载 Session 日志' })[key] ?? key,
  })
  return h(React.Fragment, null,
    h('div', { 'data-slot': 'conversation.session.header' }, h(Header, {
      sessionId, useSession: select => select({ blank: false }), useConversation: select => select({}),
      useSessions: select => select({ byId: { [sessionId]: { id: sessionId, displayTitle: '轨迹入口兼容性验证' } } }),
      useConversationViews: select => select([{ id: 'chat', label: '对话' }, { id: 'trajectory', label: '轨迹' }]),
      useStore: select => select({ view }), open: () => {},
      selectView: id => { transitions.push(id); setView(id) }, t: key => key,
      renderSlot: slot => h('div', { 'data-slot': slot }, slot.endsWith('.utilities') ? action : null),
    })),
    h('textarea', { 'aria-label': '草稿', defaultValue: '未发送的草稿' }),
    h('div', { 'data-current-view': view }, view),
  )
}
const root = createRoot(document.getElementById('root'))
let dispose
let plugin
window.__ModuleLoader__ = { load: entry => { plugin = entry.factory() } }
new Function(readFileSync(new URL('../lib/harness-trajectory-client.js', import.meta.url), 'utf8'))()
try {
  await React.act(async () => { root.render(h(NativeHarness)) })
  const originalHeader = document.querySelector('header')
  const originalHeaderStyle = window.getComputedStyle(originalHeader)
  const originalMinHeight = originalHeaderStyle.minHeight
  const originalPaddingBottom = originalHeaderStyle.paddingBottom
  assert.equal(originalMinHeight, '76px', 'Load the native header CSS, including its two-row minimum height')
  const draft = document.querySelector('textarea')
  await React.act(async () => { plugin.apply({ effect: start => { dispose = start() } }) })
  assert.equal(window.getComputedStyle(document.querySelector('[role="tablist"]')).display, 'none')
  assert.equal(window.getComputedStyle(originalHeader).minHeight, '0', 'Release the space reserved for the hidden tabs')
  assert.equal(window.getComputedStyle(originalHeader).paddingBottom, '10px')
  const more = document.querySelector('button[aria-label="更多操作"]')
  await React.act(async () => { more.click() })
  assert.equal(document.querySelectorAll('[role="menuitem"]').length, 2)
  await React.act(async () => { document.querySelector('[data-arkme-harness-trajectory-item] button').click() })
  assert.deepEqual(transitions, ['trajectory'])
  assert.equal(document.querySelector('[role="menu"]'), null)
  const back = document.querySelector('[data-arkme-harness-return]')
  assert.equal(back.hidden, false)
  assert.equal(document.activeElement, back)
  await React.act(async () => { back.click() })
  assert.deepEqual(transitions, ['trajectory', 'chat'])
  assert.equal(document.querySelector('header'), originalHeader)
  assert.equal(document.querySelector('textarea'), draft)
  assert.equal(draft.value, '未发送的草稿')
  await React.act(async () => { more.click() })
  await React.act(async () => { document.querySelector('[role="menuitem"]').click() })
  assert.deepEqual(downloads, ['smoke-session'])
  dispose()
  assert.equal(document.querySelector('[data-arkme-harness-view-tabs]'), null)
  assert.equal(window.getComputedStyle(originalHeader).minHeight, originalMinHeight)
  assert.equal(window.getComputedStyle(originalHeader).paddingBottom, originalPaddingBottom)
  const version = JSON.parse(readFileSync(join(nativePackage('dsh-client-ui-conversation'), 'package.json'), 'utf8')).version
  console.log(`PASS: native Harness ${version} Header + export action + Menu; compact header and native-style restoration, trajectory round trip, original download, draft identity, focus, and cleanup`)
} finally {
  dispose?.()
  await React.act(async () => { root.unmount() })
  dom.window.close()
}
