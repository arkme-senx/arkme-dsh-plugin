import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { securePrivateDirectory, securePrivateFile } from '../private-filesystem.js'
import { DshRemoteError } from './errors.js'

export type DshRemoteSessionOwnershipOrigin =
  | 'existing-at-login'
  | 'observed-while-active'
  | 'remote-create'

export interface DshRemoteSessionOwnership {
  claimUnownedAndListOwned(input: {
    accountId: string
    sessionRefs: readonly string[]
    origin: DshRemoteSessionOwnershipOrigin
    nowMillis?: number
    canClaim?: () => boolean
  }): Promise<Set<string>>
  listOwned(accountId: string, sessionRefs: readonly string[]): Promise<Set<string>>
  ownerAccountId(sessionRef: string): Promise<string | undefined>
}

interface SessionOwnershipEntry {
  ownerAccountId: string
  claimedAtMillis: number
  origin: DshRemoteSessionOwnershipOrigin
}

interface PersistedSessionOwnershipState {
  schemaVersion: 1
  profileRef: string
  sessions: Record<string, SessionOwnershipEntry>
}

function normalizeIdentifier(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized === '' || normalized.length > 512) {
    throw new DshRemoteError('REMOTE_STORAGE_FAILED', `${field} 无效`)
  }
  return normalized
}

/**
 * Local source of truth for immutable DSH Session ownership.
 *
 * Backend projections remain account-scoped, but they never decide ownership:
 * the first logged-in Arkme account that observes an unowned local Session owns
 * it permanently for this DSH Profile.
 */
export class DshRemoteSessionOwnershipStore implements DshRemoteSessionOwnership {
  private readonly path: string
  private state: PersistedSessionOwnershipState | undefined
  private queue: Promise<void> = Promise.resolve()

  constructor(
    directory: string,
    private readonly profileRef: string,
  ) {
    const profileKey = createHash('sha256')
      .update(`dsh-remote-session-ownership-v1\n${profileRef}`)
      .digest('base64url')
    this.path = join(directory, 'dsh-remote', 'session-ownership', `${profileKey}.json`)
  }

  async claimUnownedAndListOwned(input: {
    accountId: string
    sessionRefs: readonly string[]
    origin: DshRemoteSessionOwnershipOrigin
    nowMillis?: number
    canClaim?: () => boolean
  }): Promise<Set<string>> {
    const accountId = normalizeIdentifier(input.accountId, 'Arkme 账号')
    const sessionRefs = [...new Set(input.sessionRefs.map(value => normalizeIdentifier(value, 'DSH Session 引用')))]
    const claimedAtMillis = input.nowMillis ?? Date.now()
    if (!Number.isSafeInteger(claimedAtMillis) || claimedAtMillis <= 0) {
      throw new DshRemoteError('REMOTE_STORAGE_FAILED', 'Session 归属时间无效')
    }
    const owned = new Set<string>()
    await this.serial(async () => {
      const state = await this.load()
      const canClaim = input.canClaim?.() ?? true
      let changed = false
      for (const sessionRef of sessionRefs) {
        const current = state.sessions[sessionRef]
        if (current === undefined && canClaim) {
          state.sessions[sessionRef] = {
            ownerAccountId: accountId,
            claimedAtMillis,
            origin: input.origin,
          }
          changed = true
          owned.add(sessionRef)
        } else if (current?.ownerAccountId === accountId) {
          owned.add(sessionRef)
        }
      }
      if (changed) await this.persist(state)
    })
    return owned
  }

  async listOwned(accountIdValue: string, sessionRefs: readonly string[]): Promise<Set<string>> {
    const accountId = normalizeIdentifier(accountIdValue, 'Arkme 账号')
    const normalizedRefs = [...new Set(sessionRefs.map(value => normalizeIdentifier(value, 'DSH Session 引用')))]
    const owned = new Set<string>()
    await this.serial(async () => {
      const state = await this.load()
      for (const sessionRef of normalizedRefs) {
        if (state.sessions[sessionRef]?.ownerAccountId === accountId) owned.add(sessionRef)
      }
    })
    return owned
  }

  async ownerAccountId(sessionRefValue: string): Promise<string | undefined> {
    const sessionRef = normalizeIdentifier(sessionRefValue, 'DSH Session 引用')
    let owner: string | undefined
    await this.serial(async () => { owner = (await this.load()).sessions[sessionRef]?.ownerAccountId })
    return owner
  }

  private async serial(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work, work)
    this.queue = next.then(() => undefined, () => undefined)
    await next
  }

  private async load(): Promise<PersistedSessionOwnershipState> {
    if (this.state !== undefined) return this.state
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8')) as Record<string, unknown>
      if (raw.schemaVersion !== 1 || raw.profileRef !== this.profileRef
        || raw.sessions === null || typeof raw.sessions !== 'object' || Array.isArray(raw.sessions)) {
        throw new Error('schema mismatch')
      }
      const sessions: Record<string, SessionOwnershipEntry> = {}
      for (const [sessionRef, value] of Object.entries(raw.sessions as Record<string, unknown>)) {
        normalizeIdentifier(sessionRef, 'DSH Session 引用')
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('entry schema mismatch')
        const entry = value as Record<string, unknown>
        const ownerAccountId = typeof entry.ownerAccountId === 'string'
          ? normalizeIdentifier(entry.ownerAccountId, 'Arkme 账号')
          : ''
        if (ownerAccountId === '' || !Number.isSafeInteger(entry.claimedAtMillis) || Number(entry.claimedAtMillis) <= 0
          || !['existing-at-login', 'observed-while-active', 'remote-create'].includes(String(entry.origin))) {
          throw new Error('entry schema mismatch')
        }
        sessions[sessionRef] = {
          ownerAccountId,
          claimedAtMillis: Number(entry.claimedAtMillis),
          origin: entry.origin as DshRemoteSessionOwnershipOrigin,
        }
      }
      this.state = { schemaVersion: 1, profileRef: this.profileRef, sessions }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new DshRemoteError('REMOTE_STORAGE_FAILED', 'DSH Session 账号归属状态已损坏', false, {}, { cause: error })
      }
      this.state = { schemaVersion: 1, profileRef: this.profileRef, sessions: {} }
    }
    return this.state
  }

  private async persist(state: PersistedSessionOwnershipState): Promise<void> {
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await securePrivateDirectory(directory)
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 })
    await securePrivateFile(temporary)
    await rename(temporary, this.path)
    await securePrivateFile(this.path)
    this.state = state
  }
}
