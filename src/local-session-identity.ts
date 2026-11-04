import { SharedReadGroup } from './shared-read-group.js'
import type { DshRemoteHttpRequester } from './dsh-remote/control-plane.js'
import { DshRemoteError } from './dsh-remote/errors.js'

export type SessionIdentity = { runtimeRef: string; sessionRef: string; previousRuntimeRefs: string[] }
const valid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(value)

/** Only authenticated server metadata may join source runtime identities. */
export class LocalSessionIdentity {
  private readonly values = new Map<string, SessionIdentity>()
  private readonly reads = new SharedReadGroup<SessionIdentity>()
  private readonly profileReads = new SharedReadGroup<void>()
  private readonly profiles = new Map<string, string>()
  private profilesExpire = 0
  constructor(private readonly request: DshRemoteHttpRequester) {}
  close(): void { this.reads.clear(); this.profileReads.clear(); this.values.clear(); this.profiles.clear(); this.profilesExpire = 0 }

  /** A scoped Profile survives runtime re-registration. This is source evidence,
   * not permission to merge cloud runtime addresses or claim a journal. */
  async source(identity: SessionIdentity, signal: AbortSignal): Promise<SessionIdentity & { sourceProfileRef?: string }> {
    signal.throwIfAborted()
    if (Date.now() >= this.profilesExpire) await this.profileReads.run('source-profiles', async (shared, current) => {
      const response = await this.request.post('/api/v1/dsh-remote/desktops/list', {}, shared)
      const profiles = new Map<string, string>()
      if (!Array.isArray(response.desktops)) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '实例来源目录无效')
      for (const desktop of response.desktops) {
        if (!desktop || !Array.isArray(desktop.runtimes)) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '实例来源目录无效')
        for (const view of desktop.runtimes) {
          const row = view?.runtime
          if (!valid(row?.runtime_ref) || !valid(row?.profile_ref)) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '实例来源身份无效')
          if (profiles.has(row.runtime_ref) && profiles.get(row.runtime_ref) !== row.profile_ref) throw new DshRemoteError('REMOTE_PROJECTION_CONFLICT', '实例来源身份冲突')
          if (!profiles.has(row.runtime_ref) && profiles.size >= 512) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '实例来源目录超过上限')
          profiles.set(row.runtime_ref, row.profile_ref)
        }
      }
      if (current()) {
        this.profiles.clear(); for (const [runtime, profile] of profiles) this.profiles.set(runtime, profile)
        this.profilesExpire = Date.now() + 30_000
      }
    }, signal)
    signal.throwIfAborted()
    const profile = this.profiles.get(identity.runtimeRef)
    return { ...identity, ...(profile ? { sourceProfileRef: profile } : {}) }
  }
  known(runtime: string, session: string): SessionIdentity | undefined {
    const value = this.values.get(session)
    return value && (value.runtimeRef === runtime || value.previousRuntimeRefs.includes(runtime)) ? value : undefined
  }
  observe(row: Record<string, unknown>): SessionIdentity | undefined {
    if (row.canonical_identity !== true) return
    if (!valid(row.runtime_ref) || !valid(row.session_ref) || row.deduplicated_runtime_refs !== undefined
      && (!Array.isArray(row.deduplicated_runtime_refs) || row.deduplicated_runtime_refs.length > 256 || !row.deduplicated_runtime_refs.every(valid))) {
      throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '会话归并身份无效')
    }
    const value = { runtimeRef: row.runtime_ref, sessionRef: row.session_ref, previousRuntimeRefs: [...new Set(row.deduplicated_runtime_refs as string[] ?? [])] }
    if (!this.values.has(value.sessionRef) && this.values.size >= 512) this.values.delete(this.values.keys().next().value!)
    this.values.set(value.sessionRef, value)
    return value
  }
  resolve(runtime: string, session: string, signal: AbortSignal): Promise<SessionIdentity> {
    signal.throwIfAborted()
    const known = this.known(runtime, session)
    if (known) return Promise.resolve(known)
    return this.reads.run(JSON.stringify([runtime, session]), async shared => {
      const row = await this.request.post('/api/v1/dsh-remote/sessions/metadata', { runtime_ref: runtime, session_ref: session }, shared)
      if (row.session_ref !== session || row.runtime_ref !== runtime && !(Array.isArray(row.deduplicated_runtime_refs) && row.deduplicated_runtime_refs.includes(runtime))) {
        throw new DshRemoteError('REMOTE_PROJECTION_CONFLICT', '会话归并关系与请求不符')
      }
      return this.observe(row) ?? { runtimeRef: runtime, sessionRef: session, previousRuntimeRefs: [] }
    }, signal)
  }
}
