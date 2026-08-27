import { IconUserOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { createRoot, type Root } from 'react-dom/client'

const ACCOUNT_LABEL = '我的账户'
const ACCOUNT_ICON_SELECTOR = '[data-arkme-account-nav-icon]'
const SETTINGS_DIALOG_SELECTOR = '[role="dialog"]'
const SETTINGS_UI_SELECTOR = [
  SETTINGS_DIALOG_SELECTOR,
  `${SETTINGS_DIALOG_SELECTOR} nav button`,
  ACCOUNT_ICON_SELECTOR,
].join(', ')

interface AccountSettingsNavIconRuntime {
  document: Document
  MutationObserver: typeof MutationObserver | undefined
  createRoot: typeof createRoot
}

interface AccountIconMount {
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

function browserRuntime(): AccountSettingsNavIconRuntime | undefined {
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
  return [...record.addedNodes, ...record.removedNodes].some(touchesSettingsUi)
}

/** Install the Arkme account navigation icon and return its lifecycle cleanup. */
export function installArkmeAccountSettingsNavIcon(
  suppliedRuntime?: AccountSettingsNavIconRuntime,
): () => void {
  const runtime = suppliedRuntime ?? browserRuntime()
  if (runtime?.MutationObserver === undefined) return () => {}

  const mounts = new Map<HTMLElement, AccountIconMount>()
  let disposed = false

  const cleanDisconnected = () => {
    for (const [host, mount] of mounts) {
      if (host.isConnected) continue
      unmountRoot(mount.root)
      mounts.delete(host)
    }
  }

  const mountIcon = (button: HTMLButtonElement) => {
    if (button.querySelector(ACCOUNT_ICON_SELECTOR) !== null) return
    const original = button.querySelector<SVGElement>(':scope > svg')
    if (original === null) return

    const host = runtime.document.createElement('span')
    host.dataset.arkmeAccountNavIcon = 'true'
    host.style.display = 'inline-flex'
    host.style.flex = 'none'
    host.setAttribute('aria-hidden', 'true')
    original.insertAdjacentElement('afterend', host)

    let root: Root | undefined
    try {
      root = runtime.createRoot(host)
      root.render(
        <IconUserOutline16
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

  const renderAccountIcons = () => {
    cleanDisconnected()
    const dialogs = runtime.document.querySelectorAll<HTMLElement>(SETTINGS_DIALOG_SELECTOR)
    for (const dialog of dialogs) {
      const accountButtons = [...dialog.querySelectorAll<HTMLButtonElement>(':scope > nav button')]
        .filter(button => button.textContent?.trim() === ACCOUNT_LABEL)
      if (accountButtons.length !== 1) continue
      mountIcon(accountButtons[0]!)
    }
  }

  const observer = new runtime.MutationObserver((records) => {
    if (!disposed && records.some(mutationTouchesSettingsUi)) renderAccountIcons()
  })
  observer.observe(runtime.document.body, { childList: true, subtree: true })
  renderAccountIcons()

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
