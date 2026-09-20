import { HARNESS_MENU_OPEN, HARNESS_MENU_CLOSE, HARNESS_MENU_POSITION, type HarnessSessionMenuRequest } from './harness-session-menu-bridge.js'
import { CONVERSATION_MENU_COLORS, CONVERSATION_MENU_LAYOUT, CONVERSATION_MENU_SURFACE, CONVERSATION_SELECTOR_CSS } from './conversation-selector-style.js'
import { conversationMenuPosition } from './conversation-menu-layer.js'
import { watchConversationMenuScrollbars } from './conversation-menu-scrollbars.js'
import { HARNESS_CONVERSATION_NAME } from './conversation-header-layout.js'

const PREFIX = 'data-arkme-session-'
const HEADER = '[data-slot="conversation.session.header"] > header'
const SIDEBAR = '[data-slot="sidebar"]'
const COPY = [
  { expand: '打开侧边栏', collapse: '收起侧边栏', create: '新建会话', blank: '新会话', sessions: '会话', choose: '切换会话', search: '搜索会话', view: '视图选项', add: '添加工作区' },
  { expand: 'Open sidebar', collapse: 'Collapse sidebar', create: 'New session', blank: 'New Session', sessions: 'Sessions', choose: 'Switch session', search: 'Search sessions', view: 'View options', add: 'Add workspace' },
] as const

function mark(node: Element, key: string, value = ''): void {
  if (node.getAttribute(PREFIX + key) !== value) node.setAttribute(PREFIX + key, value)
}
function variable(node: HTMLElement, key: string, value: string): void {
  if (node.style.getPropertyValue(key) !== value) node.style.setProperty(key, value)
}

/** Recognize only the native shell contract. Unknown upstream layouts keep their sidebar. */
function shell(doc: Document) {
  const slot = doc.querySelector<HTMLElement>(SIDEBAR)
  const column = slot?.parentElement
  const frame = column?.parentElement
  const root = slot?.firstElementChild as HTMLElement | null
  const center = frame?.children[1] as HTMLElement | undefined
  const right = frame?.children[2]
  const tracks = frame?.style.gridTemplateColumns.match(/^\S+px minmax\(0(?:px)?, 1fr\) (\S+px)$/)
  if (!root || !column || !frame || !center || !tracks || frame.firstElementChild !== column
    || !right?.hasAttribute('data-rightbar-col') || !root.querySelector('[data-slot="sidebar.workspaces"]')) return
  const brand = root.firstElementChild as HTMLElement | null
  const toggle = brand?.querySelector<HTMLButtonElement>('button[aria-label]:last-child')
  const copy = COPY.find(c => c.expand === toggle?.getAttribute('aria-label') || c.collapse === toggle?.getAttribute('aria-label'))
  const create = [...root.querySelectorAll<HTMLButtonElement>(':scope > button[aria-label]')]
    .find(button => button.getAttribute('aria-label') === copy?.create)
  if (!brand || !toggle || !copy || !create) return
  return { slot, column, frame, root, center, brand, toggle, create, copy, rightTrack: tracks[1]! }
}

type Shell = NonNullable<ReturnType<typeof shell>>

/** Recognize the official workspace toolbar without moving any React-owned node. */
function compactTools(value: Shell): Array<[HTMLElement, string]> {
  const browser = value.root.querySelector('[data-slot="sidebar.workspaces"]')?.firstElementChild
  const header = browser?.firstElementChild as HTMLElement | null
  if (!header) return []
  const buttons = [...header.querySelectorAll<HTMLButtonElement>('button[aria-label]')]
  const search = buttons.find(button => button.getAttribute('aria-label') === value.copy.search)
  const view = buttons.find(button => button.getAttribute('aria-label') === value.copy.view)
  const children = [...header.children] as HTMLElement[]
  const searchArea = search && children.find(child => child.contains(search))
  const actions = view && children.find(child => child.contains(view))
  const heading = header.firstElementChild as HTMLElement | null
  if (!searchArea || !actions || searchArea === actions || !heading || heading.tagName !== 'SPAN'
    || !header.querySelector('[data-slot="sidebar.workspaces.directoryFlow"]')
    || [...actions.querySelectorAll('button')].some(button => ![value.copy.view, value.copy.add].some(label => label === button.getAttribute('aria-label')))) return []
  return [[header, 'tools-header'], [heading, 'tools-label'], [searchArea, 'tools-search'], [actions, 'tools-actions']]
}

