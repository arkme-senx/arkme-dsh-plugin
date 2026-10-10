import { randomUUID } from 'node:crypto'
import { CodexDispatchJournal, type CodexDispatchEvidence, type CodexDispatchRequest,
  type CodexDispatchScope, type CodexDispatchWaitReason } from './team-codex-dispatch-journal.js'

export interface CodexNativeDispatchPort {
  /** Read-only, no navigation, focus change or draft modification. */
  inspect(request: CodexDispatchRequest): Promise<CodexDispatchWaitReason | null>
  /**
   * Serial native operation. Verify exact thread, empty draft/attachments, user inactivity and focus.
   * Call canSubmit immediately before staging and pressing; never press Steer. Do not return until
   * native work has stopped, and never retry a press. Return NEW correlated evidence or null.
   */
  submit(request: CodexDispatchRequest, canSubmit: () => Promise<boolean>): Promise<CodexDispatchEvidence | null>
}
export interface CodexDispatchAuthority {
  /** Host resolves current login + team membership + local task binding afresh, not from client text. */
  isCurrent(request: CodexDispatchRequest): Promise<boolean>
}

/** Not wired to the host until an independently authorized native adapter is available. */
export class CodexDispatchExecutor {
  readonly id = randomUUID()
  private busy = false
  private generation = 0
  constructor(private readonly journal: CodexDispatchJournal, private readonly native: CodexNativeDispatchPort,
    private readonly authority: CodexDispatchAuthority) {}

  /** Synchronous logout/pause fence also invalidates checks already in flight. */
  fence(): void { this.generation++ }

  async tick(scope: CodexDispatchScope): Promise<void> {
    if (this.busy) return
    this.busy = true
    const generation = this.generation
    let lease: ReturnType<CodexDispatchJournal['claim']> = undefined
    let started = false
    try {
      lease = this.journal.claim(scope, this.id)
      if (!lease) return
      const current = async () => {
        if (generation !== this.generation) return false
        const allowed = await this.authority.isCurrent(lease!.request)
        return allowed && generation === this.generation
      }
      if (!await current()) {
        this.journal.revoke(scope)
        this.journal.wait(lease, 'target_unavailable'); return
      }
      const reason = await this.native.inspect(lease.request)
      if (reason) { this.journal.wait(lease, reason); return }
      if (!await current()) {
        this.journal.revoke(scope)
        this.journal.wait(lease, 'target_unavailable'); return
      }
      const request = this.journal.beginInput(lease)
      if (!request) return
      started = true
      const receipt = await this.native.submit(request, async () => await current() && this.journal.canSubmit(lease!))
      this.journal.finish(lease, receipt)
      started = false
    } catch {
      // Errors may contain request text or local paths. Do not persist/log raw adapter errors.
      // No timeout race: the adapter promise must settle only after it has stopped native work.
      if (lease) {
        if (started) this.journal.finish(lease, null)
        else this.journal.wait(lease, 'codex_unavailable')
      }
    } finally { this.busy = false }
  }
}
