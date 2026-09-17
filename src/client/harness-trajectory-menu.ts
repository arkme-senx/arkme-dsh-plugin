const HEADER_SLOT = '[data-slot="conversation.session.header"]'
const UTILITIES_SLOT = '[data-slot="conversation.session.header.utilities"]'
const OWNED = '[data-arkme-harness-return], [data-arkme-harness-trajectory-item]'
const TABS_MARKER = 'data-arkme-harness-view-tabs'
const HEADER_MARKER = 'data-arkme-harness-compact-header'

const COPY = [
  { chat: '对话', trajectory: '轨迹', more: '更多操作', view: '查看轨迹', back: '← 返回对话' },
  { chat: 'Chat', trajectory: 'Trajectory', more: 'More actions', view: 'View trajectory', back: '← Back to chat' },
] as const

interface Navigation {
  header: HTMLElement
  tabs: HTMLElement
  chat: HTMLButtonElement
  trajectory: HTMLButtonElement
  more: HTMLButtonElement
  copy: typeof COPY[number]
}

interface Mount extends Navigation {
  back: HTMLButtonElement
  item?: HTMLElement
  focusBack: boolean
}

/** Only recognize the native two-view header; new upstream views keep their own navigation. */
function navigation(header: HTMLElement): Navigation | undefined {
  const tablists = header.querySelectorAll<HTMLElement>(':scope > [role="tablist"]')
  if (tablists.length !== 1) return
  const tabs = tablists[0]!
  const buttons = [...tabs.querySelectorAll<HTMLButtonElement>(':scope > button[role="tab"]')]
  if (buttons.length !== 2 || tabs.children.length !== 2) return
  const copy = COPY.find(value => buttons.some(button => button.textContent?.trim() === value.chat)
    && buttons.some(button => button.textContent?.trim() === value.trajectory))
  if (copy === undefined) return
  const chat = buttons.find(button => button.textContent?.trim() === copy.chat)!
  const trajectory = buttons.find(button => button.textContent?.trim() === copy.trajectory)!
  if (chat.disabled || trajectory.disabled) return
  if (buttons.filter(button => button.getAttribute('aria-selected') === 'true').length !== 1) return
  const triggers = [...header.querySelectorAll<HTMLButtonElement>(`${UTILITIES_SLOT} button[aria-haspopup="menu"]`)]
    .filter(button => button.getAttribute('aria-label') === copy.more && !button.disabled)
  if (triggers.length !== 1) return
  const more = triggers[0]!
  // The native Menu keeps its trigger and menu as siblings. A future portal
  // or different ownership contract must leave the original tabs available.
  if (more.parentElement?.closest(UTILITIES_SLOT) === null) return
  return { header, tabs, chat, trajectory, more, copy }
}

function removeMount(mount: Mount): void {
  mount.tabs.removeAttribute(TABS_MARKER)
  mount.header.removeAttribute(HEADER_MARKER)
  mount.back.remove()
  mount.item?.remove()
}

/**
 * A reversible presentation adapter for DSH's native header. DSH 0.1.5-rc.2
 * has no tab-strip or export-menu-item slot. Keep its components, handlers,
 * session state and other menu entries intact; never copy/replace the header.
 */
