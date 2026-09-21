import type { DshAccountSession } from '../dsh-remote/account-session-types.js'

export function sessionOrigin(row: DshAccountSession): string[] {
  if (row.local) return []
  return [`实例：${row.runtimeName}`, ...(row.sameDesktop ? [] : [`电脑：${row.desktopName}`])]
}

/** Current-version presentation adapter. Native card, title, time, status and copy remain owned by DSH. */
export function installSessionOriginHover(doc: Document, resolve: (row: HTMLElement) => { title: string; lines: string[] } | undefined): () => void {
  let active: HTMLElement | undefined
  const owned = new Set<HTMLElement>()
  const clear = () => { for (const node of owned) node.remove(); owned.clear() }
  const update = () => {
    if (!active?.isConnected) { clear(); return }
    if (!doc.querySelector('body > div[role="button"][aria-label]')) return
    const { lines = [], title } = resolve(active) ?? {}
    if (!title || !lines.length) { clear(); return }
    for (const card of doc.querySelectorAll<HTMLElement>('body > div[role="button"][aria-label]')) {
      const content = card.firstElementChild, heading = content?.firstElementChild
      const time = heading?.nextElementSibling as HTMLElement | null
      // Copy feedback and unknown upstream card shapes are left untouched.
      if (heading?.textContent !== title || !time || time.children.length || !card.getAttribute('aria-label')?.endsWith(`: ${title}`)) continue
      let extra = content!.querySelector<HTMLElement>('[data-arkme-session-origin]')
      if (!extra) { extra = doc.createElement('div'); extra.dataset.arkmeSessionOrigin = ''; content!.append(extra); owned.add(extra) }
      if (extra.textContent !== lines.join('')) {
        extra.replaceChildren(...lines.map(line => { const node = doc.createElement('div'); node.className = time.className; node.textContent = line; return node }))
      }
    }
    for (const node of owned) if (!node.isConnected) owned.delete(node)
  }
  const over = (event: Event) => {
    const row = (event.target as Element | null)?.closest<HTMLElement>('[data-slot="sidebar.workspaces"] [role="treeitem"][aria-selected]')
    if (row && row !== active) { clear(); active = row; update() }
  }
  const observer = new MutationObserver(update)
  observer.observe(doc.body, { subtree: true, childList: true })
  doc.addEventListener('pointerover', over, true)
  return () => { observer.disconnect(); doc.removeEventListener('pointerover', over, true); clear() }
}
