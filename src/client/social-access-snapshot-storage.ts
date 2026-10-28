export interface SocialAccessConfirmation { allowed: boolean; checkedAtMillis: number }

/** UI preflight history only; it never grants Host/server permissions. */
export interface SocialAccessSnapshots {
  read(accountKey: string): boolean | null
  readConfirmation?(accountKey: string): SocialAccessConfirmation | null
  write(accountKey: string, allowed: boolean, checkedAtMillis?: number): void
  remove(accountKey: string): void
}

type SnapshotStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Browser origin + environment/user key isolate presentation snapshots. */
export class SocialAccessSnapshotStorage implements SocialAccessSnapshots {
  constructor(private readonly storage: () => SnapshotStorage = () => window.localStorage) {}
  private key(accountKey: string): string { return `arkme.social-access.presentation.v1:${accountKey}` }
  read(accountKey: string): boolean | null {
    return this.readConfirmation(accountKey)?.allowed ?? null
  }
  readConfirmation(accountKey: string): SocialAccessConfirmation | null {
    try {
      const value = this.storage().getItem(this.key(accountKey))
      // Existing confirmations remain usable, but have no freshness evidence.
      if (value === 'true' || value === 'false') return { allowed: value === 'true', checkedAtMillis: 0 }
      const parsed: unknown = value === null ? null : JSON.parse(value)
      if (parsed === null || typeof parsed !== 'object') return null
      const entry = parsed as Partial<SocialAccessConfirmation>
      return typeof entry.allowed === 'boolean' && typeof entry.checkedAtMillis === 'number'
        && Number.isFinite(entry.checkedAtMillis) && entry.checkedAtMillis >= 0
        ? { allowed: entry.allowed, checkedAtMillis: entry.checkedAtMillis } : null
    } catch { return null }
  }
  write(accountKey: string, allowed: boolean, checkedAtMillis = Date.now()): void {
    try { this.storage().setItem(this.key(accountKey), JSON.stringify({ allowed, checkedAtMillis })) } catch { /* best effort UI cache */ }
  }
  remove(accountKey: string): void {
    try { this.storage().removeItem(this.key(accountKey)) } catch { /* never block account changes */ }
  }
}
