import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

const CONTENT_ACCESS_PROTECTED = 2
const TOPIC_PRIVACY_PRIVATE = 2
const PRIVACY_SNAPSHOT_LIMIT = 100
const PRIVACY_SNAPSHOT_MAX_PAGES = 100
const PRIVACY_SNAPSHOT_TTL_MS = 30_000

interface PrivacySnapshotCacheEntry {
  lockedRecordUids: ReadonlySet<string>
  expiresAtMillis: number
}

function integerLikeValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return 0
}

/** A protected record must never be projected by the plugin, even if an upstream filter regresses. */
export function arkmePrivacyLockedRecord(raw: unknown): boolean {
  const item = objectValue(raw)
  const core = objectValue(item.record_core)
  const extra = objectValue(core.extra ?? item.extra)
  const accessState = core.content_access_state ?? core.contentAccessState
    ?? item.content_access_state ?? item.contentAccessState
    ?? extra.content_access_state ?? extra.contentAccessState
  return integerLikeValue(accessState) === CONTENT_ACCESS_PROTECTED
}

/** Topic list requests are public-only; retain this guard for stale or malformed responses. */
export function arkmePrivacyLockedTopic(raw: unknown): boolean {
  const item = objectValue(raw)
  const core = objectValue(item.topic_core ?? item)
  return integerLikeValue(core.privacy_state ?? core.privacyState) === TOPIC_PRIVACY_PRIVATE
}

/** Mirrors the mobile visibility snapshot: it returns only privacy metadata, never record content. */
export class ArkmePrivacyVisibilityService {
  private readonly cache = new Map<number, PrivacySnapshotCacheEntry>()
  private readonly inFlight = new Map<number, Promise<ReadonlySet<string>>>()

  constructor(private readonly runtime: ServiceRuntime) {}

  async lockedRecordUids(session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<ReadonlySet<string>> {
    const cached = this.cache.get(session.userId)
    if (cached !== undefined && cached.expiresAtMillis > Date.now()) return cached.lockedRecordUids
    const existing = this.inFlight.get(session.userId)
    if (existing !== undefined) return await existing
    const request = this.loadLockedRecordUids(session, signal).finally(() => { this.inFlight.delete(session.userId) })
    this.inFlight.set(session.userId, request)
    return await request
  }

  clear(userId?: number): void {
    if (userId === undefined) this.cache.clear()
    else this.cache.delete(userId)
  }

  private async loadLockedRecordUids(session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<ReadonlySet<string>> {
    const locked = new Set<string>()
    let cursorUpdateAt: number | undefined
    let cursorRecordUid: string | undefined
    let complete = false
    for (let page = 0; page < PRIVACY_SNAPSHOT_MAX_PAGES; page += 1) {
      const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
        '/api/v1/records/privacy/visibility-snapshot',
        {
          limit: PRIVACY_SNAPSHOT_LIMIT,
          ...(cursorUpdateAt === undefined ? {} : { cursor_update_at: cursorUpdateAt }),
          ...(cursorRecordUid === undefined ? {} : { cursor_record_uid: cursorRecordUid }),
        },
        session,
        signal,
      )
      for (const raw of Array.isArray(data.items) ? data.items : []) {
        const item = objectValue(raw)
        const recordUid = stringValue(item.record_uid).trim()
        if (recordUid === '') continue
        if (integerLikeValue(item.lock_state) === 1 || integerLikeValue(item.content_access_state) === CONTENT_ACCESS_PROTECTED) {
          locked.add(recordUid)
        }
      }
      if (data.has_more !== true) {
        complete = true
        break
      }
      const nextUpdateAt = integerLikeValue(data.next_update_at)
      const nextRecordUid = stringValue(data.next_record_uid).trim()
      if (nextUpdateAt <= 0 || nextRecordUid === '') {
        throw new ArkmePluginError('privacy-visibility-snapshot-invalid', '隐私锁快记状态不完整，已停止显示快记', true, 502)
      }
      cursorUpdateAt = nextUpdateAt
      cursorRecordUid = nextRecordUid
    }
    if (!complete) {
      throw new ArkmePluginError('privacy-visibility-snapshot-incomplete', '隐私锁快记过多，已停止显示快记', true, 502)
    }
    const immutable = new Set(locked)
    this.cache.set(session.userId, { lockedRecordUids: immutable, expiresAtMillis: Date.now() + PRIVACY_SNAPSHOT_TTL_MS })
    return immutable
  }
}
