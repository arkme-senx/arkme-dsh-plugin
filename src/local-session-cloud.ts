import type { LocalSessionOwnership } from './local-session-ownership.js'
import type { DshRemoteHttpRequester } from './dsh-remote/control-plane.js'
import type { DshRemoteSessionOwnership } from './dsh-remote/session-ownership-store.js'
import { DshRemoteError } from './dsh-remote/errors.js'
import { createHash } from 'node:crypto'
import { parseDshDirectoryDelta, type DshDirectorySession } from './dsh-remote/account-session-directory.js'

type Json = Record<string, unknown>
const BASE = '/api/v1/dsh-remote'

/** Keep the first cloud address while the actual Host changes. The existing
 * outboxes still own retries and payloads; this adapter owns only addressing. */
export class LocalSessionCloud implements DshRemoteHttpRequester, DshRemoteSessionOwnership {
  private runtime: { ref: string; generation: number } | undefined
  private readonly claims = new Map<string, { key: string; generation: number }>()
  private readonly snapshots = new Map<string, number>()
  private readonly metadata = new Map<string, string>()

  constructor(private readonly options: {
    ownership: LocalSessionOwnership
    instance: string
    accountId: string
    request: DshRemoteHttpRequester
  }) {}

  async ownerAccountId(id: string): Promise<string | undefined> {
    return this.options.ownership.address(id) ? this.options.accountId : undefined
  }

  async listOwned(accountId: string, ids: readonly string[]): Promise<Set<string>> {
    if (accountId !== this.options.accountId) return new Set()
    return new Set(ids.filter(id => this.ownsSession(id)))
  }

  ownsSession(id: string): boolean {
    const owner = this.options.ownership.read(id)
    return owner ? owner.owner === this.options.instance && owner.phase === 'active'
      : this.runtime !== undefined && this.options.ownership.address(id) === this.runtime.ref
  }

  async claimUnownedAndListOwned(input: Parameters<DshRemoteSessionOwnership['claimUnownedAndListOwned']>[0]): Promise<Set<string>> {
    if (input.accountId !== this.options.accountId) throw new Error('会话账号不匹配')
    if (this.runtime && (input.canClaim?.() ?? true)) {
      for (const id of input.sessionRefs) {
        const owner = this.options.ownership.read(id)
        if (!owner || owner.owner === this.options.instance && owner.phase === 'active') this.options.ownership.bindAddress(id, this.runtime.ref)
      }
    }
    return this.listOwned(input.accountId, input.sessionRefs)
  }

  private check(id: string): { runtime: string; epoch?: number } {
    if (!this.runtime) throw new DshRemoteError('HOST_CHANNEL_NOT_READY', '会话同步尚未就绪', true)
    const owner = this.options.ownership.read(id)
    if (owner && (owner.owner !== this.options.instance || owner.phase !== 'active')) {
      throw new DshRemoteError('SESSION_STATE_CHANGED', '会话执行权已改变', true)
    }
    const runtime = this.options.ownership.bindAddress(id, this.runtime.ref)
    if (!owner && runtime !== this.runtime.ref) {
      throw new DshRemoteError('SESSION_STATE_CHANGED', '会话执行权已改变', true)
    }
    return { runtime, ...(owner ? { epoch: owner.epoch } : {}) }
  }

  private async address(id: string, signal?: AbortSignal): Promise<Json> {
    const owner = this.check(id)
    if (owner.epoch === undefined) return { runtime_ref: owner.runtime, host_generation: this.runtime!.generation }
    const execution = { runtime_ref: this.runtime!.ref, host_generation: this.runtime!.generation, owner_epoch: owner.epoch }
    const key = `${execution.runtime_ref}/${execution.host_generation}/${owner.epoch}`
    let claim = this.claims.get(id)
    if (claim?.key !== key) {
      const result = await this.options.request.post(`${BASE}/sessions/claim-execution`, { runtime_ref: owner.runtime, session_ref: id, execution }, signal)
      if (!Number.isSafeInteger(result.host_generation) || Number(result.host_generation) < 1) throw new Error('会话执行权响应无效')
      if (this.check(id).epoch !== owner.epoch) throw new DshRemoteError('SESSION_STATE_CHANGED', '会话执行权已改变', true)
      claim = { key, generation: Number(result.host_generation) }
      // A cache miss is harmless: the claim endpoint is idempotent.
      if (this.claims.size >= 1024) this.claims.clear()
      this.claims.set(id, claim)
    }
    return { runtime_ref: owner.runtime, host_generation: claim.generation, execution }
  }

  async publishExecution(id: string, signal: AbortSignal): Promise<void> {
    await this.address(id, signal)
  }

