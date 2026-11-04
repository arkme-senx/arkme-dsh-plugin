import { SharedReadGroup } from './shared-read-group.js'
import type { DshRemoteHttpRequester } from './dsh-remote/control-plane.js'
import { DshRemoteError } from './dsh-remote/errors.js'

export type SessionIdentity = { runtimeRef: string; sessionRef: string; previousRuntimeRefs: string[] }
const valid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(value)

/** Only authenticated server metadata may join source runtime identities. */
export class LocalSessionIdentity {
  private readonly values = new Map<string, SessionIdentity>()
  private readonly reads = new SharedReadGroup<SessionIdentity>()
  constructor(private readonly request: DshRemoteHttpRequester) {}
  close(): void { this.reads.clear(); this.values.clear() }
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
