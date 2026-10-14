import type { ContentProof } from './history-content-proof.js'
import { DshRemoteError } from './errors.js'

/** The server admits a page and returns precise identity rejections. There is
 * no recursive split: transient conflicts/auth/network failures cost one request.
 * Rejected writes are never ACKed and retain their durable local retry source. */
export interface SourceRecovery<T> {
 signal: AbortSignal
 read(item: T, signal: AbortSignal): Promise<ContentProof>
 recovered(bindings: Record<string, string>): Promise<void>
 failed(error: unknown): void
}
export class ProjectionUpload {
  private recoveryVersion = 0
  private recoveryFlight = false
  private epoch = 0
  private readonly attempted = new Map<string, number>()
  private readonly rejected = new Map<string, number>()
  clear(): void { this.rejected.clear(); this.attempted.clear(); this.recoveryVersion = 0; this.epoch++ }
  async page<T extends { session_ref: string }>(items: T[], send: (items: T[], signal: AbortSignal) => Promise<unknown>, signal: AbortSignal, recovery?: SourceRecovery<T>): Promise<{ accepted: number; rejected: number; sourceBindings?: Record<string, string> }> {
    signal.throwIfAborted()
    const now = Date.now()
    for (const [id, until] of this.rejected) if (until <= now) this.rejected.delete(id)
    if (recovery) this.scheduleRecovery(items, send, recovery)
    const pending = items.filter(item => !this.rejected.has(item.session_ref))
    if (!pending.length && items.length) return { accepted: 0, rejected: items.length }
    const response = await send(pending, signal)
    signal.throwIfAborted()
    const result = response as { accepted_session_refs?: unknown; rejected_session_refs?: unknown; source_bindings?: unknown; source_recovery_version?: unknown } | undefined
    // Compatibility: old backends ACK the whole page or throw. Never infer
    // which identity caused their generic conflict or fan it out into retries.
    if (result?.accepted_session_refs === undefined && result?.rejected_session_refs === undefined) return { accepted: pending.length, rejected: items.length - pending.length }
    if (result?.source_recovery_version === 1) this.recoveryVersion = 1
    const accepted = result?.accepted_session_refs, rejected = result?.rejected_session_refs
    const wanted = new Set(pending.map(item => item.session_ref)), seen = new Set<string>()
    if (!Array.isArray(accepted) || !Array.isArray(rejected) || [...accepted, ...rejected].some(id => typeof id !== 'string' || !wanted.has(id) || seen.has(id) || !seen.add(id)) || seen.size !== wanted.size) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '会话上传回执不完整')
    const bindings = result?.source_bindings
    if (bindings !== undefined && (bindings === null || typeof bindings !== 'object' || Array.isArray(bindings)
      || Object.entries(bindings).some(([id, revision]) => !accepted.includes(id) || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)))) {
      throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '历史来源绑定回执无效')
    }
    for (const id of rejected as string[]) {
      if (this.rejected.size >= 10_000) this.rejected.delete(this.rejected.keys().next().value!)
      this.rejected.set(id, Date.now() + 300_000)
    }
    if (recovery) this.scheduleRecovery(items, send, recovery)
    return { accepted: accepted.length, rejected: items.length - accepted.length, ...(bindings === undefined ? {} : { sourceBindings: bindings as Record<string, string> }) }
  }

  private scheduleRecovery<T extends { session_ref: string }>(items: T[], send: (items: T[], signal: AbortSignal) => Promise<unknown>, recovery: SourceRecovery<T>): void {
    if (this.recoveryFlight || this.recoveryVersion !== 1 || recovery.signal.aborted) return
    const item = items.find(item => this.rejected.has(item.session_ref) && Date.now() >= (this.attempted.get(item.session_ref) ?? 0))
    if (!item) return
    if (this.attempted.size >= 256) this.attempted.delete(this.attempted.keys().next().value!)
    this.attempted.set(item.session_ref, Date.now() + 300_000)
    this.recoveryFlight = true
    const epoch = this.epoch
    void (async () => {
      const signal = AbortSignal.any([recovery.signal, AbortSignal.timeout(60_000)])
      const proof = await recovery.read(item, signal)
      signal.throwIfAborted()
      if (epoch !== this.epoch) return
      // Only the ordered digests cross the wire: <= 3.4 MiB for 50k messages.
      const candidate = { ...item, recovery_proof: { version: proof.version, sequence: proof.sequence } }
      const receipt = await new ProjectionUpload().page([candidate], send, signal)
      signal.throwIfAborted()
      if (epoch !== this.epoch) return
      if (receipt.accepted !== 1 || !receipt.sourceBindings?.[item.session_ref]) throw new DshRemoteError('REMOTE_PROJECTION_CONFLICT', '恢复来源尚未获确认', true)
      await recovery.recovered(receipt.sourceBindings)
      if (epoch === this.epoch) this.rejected.delete(item.session_ref)
    })().catch(error => { if (epoch === this.epoch && !recovery.signal.aborted) recovery.failed(error) })
      .finally(() => { this.recoveryFlight = false })
  }
}