  async post(path: string, body: Json, signal?: AbortSignal): Promise<Json> {
    if (path.endsWith('/runtimes/register')) {
      const result = await this.options.request.post(path, body, signal)
      if (typeof result.runtime_ref !== 'string' || !Number.isSafeInteger(result.host_generation)) throw new Error('实例注册响应无效')
      this.runtime = { ref: result.runtime_ref, generation: Number(result.host_generation) }
      this.claims.clear(); this.snapshots.clear(); this.metadata.clear()
      return result
    }
    if (path === `${BASE}/sessions/sync`) {
      const items = body.items as Json[]
      const legacy: Json[] = []
      const sessions: DshDirectorySession[] = []
      let complete = true
      const accepted = (result: Json, runtime: string, requested: Json[]) => {
        const delta = parseDshDirectoryDelta({ version: 1, sessions: result.sessions })
        const refs = new Set(requested.map(item => String(item.session_ref)))
        if (!delta || delta.sessions.length !== refs.size || delta.sessions.some(row => row.runtime_ref !== runtime || !refs.has(row.session_ref))) complete = false
        else sessions.push(...delta.sessions)
      }
      for (const item of items) {
        // Keep full-observation semantics when managed rows become deltas.
        // Absence in one Host is never an explicit canonical deletion.
        if (body.snapshot_ref && item.deleted === true) continue
        const id = String(item.session_ref)
        if (!(await this.listOwned(this.options.accountId, [id])).has(id)) continue
        const owner = this.check(id)
        if (owner.epoch === undefined) {
          legacy.push(item)
          continue
        }
        // The legacy Host takes full snapshots. Managed rows use deltas, so
        // don't turn every refresh into N network writes for unchanged rows.
        const { projection_at: _revision, ...semantic } = item
        const fingerprint = createHash('sha256').update(JSON.stringify([this.runtime, owner, semantic])).digest('hex')
        if (this.metadata.get(id) === fingerprint) continue
        let address: Json | undefined
        try { address = await this.address(id, signal) }
        catch (error) {
          // Handoff can precede first publication. The backend verifies the
          // current executor and the canonical address share one desktop.
          if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'REMOTE_NOT_FOUND') throw error
          const result = await this.options.request.post(path, { ...body, runtime_ref: owner.runtime, snapshot_ref: '', items: [item],
            execution: { runtime_ref: this.runtime!.ref, host_generation: this.runtime!.generation, owner_epoch: owner.epoch },
          }, signal)
          accepted(result, owner.runtime, [item])
          // Successful managed sync already stores the writer and metadata.
          // The next real write can resolve its canonical generation on demand.
          if (this.check(id).epoch !== owner.epoch) throw new DshRemoteError('SESSION_STATE_CHANGED', '会话执行权已改变', true)
        }
        if (address) accepted(await this.options.request.post(path, { ...body, ...address, snapshot_ref: '', items: [item] }, signal), owner.runtime, [item])
        if (this.metadata.size >= 10000 && !this.metadata.has(id)) this.metadata.clear()
        this.metadata.set(id, fingerprint)
      }
      // Unclaimed rows retain the same runtime/generation and native batch contract.
      if (legacy.length) accepted(await this.options.request.post(path, { ...body, items: legacy }, signal), String(body.runtime_ref), legacy)
      if (typeof body.snapshot_ref === 'string' && body.snapshot_ref !== '') {
        if (this.snapshots.size >= 16 && !this.snapshots.has(body.snapshot_ref)) throw new Error('会话目录同步过多')
        this.snapshots.set(body.snapshot_ref, (this.snapshots.get(body.snapshot_ref) ?? 0) + legacy.filter(item => item.deleted !== true).length)
      }
      return complete ? { sessions } : {}
    }
    if (path === `${BASE}/projections/complete`) {
      const snapshot = String(body.snapshot_ref)
      const result = await this.options.request.post(path, { ...body, session_count: this.snapshots.get(snapshot) ?? 0 }, signal)
      this.snapshots.delete(snapshot)
      return result
    }
    if (path === `${BASE}/session-events/status`) {
      const items: unknown[] = []
      for (const id of body.session_refs as string[]) {
        const owner = this.check(id)
        const result = await this.options.request.post(path, { ...body, runtime_ref: owner.runtime, session_refs: [id] }, signal)
        if (!Array.isArray(result.items)) throw new Error('会话同步水位响应无效')
        items.push(...result.items)
      }
      return { items }
    }
    if (typeof body.session_ref === 'string' && path.startsWith(`${BASE}/session-`)) {
      const address = path.endsWith('/list')
        ? { runtime_ref: this.check(body.session_ref).runtime }
        : await this.address(body.session_ref, signal)
      return this.options.request.post(path, { ...body, ...address }, signal)
    }
    return this.options.request.post(path, body, signal)
  }
}
