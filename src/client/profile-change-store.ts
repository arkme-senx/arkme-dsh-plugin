import { useSyncExternalStore } from 'react'
import type { ArkmeUserProfileSnapshot } from '../types.js'
import { socialAccessStore } from './social-access-store.js'

let revision = 0
const listeners = new Set<() => void>()
export function publishProfileChange(snapshot: ArkmeUserProfileSnapshot): void {
  socialAccessStore.confirmProfile(snapshot)
  revision += 1
  for (const listener of listeners) listener()
}
export function useProfileRevision(): number {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => revision, () => 0)
}
