import { HARNESS_ACTIVITY_ATTRIBUTE, parseHarnessActivity } from './harness-activity.js'

/** Use the mounted native action, so workspace inheritance and blank-session reuse stay host-owned. */
export function startEmbeddedHarnessSession(activate: () => void, doc: Document = document): void {
  const surface = doc.querySelector<HTMLElement>('[data-arkme-owned="deepseek-harness-surface"][data-arkme-account-id]')
  const frame = surface?.querySelector('iframe')
  const native = frame?.contentDocument
  const sidebar = native?.querySelector('[data-slot="sidebar"]')
  const button = sidebar?.querySelector<HTMLButtonElement>('button[data-arkme-session-create]')
    ?? [...(sidebar?.querySelectorAll<HTMLButtonElement>('button[aria-label]') ?? [])]
      .find(item => ['新建会话', 'new session'].includes(item.getAttribute('aria-label')?.trim().toLowerCase() ?? ''))
  if (!surface || !native || !button || button.disabled) throw new Error('DSH 尚未准备好，请稍后再试')
  const selection = () => parseHarnessActivity(surface.getAttribute(HARNESS_ACTIVITY_ATTRIBUTE), surface.getAttribute('data-arkme-account-scope') ?? undefined)
  const previous = selection()?.current
  button.click()
  activate()

  const win = doc.defaultView
  if (!win) return
  const account = surface.getAttribute('data-arkme-account-id')
  let stopped = false
  let raf = 0
  const stop = () => {
    stopped = true
    observer.disconnect()
    win.clearTimeout(timeout)
    win.cancelAnimationFrame(raf)
    doc.removeEventListener('pointerdown', stop, true)
    native.removeEventListener('pointerdown', stop, true)
  }
  const focus = () => {
    if (stopped || !surface.isConnected || surface.getAttribute('data-arkme-account-id') !== account) { stop(); return }
    if (surface.getAttribute('data-arkme-visible') !== 'true') return
    // Workspace creation can be asynchronous: never focus the old conversation during that gap.
    if (previous && previous.title !== '新会话') {
      const current = selection()?.current
      if (current === undefined || current?.id === previous.id) return
    }
    const input = [...native.querySelectorAll<HTMLElement>('[data-composer-card] textarea:not(:disabled), [data-composer-card] [contenteditable="true"][role="textbox"]')].find(item => item.getClientRects().length > 0)
    if (input) { input.focus({ preventScroll: true }); stop() }
  }
  const schedule = () => { win.cancelAnimationFrame(raf); raf = win.requestAnimationFrame(focus) }
  const observer = new MutationObserver(schedule)
  observer.observe(native.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable', 'disabled'] })
  observer.observe(surface, { attributes: true, attributeFilter: ['data-arkme-visible', 'data-arkme-account-id', HARNESS_ACTIVITY_ATTRIBUTE] })
  const timeout = win.setTimeout(stop, 2000)
  doc.addEventListener('pointerdown', stop, true)
  native.addEventListener('pointerdown', stop, true)
  schedule()
}