/** Keep the native title and action slot in their React ancestry; only stack their layout. */
function summaryLayout(header: HTMLElement | undefined): Array<[HTMLElement, string]> {
  if (!header || header.getAttribute('aria-hidden') === 'true') return []
  const actionsSlot = header.querySelector<HTMLElement>('[data-slot="conversation.session.header.actions"]')
  const actions = actionsSlot?.parentElement
  const cluster = actions?.parentElement
  const row = cluster?.parentElement
  const nav = cluster?.querySelector<HTMLElement>(':scope > nav')
  if (!actions || !cluster || !row || !nav || row.parentElement !== header || cluster.children.length !== 2
    || cluster.firstElementChild !== nav || cluster.lastElementChild !== actions) return []
  const utilities = [...row.children].filter(node => node !== cluster && !node.hasAttribute(PREFIX + 'identity')) as HTMLElement[]
  return [[header, 'header'], [row, 'title-row'], [cluster, 'title-cluster'], [actions, 'summary'], [nav, 'title-nav'],
    ...utilities.map(node => [node, 'utilities'] as [HTMLElement, string]),
    ...(utilities[0] ? [[utilities[0], 'utilities-start'] as [HTMLElement, string]] : [])]
}

/**
 * The selected row already owns the live task status (pending interaction, live
 * activity, running subagents). Mirror that exact node instead of re-deriving
 * the states and colors here, so the fixed title cannot drift from the list.
 */
type NativeSessionStatus = 'done' | 'warning' | 'ongoing' | 'error' | 'idle'

function selectedRowStatus(value: Shell): { dot: Element; labels: string[]; state: NativeSessionStatus } | undefined {
  const row = value.column.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]')
  const slot = row?.firstElementChild
  const dot = slot?.querySelector<HTMLElement>('[data-state]')
  const state = dot?.getAttribute('data-state') as NativeSessionStatus | null
  if (!slot || !dot || state === null || !['done', 'warning', 'ongoing', 'error', 'idle'].includes(state)) return undefined
  const labels = [...slot.querySelectorAll('span:not([data-state])')]
    .map(node => node.textContent?.trim() ?? '').filter(text => text !== '')
  return { dot, labels, state }
}

/**
 * Presentation-only adapter: the native SidebarRoot, WorkspaceBrowser, their
 * live slots, handlers, menus, stores and React ancestry all stay mounted in
 * place. No copied session list or private API. Only the sidebar's position,
 * the first grid track, and the title trigger are adapted; disposal restores
 * them. There is no public title/zero-width-sidebar slot in DSH 0.1.5-rc.2.
 */
