import { IconUserOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { Archive } from '@phosphor-icons/react/dist/icons/Archive'
import type { ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const NAV_ICONS: { label: string; marker: string; Icon: ComponentType<{ size: number; className?: string | undefined }> }[] = [
  { label: '我的账户', marker: 'arkmeAccountNavIcon', Icon: IconUserOutline16 },
  { label: '数据管理', marker: 'arkmeDataNavIcon', Icon: Archive },
]
const NAV_ICON_SELECTOR = '[data-arkme-account-nav-icon], [data-arkme-data-nav-icon]'
const SETTINGS_DIALOG_SELECTOR = '[role="dialog"]'
const SETTINGS_UI_SELECTOR = [
  SETTINGS_DIALOG_SELECTOR,
  `${SETTINGS_DIALOG_SELECTOR} nav button`,
  NAV_ICON_SELECTOR,
].join(', ')

interface SettingsNavIconRuntime {
  document: Document
  MutationObserver: typeof MutationObserver | undefined
  createRoot: typeof createRoot
}

interface SettingsIconMount {
  host: HTMLElement
  original: SVGElement
  originalDisplay: string
  root: Root
}

function unmountRoot(root: Root): void {
  try {
    root.unmount()
  } catch {
    // Cleanup must never keep the settings navigation in a patched state.
  }
}

function browserRuntime(): SettingsNavIconRuntime | undefined {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined
  return { document, MutationObserver, createRoot }
}

function touchesSettingsUi(node: Node): boolean {
  if (node.nodeType !== 1) return false
  const element = node as Element
  return element.matches(SETTINGS_UI_SELECTOR)
    || element.closest(SETTINGS_DIALOG_SELECTOR) !== null
    || element.querySelector(SETTINGS_UI_SELECTOR) !== null
}

function mutationTouchesSettingsUi(record: MutationRecord): boolean {
  if (record.type === 'characterData') return record.target.parentElement?.closest(SETTINGS_DIALOG_SELECTOR) != null
  return [...record.addedNodes, ...record.removedNodes].some(touchesSettingsUi)
}

/** The public settings slot has no icon field; adapt only Arkme-owned rows. */
export function installArkmeSettingsNavIcons(
  suppliedRuntime?: SettingsNavIconRuntime,
): () => void {
  const runtime = suppliedRuntime ?? browserRuntime()
  if (runtime?.MutationObserver === undefined) return () => {}

  const mounts = new Map<HTMLElement, SettingsIconMount>()
  let disposed = false

  const cleanDisconnected = () => {
    for (const [host, mount] of mounts) {
      if (host.isConnected) continue
      unmountRoot(mount.root)
      mounts.delete(host)
    }
  }

  const mountIcon = (button: HTMLButtonElement, definition: typeof NAV_ICONS[number]) => {
    if (button.querySelector(NAV_ICON_SELECTOR) !== null) return
    const original = button.querySelector<SVGElement>(':scope > svg')
    if (original === null) return

    const host = runtime.document.createElement('span')
    host.dataset[definition.marker] = 'true'
    const Icon = definition.Icon
    host.style.display = 'inline-flex'
    host.style.flex = 'none'
    host.setAttribute('aria-hidden', 'true')
    original.insertAdjacentElement('afterend', host)

    let root: Root | undefined
    try {
      root = runtime.createRoot(host)
      root.render(
        <Icon
          size={16}
          className={original.getAttribute('class') ?? undefined}
        />,
      )
    } catch {
      if (root !== undefined) unmountRoot(root)
      host.remove()
      return
    }

    const originalDisplay = original.style.display
    original.style.display = 'none'
    mounts.set(host, { host, original, originalDisplay, root })
  }

  const renderNavIcons = () => {
    cleanDisconnected()
    const dialogs = runtime.document.querySelectorAll<HTMLElement>(SETTINGS_DIALOG_SELECTOR)
    for (const dialog of dialogs) {
      const buttons = [...dialog.querySelectorAll<HTMLButtonElement>(':scope > nav button')]
      for (const definition of NAV_ICONS) {
        const matches = buttons.filter(button => button.textContent?.trim() === definition.label)
        if (matches.length === 1) mountIcon(matches[0]!, definition)
      }
    }
  }

  const observer = new runtime.MutationObserver((records) => {
    if (!disposed && records.some(mutationTouchesSettingsUi)) renderNavIcons()
  })
  observer.observe(runtime.document.body, { childList: true, subtree: true, characterData: true })
  renderNavIcons()

  return () => {
    if (disposed) return
    disposed = true
    observer.disconnect()
    for (const mount of mounts.values()) {
      unmountRoot(mount.root)
      if (mount.original.isConnected) mount.original.style.display = mount.originalDisplay
      mount.host.remove()
    }
    mounts.clear()
  }
}
