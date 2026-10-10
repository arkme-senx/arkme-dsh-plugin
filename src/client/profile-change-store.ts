import { useSyncExternalStore } from 'react'
import type { ArkmeUserProfileSnapshot } from '../types.js'

let revision = 0
const listeners = new Set<() => void>()
export function publishProfileChange(_snapshot: ArkmeUserProfileSnapshot): void {
  revision += 1
  for (const listener of listeners) listener()
}
export function useProfileRevision(): number {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => revision, () => 0)
}
