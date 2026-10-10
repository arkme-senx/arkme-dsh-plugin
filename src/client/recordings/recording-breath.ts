import { useMemo, useSyncExternalStore, type CSSProperties } from 'react'

export const RECORDING_BREATH_PERIOD_MS = 2000

const motionPreference = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined
const reducedMotion = () => motionPreference()?.matches ?? false
const subscribeMotion = (changed: () => void) => {
  const media = motionPreference()
  media?.addEventListener('change', changed)
  return () => media?.removeEventListener('change', changed)
}

/** Align newly mounted hints with the recording's existing visual rhythm. */
export function recordingBreathStyle(startedAt: number, now: number): CSSProperties {
  const elapsed = Number.isFinite(startedAt) && startedAt > 0 ? Math.max(0, now - startedAt) : 0
  return { '--arkme-recording-breath-delay': `${-(elapsed % RECORDING_BREATH_PERIOD_MS)}ms` } as CSSProperties
}

export function useRecordingBreathStyle(active: boolean, startedAt: number): CSSProperties {
  const reduced = useSyncExternalStore(subscribeMotion, reducedMotion, () => false)
  // Keep the delay stable across level/timer updates so CSS animation never restarts.
  // CSS recreates animations after reduced-motion changes; rejoin the capture clock then.
  return useMemo(() => active ? recordingBreathStyle(startedAt, Date.now()) : {}, [active, startedAt, reduced])
}