export function installHarnessSessionDropdown(doc: Document): () => void {
  const win = doc.defaultView
  if (!win || !doc.body) return () => {}
  let current: Shell | undefined
  let title: HTMLElement | undefined
  let statusSignature = ''
  let open = false
  let external: HarnessSessionMenuRequest | undefined
  let disposed = false
  let scheduled = false
  const rowFocusCleanups = new Map<HTMLElement, () => void>()
  let toolbarMarks: Array<[HTMLElement, string]> = []
  let summaryMarks: Array<[HTMLElement, string]> = []
  let scrollList: HTMLElement | undefined
  let stopScrollbars: (() => void) | undefined
  let initiallyCollapsed = false
  let expandedByUs = false
  let columnBefore = { role: null as string | null, label: null as string | null, inert: false }
  const host = doc.createElement('span')
  mark(host, 'anchor')
  const identity = doc.createElement('span')
  mark(identity, 'identity')
  identity.textContent = HARNESS_CONVERSATION_NAME
  identity.title = HARNESS_CONVERSATION_NAME
  identity.setAttribute('role', 'heading')
  identity.setAttribute('aria-level', '2')
  const trigger = doc.createElement('button')
  trigger.type = 'button'
  trigger.setAttribute('aria-haspopup', 'dialog')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('data-arkme-conversation-selector', '')
  mark(trigger, 'trigger')
  const label = doc.createElement('span')
  const status = doc.createElement('span')
  mark(status, 'status')
  status.setAttribute('aria-hidden', 'true')
  const statusLabel = doc.createElement('span')
  mark(statusLabel, 'status-label')
  statusLabel.setAttribute('aria-hidden', 'true')
  const labelText = doc.createElement('span')
  label.append(status, labelText, statusLabel)
  const arrow = doc.createElement('span')
  const chevron = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
  chevron.setAttribute('viewBox', '0 0 16 16')
  chevron.setAttribute('width', '14')
  chevron.setAttribute('height', '14')
  chevron.setAttribute('fill', 'none')
  const chevronPath = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
  chevronPath.setAttribute('d', 'm4 6 4 4 4-4')
  chevronPath.setAttribute('stroke', 'currentColor')
  chevronPath.setAttribute('stroke-width', '1.5')
  chevronPath.setAttribute('stroke-linecap', 'round')
  chevronPath.setAttribute('stroke-linejoin', 'round')
  chevron.append(chevronPath)
  arrow.append(chevron)
  arrow.setAttribute('aria-hidden', 'true')
  trigger.append(label, arrow)
  host.append(trigger)
  const style = doc.createElement('style')
  mark(style, 'style')
  style.textContent = `
    html[${PREFIX}preview], html[${PREFIX}preview] body { background: transparent !important; }
    html[${PREFIX}preview] body { visibility: hidden !important; }
    html[${PREFIX}preview] [${PREFIX}column], html[${PREFIX}preview] [role="menu"],
    html[${PREFIX}preview] [role="dialog"], html[${PREFIX}preview] [role="alertdialog"] { visibility: visible !important; }
    [${PREFIX}frame] { grid-template-columns: 0px minmax(0, 1fr) var(--arkme-session-rightbar) !important; transition: none !important; }
    [${PREFIX}frame] > :nth-child(2) { grid-column: 2; }
    [${PREFIX}frame] > [data-rightbar-col] { grid-column: 3; }
    [${PREFIX}frame] > [data-side="sidebar"] { display: none !important; }
    [${PREFIX}column] {
      position: fixed !important; left: var(--arkme-session-left); top: var(--arkme-session-top);
      width: var(--arkme-session-width); height: auto; max-height: var(--arkme-session-height); z-index: 80;
      border: ${CONVERSATION_MENU_SURFACE.border}; border-radius: ${CONVERSATION_MENU_SURFACE.borderRadius}px;
      background: ${CONVERSATION_MENU_SURFACE.background}; box-shadow: ${CONVERSATION_MENU_SURFACE.boxShadow}; box-sizing: border-box; overflow: visible !important;
      display: none !important; pointer-events: none;
    }
    [${PREFIX}column][${PREFIX}open] { display: block !important; pointer-events: auto; }
    [${PREFIX}root] { width: 100% !important; height: auto; max-height: var(--arkme-session-height); border-radius: 9px; padding: ${CONVERSATION_MENU_LAYOUT.paddingY}px ${CONVERSATION_MENU_LAYOUT.paddingX}px !important; position: relative; }
    [${PREFIX}brand], [${PREFIX}native-title] { display: none !important; }
    [${PREFIX}create] { order: 10; flex-shrink: 0; margin: 8px 0 0 !important; }
    [${PREFIX}root][${PREFIX}compact-tools] [${PREFIX}create] { width: calc(100% - var(--arkme-session-tools-width) - 8px); }
    [${PREFIX}tools-header] { display: contents !important; }
    [${PREFIX}tools-label], [${PREFIX}tools-search] { display: none !important; }
    [${PREFIX}tools-actions] {
      position: absolute !important; bottom: ${CONVERSATION_MENU_LAYOUT.paddingY}px; right: ${CONVERSATION_MENU_LAYOUT.paddingX}px; height: ${CONVERSATION_MENU_LAYOUT.createHeight}px;
      display: flex !important; align-items: center; gap: 4px; max-width: none !important;
      opacity: 1 !important; visibility: visible !important; transform: none !important;
    }
    [${PREFIX}anchor] { display: inline-flex; width: max-content; min-width: 0; max-width: 100%; }
    /* The selected row's own status dot, mirrored beside the fixed title. Empty
       when the session has no status, so the title keeps its full width. */
    [${PREFIX}status] {
      display: none; flex: none; width: 16px; height: 16px; margin-right: 6px;
      align-items: center; justify-content: center; vertical-align: middle;
    }
    [${PREFIX}status]:not(:empty) { display: inline-flex; }
    [${PREFIX}status-label] {
      display: none; flex: none; min-width: 0; max-width: 96px; margin-left: 6px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: var(--dsw-alias-label-secondary, #626872); font-size: 12px; font-weight: 500; line-height: 18px;
    }
    [${PREFIX}status-label]:not(:empty) { display: inline-block; }
    [${PREFIX}header] { padding-left: 20px; padding-right: 20px; container: arkme-session-header / inline-size; }
    [${PREFIX}title-row] {
      --arkme-header-side: max(calc((100% - 8px) / 4), var(--arkme-header-utilities-width, 0px));
      display: flex !important; flex-wrap: nowrap; gap: 4px; align-items: flex-start;
    }
    [${PREFIX}identity] {
      flex: 0 0 var(--arkme-header-side); min-width: 0; max-width: 100%;
      color: var(--dsw-alias-label-primary); font-size: 15px; font-weight: 600; line-height: 30px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    [${PREFIX}identity][${PREFIX}fallback] { position: absolute; top: 10px; left: 20px; max-width: calc(25% - 24px); }
    [${PREFIX}title-cluster] { flex: 0 0 max(0px, calc(100% - 2 * var(--arkme-header-side) - 8px)); min-width: 0; flex-direction: column; align-items: stretch; gap: 4px; }
    [${PREFIX}utilities] { flex: 0 0 auto; min-width: 0; }
    [${PREFIX}utilities-start] { margin-left: auto; }
    /* Equal side reservations center both native rows without moving any of the
       multiple upstream right-side control groups into a new grid row. */
    [${PREFIX}title-nav] { width: 100%; display: flex; justify-content: center; }
    [${PREFIX}title-nav] > * { min-width: 0; max-width: 100%; }
    [${PREFIX}summary] { min-width: 0; height: 18px; min-height: 18px; gap: 0; flex-wrap: nowrap; overflow: hidden; white-space: nowrap; justify-content: center; color: var(--dsw-alias-label-secondary, #626872); font-size: 12px; line-height: 18px; }
    [${PREFIX}summary] [data-slot="conversation.session.header.actions"] { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    [${PREFIX}summary] [data-slot="conversation.session.header.actions"] > * { font-size: inherit; line-height: inherit; }
    [${PREFIX}turn-count] { display: inline-flex; align-items: center; white-space: nowrap; }
    [${PREFIX}summary] [data-slot="conversation.session.header.actions"] > * + [${PREFIX}turn-count]::before { content: '·'; margin: 0 7px; }
    /* The embedded conversation can be much narrower than the browser. Keep
       native controls in their React ancestry, wrapping only in that case. */
    @container arkme-session-header (max-width: 360px) {
      [${PREFIX}title-row] { flex-wrap: wrap; row-gap: 8px; }
      [${PREFIX}identity] { flex-basis: calc(40% - 1.6px); }
      [${PREFIX}title-cluster] { flex-basis: calc(60% - 2.4px); }
      [${PREFIX}utilities] { margin-left: 0; margin-right: 0; max-width: 100%; flex-wrap: wrap; }
      [${PREFIX}utilities-start] { margin-left: auto; }
      [${PREFIX}title-nav] [${PREFIX}anchor] { display: inline-flex; min-width: 0; max-width: 100%; }
    }
    [${PREFIX}anchor][${PREFIX}fallback] {
      width: max-content; position: absolute; top: 10px;
      left: 50%; transform: translateX(-50%); z-index: 10; max-width: calc(50% - 8px);
    }
    ${CONVERSATION_SELECTOR_CSS}
    [${PREFIX}column] [role="treeitem"][aria-selected]:hover { background: ${CONVERSATION_MENU_COLORS.hover}; }
    [${PREFIX}column] [role="treeitem"][aria-selected="true"],
    [${PREFIX}column] [role="treeitem"][aria-selected="true"]:hover { background: ${CONVERSATION_MENU_COLORS.selected}; }
    [${PREFIX}column] [role="treeitem"]:focus-visible { outline: 2px solid #4c70ef; outline-offset: -2px; }
  `
  doc.head.append(style)

  function close(focus = false) {
    if (!open) return
    const request = external
    external = undefined
    open = false
    current?.column.removeAttribute(PREFIX + 'open')
    if (current) current.column.inert = true
    trigger.setAttribute('aria-expanded', 'false')
    if (request) request.onClose(focus)
    else if (focus && trigger.isConnected) trigger.focus()
  }
  function restore() {
    close()
    stopScrollbars?.(); stopScrollbars = undefined; scrollList = undefined
    for (const cleanup of rowFocusCleanups.values()) cleanup()
    for (const [node, key] of toolbarMarks) node.removeAttribute(PREFIX + key)
    toolbarMarks = []
    for (const [node, key] of summaryMarks) {
      node.removeAttribute(PREFIX + key)
      if (key === 'title-row') node.style.removeProperty('--arkme-header-utilities-width')
    }
    summaryMarks = []
    title?.removeAttribute(PREFIX + 'native-title')
    title = undefined
    statusSignature = ''
    status.replaceChildren()
    statusLabel.textContent = ''
    host.remove()
    identity.remove()
    if (current) {
      const { frame, column, root, brand, create, toggle } = current
      for (const [node, key] of [[frame, 'frame'], [column, 'column'], [root, 'root'], [brand, 'brand'], [create, 'create']] as const) node.removeAttribute(PREFIX + key)
      frame.style.removeProperty('--arkme-session-rightbar')
      root.removeAttribute(PREFIX + 'compact-tools')
      root.style.removeProperty('--arkme-session-tools-width')
      for (const key of ['left', 'top', 'width', 'height']) column.style.removeProperty('--arkme-session-' + key)
      column.inert = columnBefore.inert
      for (const [key, value] of [['role', columnBefore.role], ['aria-label', columnBefore.label]] as const) {
        if (value === null) column.removeAttribute(key)
        else column.setAttribute(key, value)
      }
      if (expandedByUs && initiallyCollapsed && toggle.isConnected && toggle.getAttribute('aria-label') === current.copy.collapse) toggle.click()
    }
    current = undefined
    expandedByUs = false
  }
  function position() {
    if (!current) return
    const rect = trigger.getBoundingClientRect()
    const width = Math.min(CONVERSATION_MENU_LAYOUT.width, win!.innerWidth - 24)
    const anchor = external?.anchor()
    const hoverPosition = anchor && conversationMenuPosition(anchor, width, Math.min(CONVERSATION_MENU_LAYOUT.maxHeight, win!.innerHeight - 24), { width: win!.innerWidth, height: win!.innerHeight })
    const top = hoverPosition?.top ?? Math.max(8, Math.min(rect.bottom + 7, win!.innerHeight - 100))
    variable(current.column, '--arkme-session-left', `${hoverPosition?.left ?? Math.max(CONVERSATION_MENU_LAYOUT.viewportInset, Math.min(rect.left, win!.innerWidth - width - CONVERSATION_MENU_LAYOUT.viewportInset))}px`)
    variable(current.column, '--arkme-session-top', `${top}px`)
    variable(current.column, '--arkme-session-width', `${width}px`)
    variable(current.column, '--arkme-session-height', `${Math.min(CONVERSATION_MENU_LAYOUT.maxHeight, win!.innerHeight - top - CONVERSATION_MENU_LAYOUT.viewportInset)}px`)
    external?.onLayout()
  }
  function sync() {
    scheduled = false
    if (disposed) return
    const next = shell(doc)
    if (!next) { restore(); return }
    if (current?.root !== next.root || current.frame !== next.frame) {
      restore()
      current = next
      columnBefore = { role: next.column.getAttribute('role'), label: next.column.getAttribute('aria-label'), inert: next.column.inert === true }
      initiallyCollapsed = next.toggle.getAttribute('aria-label') === next.copy.expand
      current.column.inert = true
      current.column.setAttribute('role', 'dialog')
      current.column.setAttribute('aria-label', next.copy.choose)
    } else current = next
    mark(next.frame, 'frame')
    mark(next.column, 'column')
    mark(next.root, 'root')
    mark(next.brand, 'brand')
    mark(next.create, 'create')
    const tree = next.root.querySelector<HTMLElement>('[data-slot="sidebar.workspaces"] [role="tree"]')
    let list = tree ?? undefined
    // Grouped and flat views can place the tree inside different scroll wrappers.
    for (let node = tree; node && node !== next.root; node = node.parentElement) {
      if (win!.getComputedStyle(node).overflowY === 'auto') { list = node; break }
    }
    if (list !== scrollList) {
      stopScrollbars?.()
      scrollList = list
      stopScrollbars = list ? watchConversationMenuScrollbars(next.root, list) : undefined
    }
    const nextTools = compactTools(next)
    for (const [node, key] of toolbarMarks) {
      if (!nextTools.some(([nextNode, nextKey]) => node === nextNode && key === nextKey)) node.removeAttribute(PREFIX + key)
    }
    toolbarMarks = nextTools
    for (const [node, key] of toolbarMarks) mark(node, key)
    const tools = toolbarMarks.find(([, key]) => key === 'tools-actions')?.[0]
    if (tools) {
      mark(next.root, 'compact-tools')
      const count = tools.querySelectorAll('button').length
      variable(next.root, '--arkme-session-tools-width', `${count * 28 + Math.max(0, count - 1) * 4}px`)
    } else {
      next.root.removeAttribute(PREFIX + 'compact-tools')
      next.root.style.removeProperty('--arkme-session-tools-width')
    }
    variable(next.frame, '--arkme-session-rightbar', next.rightTrack)
    const header = next.center.querySelector<HTMLElement>(HEADER)
    const nextSummary = summaryLayout(header ?? undefined)
    for (const [node, key] of summaryMarks) {
      if (!nextSummary.some(([nextNode, nextKey]) => node === nextNode && key === nextKey)) {
        node.removeAttribute(PREFIX + key)
        if (key === 'title-row') node.style.removeProperty('--arkme-header-utilities-width')
      }
    }
    summaryMarks = nextSummary
    for (const [node, key] of summaryMarks) mark(node, key)
    const visibleHeader = header && header.getAttribute('aria-hidden') !== 'true'
    const titleRow = summaryMarks.find(([, key]) => key === 'title-row')?.[0]
    if (titleRow) {
      const utilityNodes = summaryMarks.filter(([, key]) => key === 'utilities').map(([node]) => node)
      const utilityWidth = utilityNodes.reduce((sum, node) => sum + node.getBoundingClientRect().width, 0)
        + Math.max(0, utilityNodes.length - 1) * 4
      variable(titleRow, '--arkme-header-utilities-width', `${Math.ceil(utilityWidth)}px`)
      identity.removeAttribute(PREFIX + 'fallback')
      if (identity.parentElement !== titleRow) titleRow.prepend(identity)
    } else if (!visibleHeader) {
      mark(identity, 'fallback')
      if (identity.parentElement !== next.center) next.center.append(identity)
    } else {
      // An unrecognized future native header keeps its own layout, not an
      // overlaid product name that could obscure upstream navigation.
      identity.remove()
    }
    const nativeTitle = visibleHeader
      ? header?.querySelector<HTMLElement>('nav > :last-child > button:disabled') : undefined
    if (title !== nativeTitle) {
      title?.removeAttribute(PREFIX + 'native-title')
      title = nativeTitle ?? undefined
    }
    if (title?.parentElement) {
      mark(title, 'native-title')
      host.removeAttribute(PREFIX + 'fallback')
      if (host.parentElement !== title.parentElement) title.before(host)
    } else if (visibleHeader && header.querySelector('nav')) {
      // Addressed subagents may own a richer lineage title. Keep that title intact.
      const nav = header.querySelector('nav')!
      host.removeAttribute(PREFIX + 'fallback')
      if (host.parentElement !== nav) nav.prepend(host)
    } else {
      mark(host, 'fallback')
      if (host.parentElement !== next.center) next.center.append(host)
    }
    const text = title?.textContent?.trim() || (visibleHeader ? next.copy.sessions : next.copy.blank)
    if (labelText.textContent !== text) labelText.textContent = text
    trigger.title = text
    // Re-clone only when the row's status actually changed: replacing the node
    // restarts the ongoing dot's CSS chase animation and would make it flicker
    // on every unrelated re-render of the native list.
    const nativeStatus = selectedRowStatus(next)
    const statusText = nativeStatus?.labels.join('、') ?? ''
    const signature = nativeStatus === undefined ? '' : `${nativeStatus.dot.outerHTML}\u0000${statusText}\u0000${nativeStatus.state}`
    if (statusSignature !== signature) {
      statusSignature = signature
      status.replaceChildren()
      statusLabel.textContent = ''
      if (nativeStatus !== undefined) {
        const mirror = nativeStatus.dot.cloneNode(true) as Element
        mark(mirror, 'status-dot')
        status.append(mirror)
        statusLabel.textContent = nativeStatus.labels[0] ?? ({
          ongoing: next.copy.expand === 'Open sidebar' ? 'Running' : '进行中',
          done: next.copy.expand === 'Open sidebar' ? 'Completed' : '已完成',
          warning: next.copy.expand === 'Open sidebar' ? 'Needs attention' : '等待处理',
          error: next.copy.expand === 'Open sidebar' ? 'Error' : '出错',
          idle: next.copy.expand === 'Open sidebar' ? 'Idle' : '空闲',
        } satisfies Record<NativeSessionStatus, string>)[nativeStatus.state]
      }
    }
    trigger.setAttribute('aria-label', statusText === ''
      ? `${next.copy.choose}：${text}`
      : `${next.copy.choose}：${text}（${statusText}）`)
    position()
  }
  function schedule() {
    if (disposed || scheduled) return
    scheduled = true
    win!.queueMicrotask(sync)
  }
  function show(request?: HarnessSessionMenuRequest) {
    if (!current) return
    if (current.toggle.getAttribute('aria-label') === current.copy.expand) {
      current.toggle.click()
      expandedByUs = true
    }
    open = true
    external = request
    current.column.inert = false
    mark(current.column, 'open')
    trigger.setAttribute('aria-expanded', request ? 'false' : 'true')
    if (request) request.accepted = true
    position()
    win!.requestAnimationFrame(() => current?.column.querySelector('[role="treeitem"][aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))
  }
  trigger.addEventListener('click', () => {
    if (open && !external) { close(); return }
    close()
    show()
  })
  function externalOpen(event: Event) {
    const request = (event as CustomEvent<HarnessSessionMenuRequest>).detail
    if (!request || !current) return
    close()
    show(request)
  }
  function externalClose() {
    if (!external) return
    // A parent-document outside click cannot reach native portalled menus.
    for (const overlay of doc.querySelectorAll<HTMLElement>('[role="menu"], [role="alertdialog"], [role="dialog"]:not([' + PREFIX + 'column])')) {
      overlay.dispatchEvent(new win!.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }
    close()
  }
  function pointer(event: Event) {
    if (!open || !current) return
    const target = event.target as Element | null
    if (external && target?.ownerDocument !== doc) return // The card bridge owns parent-document dismissal.
    if (target && (host.contains(target) || current.column.contains(target))) return
    // Native workspace menus/dialogs may be portalled; let them finish their own flow.
    if (target?.closest?.('[role="menu"], [role="dialog"], [role="alertdialog"]')) return
    close()
  }
  function click(event: MouseEvent) {
    if (!open || !current) return
    const target = event.target as Element | null
    if (!target || !current.column.contains(target)) return
    const row = target.closest('[role="treeitem"][aria-selected]')
    const buttonLabel = target.closest('button')?.getAttribute('aria-label') ?? ''
    const workspaceCreate = /^在“.+”中新建会话$/.test(buttonLabel) || /^New session in /.test(buttonLabel)
    if ((row && !target.closest('button, input, [role="menu"]')) || current.create.contains(target) || workspaceCreate
      || target.closest('nav button')) {
      const request = external
      close(!request)
      request?.onSelect()
    }
  }
  function key(event: KeyboardEvent) {
    if (!open || !current) return
    const target = event.target as HTMLElement | null
    // Native menus and dialogs own Escape first.
    if (doc.querySelector('[role="menu"], [role="alertdialog"], [role="dialog"]:not([' + PREFIX + 'column])')) return
    if (event.key === 'Escape') { event.preventDefault(); close(true); return }
    if (!target || target.matches('input, textarea, [contenteditable="true"]')) return
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    if (!host.contains(target) && !current.column.contains(target)) return
    const rows = [...current.column.querySelectorAll<HTMLElement>('[role="treeitem"][aria-selected]')].filter(row => row.getClientRects().length > 0)
    if (!rows.length) return
    const index = rows.findIndex(row => row === target)
    const nextIndex = index < 0 ? (event.key === 'ArrowDown' ? 0 : rows.length - 1)
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
    const next = rows[nextIndex]!
    if (!next.hasAttribute('tabindex')) {
      next.tabIndex = -1
      const remove = () => { next.removeAttribute('tabindex'); next.removeEventListener('blur', remove); rowFocusCleanups.delete(next) }
      rowFocusCleanups.set(next, remove)
      next.addEventListener('blur', remove)
    }
    next.focus()
    next.scrollIntoView({ block: 'nearest' })
    event.preventDefault()
  }
  function rowKey(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null
    if (open && (event.key === 'Enter' || event.key === ' ') && target?.matches('[role="treeitem"][aria-selected]') && current?.column.contains(target)) {
      event.preventDefault()
      target.click()
    }
  }
  const observer = new win.MutationObserver(schedule)
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'style', 'aria-hidden', 'aria-selected', 'disabled', 'data-slot', 'data-state'] })
  doc.addEventListener('pointerdown', pointer, true)
  doc.addEventListener('click', click)
  doc.addEventListener('keydown', key)
  doc.addEventListener('keydown', rowKey)
  doc.addEventListener(HARNESS_MENU_OPEN, externalOpen)
  doc.addEventListener(HARNESS_MENU_CLOSE, externalClose)
  doc.addEventListener(HARNESS_MENU_POSITION, position)
  let parentDoc: Document | undefined
  try { if (win.parent !== win) parentDoc = win.parent.document } catch { /* Same-origin Arkme only. */ }
  parentDoc?.addEventListener('pointerdown', pointer, true)
  win.addEventListener('resize', schedule)
  sync()
  return () => {
    disposed = true
    observer.disconnect()
    doc.removeEventListener('pointerdown', pointer, true)
    doc.removeEventListener('click', click)
    doc.removeEventListener('keydown', key)
    doc.removeEventListener('keydown', rowKey)
    doc.removeEventListener(HARNESS_MENU_OPEN, externalOpen)
    doc.removeEventListener(HARNESS_MENU_CLOSE, externalClose)
    doc.removeEventListener(HARNESS_MENU_POSITION, position)
    parentDoc?.removeEventListener('pointerdown', pointer, true)
    win.removeEventListener('resize', schedule)
    restore()
    style.remove()
  }
}
