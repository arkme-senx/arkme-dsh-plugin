/** Display history only; it does not authorize or block Host operations. */
export interface SocialAccessSnapshots {
  read(accountKey: string): boolean | null
  write(accountKey: string, allowed: boolean): void
  remove(accountKey: string): void
}

type SnapshotStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Browser origin + environment/user key isolate presentation snapshots. */
export class SocialAccessSnapshotStorage implements SocialAccessSnapshots {
  constructor(private readonly storage: () => SnapshotStorage = () => window.localStorage) {}
  private key(accountKey: string): string { return `arkme.social-access.presentation.v1:${accountKey}` }
  read(accountKey: string): boolean | null {
    try {
      const value = this.storage().getItem(this.key(accountKey))
      return value === 'true' ? true : value === 'false' ? false : null
    } catch { return null }
  }
  write(accountKey: string, allowed: boolean): void {
    try { this.storage().setItem(this.key(accountKey), String(allowed)) } catch { /* best effort display cache */ }
  }
  remove(accountKey: string): void {
    try { this.storage().removeItem(this.key(accountKey)) } catch { /* never block account changes */ }
  }
}
