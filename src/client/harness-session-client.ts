import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'

export const inject = ['sessions']
const REFRESH_MS = 10_000

/** The iframe reads selection through the public DSH store; Arkme owns visibility. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const surface = window.frameElement?.parentElement
    if (surface?.getAttribute('data-arkme-owned') !== 'deepseek-harness-surface') return () => undefined
    const apiPath = document.querySelector<HTMLMetaElement>('meta[name="arkme-session-api"]')?.content
    if (apiPath === undefined || !/^\/[A-Za-z0-9/_-]+$/.test(apiPath)) return () => undefined
    const sessions = (ctx as unknown as { sessions?: ISessions }).sessions
    if (sessions === undefined) return () => undefined
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
