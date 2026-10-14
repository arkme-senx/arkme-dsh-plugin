import { DshRemoteError } from './errors.js'

/** The server admits a page and returns precise identity rejections. There is
 * no recursive split: transient conflicts/auth/network failures cost one request.
 * Rejected writes are never ACKed and retain their durable local retry source. */
export class ProjectionUpload {
  private readonly rejected = new Map<string, number>()
  clear(): void { this.rejected.clear() }
  async page<T extends { session_ref: string }>(items: T[], send: (items: T[]) => Promise<unknown>, signal: AbortSignal): Promise<{ accepted: number; rejected: number; sourceBindings?: Record<string, string> }> {
    signal.throwIfAborted()
    const now = Date.now()
    for (const [id, until] of this.rejected) if (until <= now) this.rejected.delete(id)
    const pending = items.filter(item => !this.rejected.has(item.session_ref))
    if (!pending.length && items.length) return { accepted: 0, rejected: items.length }
    const response = await send(pending)
    signal.throwIfAborted()
    const result = response as { accepted_session_refs?: unknown; rejected_session_refs?: unknown; source_bindings?: unknown } | undefined
    // Compatibility: old backends ACK the whole page or throw. Never infer
    // which identity caused their generic conflict or fan it out into retries.
    if (result?.accepted_session_refs === undefined && result?.rejected_session_refs === undefined) return { accepted: pending.length, rejected: items.length - pending.length }
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
    return { accepted: accepted.length, rejected: items.length - accepted.length, ...(bindings === undefined ? {} : { sourceBindings: bindings as Record<string, string> }) }
  }
}
