import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

import { HARNESS_SESSION_NAVIGATION_KEY, type HarnessSessionWindow } from '../harness-embed-contract.js'
import { observeHarnessSessionSelection, type DesktopSessionSelectionBridge } from './harness-session-selection.js'

export const inject = ['sessions', 'remote', 'remote.session']
const REFRESH_MS = 10_000

/** The iframe reads selection through the public DSH store; Arkme owns visibility. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const surface = window.frameElement?.parentElement
    if (surface?.getAttribute('data-arkme-owned') !== 'deepseek-harness-surface') return () => undefined
    const apiPath = document.querySelector<HTMLMetaElement>('meta[name="arkme-session-api"]')?.content
    const sessions = (ctx as unknown as { sessions?: ISessions }).sessions
    if (sessions === undefined) return () => undefined
    // The same-origin parent preload owns the account-scoped IPC lease. The native
    // iframe has no Node access and must not select a storage path or account itself.
    const parent = window.parent as (Window & { arkmeDesktop?: { sessionSelection?: DesktopSessionSelectionBridge } }) | undefined
    const stopPersistence = observeHarnessSessionSelection(sessions, parent?.arkmeDesktop?.sessionSelection)
    const frameWindow = window as HarnessSessionWindow
    const navigation = { async has(sessionId: string) {
      if (!/^[A-Za-z0-9_.:-]{1,256}$/.test(sessionId)) throw new Error('DSH 对话标识无效')
      const remote = (ctx as unknown as { remote?: { session?: { list?: (request: object) => Promise<{
        ok: boolean; value?: { items: Array<{ sessionId: string }> }; error?: { message?: string }
      }> } } }).remote?.session
      if (typeof remote?.list !== 'function') throw new Error('当前 DSH 版本无法核验本机会话')
      // refresh() can resolve after a failed pull; only the Remote result proves absence.
      const result = await remote.list({})
      if (!result.ok) throw new Error(result.error?.message || '本机会话列表读取失败，请稍后重试')
      if (!Array.isArray(result.value?.items)) throw new Error('本机会话列表响应不完整')
      if (!result.value.items.some(item => item.sessionId === sessionId)) return false
      const refreshable = sessions as ISessions & { refresh?: () => Promise<void> }
      if (sessions.list.getSnapshot().byId[sessionId as SessionId] === undefined) {
        if (typeof refreshable.refresh !== 'function') throw new Error('本机会话列表尚未就绪，请稍后重试')
        await refreshable.refresh()
      }
      if (sessions.list.getSnapshot().byId[sessionId as SessionId] === undefined) throw new Error('本机会话列表尚未就绪，请稍后重试')
      return true
    }, open(sessionId: string) {
      if (typeof sessionId !== 'string' || sessionId.trim() === '') throw new Error('DSH 对话标识无效')
      if (typeof sessions.open !== 'function') throw new Error('当前 DSH 版本暂不支持打开任务')
      sessions.open(sessionId as SessionId)
    } }
    frameWindow[HARNESS_SESSION_NAVIGATION_KEY] = navigation
    const disposeNavigation = () => {
      stopPersistence()
      if (frameWindow[HARNESS_SESSION_NAVIGATION_KEY] === navigation) delete frameWindow[HARNESS_SESSION_NAVIGATION_KEY]
    }
    if (apiPath === undefined || !/^\/[A-Za-z0-9/_-]+$/.test(apiPath)) return disposeNavigation
    const windowRef = crypto.randomUUID()
    let revision = 0
    let stopped = false
    let busy = false
    let dirty = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let fingerprint = ''
    let renew = false
    let controller: AbortController | undefined
    const report = async (): Promise<void> => {
      if (stopped) return
      if (busy) { dirty = true; return }
      busy = true
      if (timer !== undefined) clearTimeout(timer)
      do {
        dirty = false
        const accountId = surface.getAttribute('data-arkme-account-id') ?? ''
        const current = sessions.list.getSnapshot().current
        const sessionRef = surface.getAttribute('data-arkme-follow-session') === 'true'
          ? current ?? null : null
        renew = accountId !== '' && sessionRef !== null
        fingerprint = JSON.stringify([accountId, sessionRef])
        if (accountId !== '') {
          controller = new AbortController()
          const deadline = setTimeout(() => { controller?.abort() }, 2_000)
          try {
            await fetch(apiPath, {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ operation: 'remote.reportCurrentSession', params: {
                accountId, windowRef, revision: ++revision, sessionRef,
              } }), signal: controller.signal,
            })
          } catch { /* Selection hints must not affect desktop interaction. */ }
          finally { clearTimeout(deadline) }
        }
      } while (dirty && !stopped)
      busy = false
      if (!stopped && renew) timer = setTimeout(() => { void report() }, REFRESH_MS)
    }
    const changed = () => {
      const accountId = surface.getAttribute('data-arkme-account-id') ?? ''
      const current = surface.getAttribute('data-arkme-follow-session') === 'true'
        ? sessions.list.getSnapshot().current ?? null : null
      if (JSON.stringify([accountId, current]) !== fingerprint) void report()
    }
    const clearSelection = () => {
      controller?.abort()
      if (timer !== undefined) clearTimeout(timer)
      dirty = false
      renew = false
      const accountId = surface.getAttribute('data-arkme-account-id') ?? ''
      fingerprint = JSON.stringify([accountId, null])
      if (accountId === '') return
      try {
        navigator.sendBeacon(apiPath, new Blob([JSON.stringify({
          operation: 'remote.reportCurrentSession', params: {
            accountId, windowRef, revision: ++revision, sessionRef: null,
          },
        })], { type: 'application/json' }))
      } catch { /* A crash or unavailable beacon is bounded by the Host lease. */ }
    }
    const observer = new MutationObserver(changed)
    observer.observe(surface, { attributes: true, attributeFilter: ['data-arkme-follow-session', 'data-arkme-account-id'] })
    const unsubscribe = sessions.list.subscribe(changed)
    document.addEventListener('visibilitychange', changed)
    window.addEventListener('pagehide', clearSelection)
    window.addEventListener('pageshow', changed)
    void report()
    return () => {
      disposeNavigation()
      stopped = true
      clearSelection()
      observer.disconnect()
      unsubscribe()
      document.removeEventListener('visibilitychange', changed)
      window.removeEventListener('pagehide', clearSelection)
      window.removeEventListener('pageshow', changed)
    }
  }, 'arkme: visible desktop DSH session')
}
