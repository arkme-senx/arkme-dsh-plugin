import { useMemo, useSyncExternalStore } from 'react'
import { HARNESS_ACTIVITY_ATTRIBUTE, HARNESS_ACTIVITY_EVENT, parseHarnessActivity, type HarnessActivity } from './harness-activity.js'

const subscribe = (listener: () => void) => {
  if (typeof document === 'undefined') return () => {}
  document.addEventListener(HARNESS_ACTIVITY_EVENT, listener)
  return () => document.removeEventListener(HARNESS_ACTIVITY_EVENT, listener)
}
export function useHarnessActivity(scope: string | undefined): HarnessActivity | undefined {
  const read = useMemo(() => {
    let cachedRaw: string | null = null
    let cachedValue: HarnessActivity | undefined
    return () => {
      const raw = typeof document === 'undefined' ? null : document.querySelector('[data-arkme-owned="deepseek-harness-surface"]')?.getAttribute(HARNESS_ACTIVITY_ATTRIBUTE) ?? null
      if (raw !== cachedRaw) { cachedRaw = raw; cachedValue = parseHarnessActivity(raw, scope) }
      return cachedValue
    }
  }, [scope])
  return useSyncExternalStore(subscribe, read, () => undefined)
}