export function installHarnessTrajectoryMenu(doc: Document): () => void {
  const Observer = doc.defaultView?.MutationObserver
  if (Observer === undefined || doc.body === null) return () => {}
  const mounts = new Map<HTMLElement, Mount>()
  const unsupported = new WeakSet<HTMLElement>()
  let disposed = false
  const style = doc.createElement('style')
  style.dataset.arkmeHarnessTrajectory = 'true'
  style.textContent = `
    [${TABS_MARKER}] { display: none !important; }
    ${HEADER_SLOT} > header[${HEADER_MARKER}] {
      min-height: 0; padding-bottom: 10px;
    }
    [data-arkme-harness-return] {
      background: transparent; border: 0; padding: 4px 0; margin-top: 8px;
      color: var(--dsw-alias-label-secondary, inherit); font: inherit;
      font-size: 13px; cursor: pointer;
    }
    [data-arkme-harness-return]:hover { color: var(--dsw-alias-label-primary, inherit); }
    [data-arkme-harness-return][hidden] { display: none; }
  `
  doc.head.append(style)

  function makeMount(value: Navigation): Mount {
    const back = doc.createElement('button')
    back.type = 'button'
    back.dataset.arkmeHarnessReturn = 'true'
    back.textContent = value.copy.back
    back.hidden = true
    const mount: Mount = { ...value, back, focusBack: false }
    back.addEventListener('click', () => {
      if (!mount.chat.isConnected || mount.chat.disabled) return
      mount.chat.click()
      mount.more.focus()
    })
    value.header.append(back)
    return mount
  }

  function syncMenu(mount: Mount): boolean {
    if (mount.more.getAttribute('aria-expanded') !== 'true') {
      mount.item?.remove()
      delete mount.item
      return true
    }
    const menus = mount.more.parentElement?.querySelectorAll<HTMLElement>(':scope > [role="menu"]')
    if (menus?.length !== 1) return false
    const menu = menus[0]!
    const template = [...menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')]
      .find(button => !button.closest(OWNED) && button.closest('[role="menu"]') === menu)
    // Check the native Menu's viewport/item boundaries before appending anything.
    const itemParent = template?.parentElement
    const viewport = itemParent?.parentElement
    const label = template === undefined ? undefined : [...template.children]
      .find(child => child.tagName === 'SPAN' && child.textContent?.trim() === template.textContent?.trim())
    if (template === undefined || itemParent === null || itemParent === undefined
      || viewport?.getAttribute('role') !== 'presentation' || viewport.parentElement !== menu
      || label === undefined) return false
    if (mount.item?.parentElement === viewport) return true
    mount.item?.remove()
    const item = doc.createElement('div')
    item.dataset.arkmeHarnessTrajectoryItem = 'true'
    item.className = itemParent.className
    const button = doc.createElement('button')
    button.type = 'button'
    button.setAttribute('role', 'menuitem')
    // Read the current native classes each time the menu opens. No compiled
    // class names, frozen menu CSS, or copies of official actions live here.
    button.className = template.className
    const templateIcon = [...template.children].find(child => child.tagName === 'SPAN' && child.querySelector('svg'))
    if (templateIcon !== undefined) {
      const icon = doc.createElement('span')
      icon.className = templateIcon.className
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('width', '16')
      svg.setAttribute('height', '16')
      svg.setAttribute('viewBox', '0 0 16 16')
      svg.setAttribute('fill', 'none')
      svg.setAttribute('aria-hidden', 'true')
      const path = doc.createElementNS(svg.namespaceURI, 'path')
      path.setAttribute('d', 'M3.5 3h.01M3.5 8h.01M3.5 13h.01M3.5 4.5v2M3.5 9.5v2M7 3h6M7 8h6M7 13h6')
      path.setAttribute('stroke', 'currentColor')
      path.setAttribute('stroke-width', '1.5')
      path.setAttribute('stroke-linecap', 'round')
      svg.append(path)
      icon.append(svg)
      button.append(icon)
    }
    const text = doc.createElement('span')
    text.className = label.className
    text.textContent = mount.copy.view
    button.append(text)
    button.addEventListener('click', event => {
      event.stopPropagation()
      if (!mount.trajectory.isConnected || mount.trajectory.disabled) return
      mount.focusBack = true
      mount.more.click()
      mount.trajectory.click()
    })
    button.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      mount.more.click()
      mount.more.focus()
    })
    item.append(button)
    viewport.append(item)
    mount.item = item
    return true
  }

  function sync(): void {
    if (disposed) return
    for (const [header, mount] of mounts) {
      if (!header.isConnected) { removeMount(mount); mounts.delete(header) }
    }
    for (const header of doc.querySelectorAll<HTMLElement>(`${HEADER_SLOT} > header`)) {
      const value = unsupported.has(header) ? undefined : navigation(header)
      let mount = mounts.get(header)
      if (mount !== undefined && (value === undefined || mount.tabs !== value.tabs
        || mount.more !== value.more || mount.chat !== value.chat || mount.trajectory !== value.trajectory
        || mount.copy !== value.copy || mount.back.parentElement !== header)) {
        removeMount(mount)
        mounts.delete(header)
        mount = undefined
      }
      if (value === undefined) continue
      if (mount === undefined) { mount = makeMount(value); mounts.set(header, mount) }
      if (!syncMenu(mount)) {
        unsupported.add(header)
        removeMount(mount)
        mounts.delete(header)
        continue
      }
      if (!mount.tabs.hasAttribute(TABS_MARKER)) mount.tabs.setAttribute(TABS_MARKER, '')
      if (!mount.header.hasAttribute(HEADER_MARKER)) mount.header.setAttribute(HEADER_MARKER, '')
      const inTrajectory = mount.trajectory.getAttribute('aria-selected') === 'true'
      if (mount.back.hidden === inTrajectory) mount.back.hidden = !inTrajectory
      if (mount.focusBack && inTrajectory) { mount.focusBack = false; mount.back.focus() }
    }
  }

  function touchesHeader(record: MutationRecord): boolean {
    const target = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement
    if (target?.closest(OWNED)) return false
    if (target?.closest(HEADER_SLOT)) return true
    return [...record.addedNodes, ...record.removedNodes].some(node => {
      if (node.nodeType !== 1) return false
      const element = node as Element
      return element.matches(HEADER_SLOT) || element.querySelector(HEADER_SLOT) !== null
    })
  }

  const observer = new Observer(records => { if (records.some(touchesHeader)) sync() })
  observer.observe(doc.body, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['aria-selected', 'aria-expanded', 'aria-label', 'disabled', 'role', 'data-slot'],
  })
  sync()
  return () => {
    if (disposed) return
    disposed = true
    observer.disconnect()
    for (const mount of mounts.values()) removeMount(mount)
    mounts.clear()
    style.remove()
  }
}
