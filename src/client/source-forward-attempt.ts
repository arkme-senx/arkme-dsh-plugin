import type { ArkmeSourceSendResult } from '../types.js'
import type { TeamGroupIdentity } from '../team-group-contract.js'
import type { ForwardTarget } from './unified-forward-targets.js'
import { forwardTargetKey } from './unified-forward-targets.js'

export interface SourceForwardCommand {
  sourceRef: string; actionRefs: readonly string[]; expectedUserId: number;
  targetSourceRef?: string; targetConversationRef?: string;
  recordUid: string; relationUid: string; sendAtMillis: number; commentText?: string;
  representation?: TeamGroupIdentity['selection'];
}
/** Freeze the source, comment, identity and representation before the first send. */
export class SourceForwardAttempt {
  private frozenComment: string | undefined
  private readonly deliveries = new Map<string, { command: SourceForwardCommand; receipt?: ArkmeSourceSendResult }>()
  readonly actionRefs: readonly string[]
  constructor(readonly sourceRef: string, actionRefs: readonly string[], readonly userId: number,
    private readonly sender: (command: SourceForwardCommand, signal: AbortSignal) => Promise<ArkmeSourceSendResult>) {
    this.actionRefs = Object.freeze([...actionRefs])
  }
  get commentText() { return this.frozenComment }
  hasAttempt(key: string) { return this.deliveries.has(key) }
  async send(target: ForwardTarget, comment: string, signal: AbortSignal, representation?: TeamGroupIdentity) {
    signal.throwIfAborted()
    this.frozenComment ??= comment.trim()
    const key = forwardTargetKey(target)
    let delivery = this.deliveries.get(key)
    if (!delivery) {
      delivery = { command: { sourceRef: this.sourceRef, actionRefs: this.actionRefs, expectedUserId: this.userId,
        ...(target.kind === 'team' ? { targetConversationRef: target.conversation.ref } : { targetSourceRef: target.source.sourceRef }),
        recordUid: crypto.randomUUID(), relationUid: crypto.randomUUID(), sendAtMillis: Date.now(),
        ...(this.frozenComment ? { commentText: this.frozenComment } : {}),
        ...(representation && target.kind === 'source' ? { representation: structuredClone(representation.selection) } : {}),
      } }
      this.deliveries.set(key, delivery)
    }
    if (delivery.receipt) return delivery.receipt
    const result = await this.sender({ ...delivery.command, actionRefs: [...delivery.command.actionRefs] }, signal)
    if (result.localState !== 'synced' || !result.itemUid) throw new Error('转发结果尚未确认，请使用原请求重试')
    if (!result.warningText) delivery.receipt = result
    return result
  }
}
