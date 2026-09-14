type DesktopHarnessReadinessWindow = {
  arkmeDesktop?: {
    notifyHarnessReady?: () => void
  }
}

const notifiedWindows = new WeakSet<object>()

/** Notify the trusted desktop preload after Arkme's required local client services are registered. */
export function notifyDesktopHarnessReady(
  target: DesktopHarnessReadinessWindow | undefined = typeof window === 'undefined' ? undefined : window,
): boolean {
  if (target === undefined || notifiedWindows.has(target)) return target !== undefined && notifiedWindows.has(target)
  const notify = target.arkmeDesktop?.notifyHarnessReady
  if (typeof notify !== 'function') return false
  notify.call(target.arkmeDesktop)
  notifiedWindows.add(target)
  return true
}

/** Signal readiness after React has committed the locally registered Arkme shell. */
export function DesktopHarnessReadinessCommit(): null {
  useLayoutEffect(() => { notifyDesktopHarnessReady() }, [])
  return null
}
import { useLayoutEffect } from 'react'
