import { getArkmeLocale, subscribeArkmeLocale, type ArkmeLocale } from './locale.js'

export interface DesktopBrandingBridge {
  schemaVersion: 1
  setLocale(locale: ArkmeLocale): Promise<boolean>
}

/** Presentation only. Harness remains the sole language preference owner. */
export function connectDesktopBranding(bridge: DesktopBrandingBridge | undefined): () => void {
  if (bridge?.schemaVersion !== 1 || typeof bridge.setLocale !== 'function') return () => {}
  let stopped = false
  let running = false
  let pending: ArkmeLocale | undefined
  const drain = async () => {
    if (running) return
    running = true
    try {
      while (!stopped && pending !== undefined) {
        const locale = pending
        pending = undefined
        try { await bridge.setLocale(locale) }
        catch { /* Older/disposed desktop hosts must not break the language UI. */ }
      }
    } finally { running = false }
  }
  const sync = () => { pending = getArkmeLocale(); void drain() }
  const unsubscribe = subscribeArkmeLocale(sync)
  sync()
  return () => { stopped = true; pending = undefined; unsubscribe() }
}
