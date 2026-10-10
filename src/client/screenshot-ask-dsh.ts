import { arkmeAuthStore } from './auth-store.js'
import { HARNESS_ATTACHMENT_DRAFT_KEY, type HarnessDraftWindow } from './harness-attachment-draft.js'
import { decodeScreenshotBase64, nativeScreenshotBridge, type ScreenshotAskRequest } from './native-screenshot.js'
import { arkmeUi } from './ui-controller.js'

/** Runs only in the main window, where the existing DSH attachment draft bridge lives. */
export function bindScreenshotAskDsh(): () => void {
  const native = nativeScreenshotBridge()
  if (!native?.onAskDsh || !native.askDshResult || !native.onAskDshCancel || !native.onAskDshActivate) return () => {}
  const pending = new Map<string, { controller: AbortController; dispose(): void; activate?: () => void }>()
  const cancel = ({ requestId }: { requestId: string }) => {
    const entry = pending.get(requestId)
    entry?.controller.abort(); entry?.dispose()
  }
  const run = async (request: ScreenshotAskRequest) => {
    if (pending.has(request.requestId)) return
    const controller = new AbortController()
    const signal = controller.signal
    let stopAuth = () => {}
    const timer = setTimeout(() => cancel(request), 180_000)
    const entry: { controller: AbortController; dispose(): void; activate?: () => void } = {
      controller,
      dispose() { clearTimeout(timer); stopAuth(); pending.delete(request.requestId) },
    }
    pending.set(request.requestId, entry)
    try {
      const auth = { ...arkmeAuthStore.getSnapshot().auth }
      if (auth?.status !== 'authenticated' || !auth.userId) throw new Error('请先登录')
      const surface = [...document.querySelectorAll<HTMLElement>('[data-arkme-owned="deepseek-harness-surface"]:not([data-arkme-active="false"])')]
        .find(element => element.getAttribute('data-arkme-account-id') === String(auth.userId))
      const frame = surface?.querySelector('iframe')
      const bridge = (frame?.contentWindow as HarnessDraftWindow | null)?.[HARNESS_ATTACHMENT_DRAFT_KEY]
      if (!bridge) throw new Error('DSH 尚未就绪或当前版本不支持附件草稿，请升级客户端后重试')
      const scope = surface?.getAttribute('data-arkme-account-scope')
      const sameAccount = () => {
        const current = arkmeAuthStore.getSnapshot().auth
        return current?.status === auth.status && current?.userId === auth.userId && current?.environment === auth.environment
          && surface?.isConnected && surface.getAttribute('data-arkme-account-scope') === scope
      }
      stopAuth = arkmeAuthStore.subscribe(() => { if (!sameAccount()) cancel(request) })
      const file = new File([decodeScreenshotBase64(request.contentBase64)], request.fileName, { type: 'image/png' })
      await bridge.prepare({ operationId: request.operationId, files: [file], signal, progress: () => {} })
      signal.throwIfAborted()
      if (!sameAccount()) throw new Error('账号已切换，请重试')
      // Native closes the screenshot editor before allowing the main window to navigate.
      entry.activate = () => {
        if (signal.aborted || !sameAccount()) return
        arkmeUi.showHarness()
        requestAnimationFrame(() => {
          if (signal.aborted || !sameAccount()) return
          frame?.contentWindow?.focus()
          frame?.contentDocument?.querySelector<HTMLElement>('[data-composer-card] [contenteditable="true"][role="textbox"], [data-composer-card] textarea:not(:disabled)')?.focus({ preventScroll: true })
        })
      }
      if (!await native.askDshResult!({ requestId: request.requestId, ok: true })) cancel(request)
    } catch (error) {
      if (!signal.aborted) await native.askDshResult!({ requestId: request.requestId, ok: false, error: error instanceof Error ? error.message : '附件准备失败，请重试' }).catch(() => {})
      entry.dispose()
    }
  }
  const offRequest = native.onAskDsh(request => { void run(request) })
  const offCancel = native.onAskDshCancel(cancel)
  const offActivate = native.onAskDshActivate(({ requestId }) => {
    const entry = pending.get(requestId)
    try { entry?.activate?.() } finally { entry?.dispose() }
  })
  return () => { offRequest(); offCancel(); offActivate(); for (const requestId of pending.keys()) cancel({ requestId }) }
}
