import type { ArkmeArkoProfile } from '../types.js'

export const ARKO_DEFAULT_DISPLAY_NAME = 'Arko'

export interface ArkmeArkoProfileStoreSnapshot {
  revision: number
  userId?: number
  profile?: ArkmeArkoProfile
}

export function arkoPresentationName(
  profile: ArkmeArkoProfile | undefined,
  fallback = ARKO_DEFAULT_DISPLAY_NAME,
): string {
  const displayName = profile?.displayName.trim() ?? ''
  if (displayName !== '') {
    return profile?.version === 0 && displayName === 'Agent'
      ? ARKO_DEFAULT_DISPLAY_NAME
      : displayName
  }
  return fallback.trim() || ARKO_DEFAULT_DISPLAY_NAME
}

export class ArkmeArkoProfileStore {
  private snapshot: ArkmeArkoProfileStoreSnapshot = { revision: 0 }
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): ArkmeArkoProfileStoreSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  activateUser(userId: number | undefined): void {
    const normalizedUserId = userId !== undefined && Number.isSafeInteger(userId) && userId > 0
      ? userId
      : undefined
    if (this.snapshot.userId === normalizedUserId) return
    this.publish({ revision: this.snapshot.revision + 1, ...(normalizedUserId === undefined ? {} : { userId: normalizedUserId }) })
  }

  setProfile(userId: number, profile: ArkmeArkoProfile): void {
    if (!Number.isSafeInteger(userId) || userId <= 0 || this.snapshot.userId !== userId) return
    const current = this.snapshot.profile
    if (current !== undefined && profile.version <= current.version) return
    this.publish({
      revision: this.snapshot.revision + 1,
      userId,
      profile: { ...profile },
    })
  }

  private publish(next: ArkmeArkoProfileStoreSnapshot): void {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

export const arkmeArkoProfileStore = new ArkmeArkoProfileStore()
