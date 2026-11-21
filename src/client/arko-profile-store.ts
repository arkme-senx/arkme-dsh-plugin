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
    for (const listener of [...this.listeners]) {
      // Listeners may come from an embedded harness frame that has since unloaded.
      try { listener() } catch { /* One stale label must not stop the others. */ }
    }
  }
}

const SHARED_STORE_KEY = Symbol.for('arkme.arko-profile-store.v1')

/**
 * The harness UI is a same-origin iframe, and each plugin bundle loaded there carries its own
 * copy of this module. Only the outer Arkme app reads and writes the profile, so every bundle
 * uses the one store kept on the topmost same-origin window: a rename then repaints the labels
 * inside the iframe too.
 */
export function sharedArkoProfileStore(
  win: Window | undefined = typeof window === 'undefined' ? undefined : window,
): ArkmeArkoProfileStore {
  const host = topSameOriginWindow(win) as unknown as Record<symbol, unknown> | undefined
  const existing = host?.[SHARED_STORE_KEY]
  if (isProfileStore(existing)) return existing
  const store = new ArkmeArkoProfileStore()
  if (host !== undefined) host[SHARED_STORE_KEY] = store
  return store
}

function topSameOriginWindow(win: Window | undefined): Window | undefined {
  let host = win
  try {
    while (host !== undefined && host.parent != null && host.parent !== host) {
      void host.parent.document // Throws for a cross-origin parent.
      host = host.parent
    }
  } catch { /* Stop at the last same-origin window. */ }
  return host
}

function isProfileStore(value: unknown): value is ArkmeArkoProfileStore {
  const store = value as Partial<ArkmeArkoProfileStore> | null | undefined
  return typeof store?.getSnapshot === 'function' && typeof store.subscribe === 'function'
    && typeof store.activateUser === 'function' && typeof store.setProfile === 'function'
}

export const arkmeArkoProfileStore = sharedArkoProfileStore()
