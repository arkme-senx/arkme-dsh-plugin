const MARK = 'data-arkme-schedule-failure'
const NOTE = 'data-arkme-schedule-notice'
const CODE = 'data-arkme-schedule-error'
const nativeFailure = (element: HTMLElement) => ['无法加载提醒。', '无法加载任务', 'Could not load reminders.', 'Could not load tasks.'].includes(element.textContent?.trim() ?? '')

export function scheduleFailureCopy(code: string, english = false): string {
  if (code === 'RUNTIME_OFFLINE') return english
    ? 'The source computer is offline. Reminders cannot be read yet.'
    : '源电脑未连接，暂无法读取提醒。连接后可重试。'
  if (code === 'CAPABILITY_UNSUPPORTED' || code === 'REMOTE_PROTOCOL_UNSUPPORTED') return english
    ? 'Update DSH and the Arkme plugin on the source computer, then retry.'
    : '源电脑尚不支持此提醒操作，请更新源电脑的 DSH 和即我插件后重试。'
  return english ? 'Could not read reminders. Please retry.' : '提醒读取失败，请重试。'
}

/** Supplement native error copy without replacing its task UI, retry handler,
 * React-owned text, or catalogue. Unknown future DOM keeps the native fallback. */
export function installHarnessScheduleFeedback(doc: Document): () => void {
  const Observer = doc.defaultView?.MutationObserver
  const surface = doc.defaultView?.frameElement?.parentElement
  if (!Observer || !surface || !doc.body) return () => {}
  const mounts = new Map<HTMLElement, HTMLElement>()
  const style = doc.createElement('style')
  style.textContent = `[${MARK}] { display: none !important; }
    [${NOTE}] + button { flex-shrink: 0; white-space: nowrap; }`
  doc.head.append(style)
  const restore = (original: HTMLElement, note: HTMLElement) => {
    original.removeAttribute(MARK); note.remove(); mounts.delete(original)
  }
  const sync = () => {
    const code = surface.getAttribute(CODE)
    for (const [original, note] of mounts) {
      if (!code || !original.isConnected || original.parentElement !== note.parentElement || !nativeFailure(original)) restore(original, note)
    }
    if (!code) return
    const alerts = doc.querySelectorAll<HTMLElement>(
      'ul[aria-label="活动提醒"] [role="alert"], ul[aria-label="Active reminders"] [role="alert"], [data-slot="sidebar.right.pane.tab"] [role="alert"]',
    )
    for (const original of alerts) {
      if (original.hasAttribute(NOTE)) continue
      const text = original.textContent?.trim() ?? ''
      if (!nativeFailure(original)) continue
      let note = mounts.get(original)
      if (!note) {
        note = doc.createElement(original.tagName)
        note.setAttribute(NOTE, ''); note.setAttribute('role', 'alert')
        note.className = original.className
        original.setAttribute(MARK, '')
        original.after(note); mounts.set(original, note)
      }
      const copy = scheduleFailureCopy(code, text.startsWith('Could'))
      if (note.textContent !== copy) note.textContent = copy
    }
  }
  const observer = new Observer(sync)
  observer.observe(doc.body, { subtree: true, childList: true, characterData: true })
  observer.observe(surface, { attributes: true, attributeFilter: [CODE] })
  sync()
  return () => {
    observer.disconnect()
    for (const [original, note] of mounts) restore(original, note)
    style.remove()
  }
}
