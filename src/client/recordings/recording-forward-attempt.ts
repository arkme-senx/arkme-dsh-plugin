import type { RecordingForwardInput, RecordingForwardReceipt } from '../../recording-forward-contract.js'
import type { ArkmeRecordingWorkbenchItem, ArkmeSourceItem } from '../../types.js'

export interface RecordingForwardSender {
  forward(input: RecordingForwardInput, signal: AbortSignal): Promise<RecordingForwardReceipt>
}

export function recordingForwardTargetKey(target: ArkmeSourceItem): string {
  if (target.kind === 'private_chat' || target.kind === 'group_chat') return target.sourceKey ?? ''
  if (target.kind === 'topic') return target.topicHierarchyKey ?? ''
  return target.kind === 'send_to_self' ? 'send_to_self' : ''
}

/** Retry identity and confirmed deliveries belong to the selected recording, across dialog mounts. */
export class RecordingForwardAttempt {
  readonly items: readonly ArkmeRecordingWorkbenchItem[]
  private readonly deliveries = new Map<string, { input: RecordingForwardInput; receipt?: RecordingForwardReceipt }>()
  private frozenComment: string | undefined

  constructor(items: readonly ArkmeRecordingWorkbenchItem[], private readonly sender: RecordingForwardSender) {
    this.items = [...items]
  }

  get commentText(): string | undefined { return this.frozenComment }

  hasSent(key: string): boolean { return this.deliveries.get(key)?.receipt !== undefined }

  async send(targets: readonly ArkmeSourceItem[], comment: string, signal: AbortSignal, onResult: (key: string, message: string) => void): Promise<string | undefined> {
    if (signal.aborted || targets.length === 0) return undefined
    this.frozenComment ??= comment.trim()
    for (const target of targets) {
      if (signal.aborted) return undefined
      const key = recordingForwardTargetKey(target)
      if (this.hasSent(key)) continue
      try {
        let delivery = this.deliveries.get(key)
        if (delivery === undefined) {
          delivery = { input: {
            itemRefs: this.items.map(item => item.itemRef),
            targetSourceRef: target.sourceRef,
            requestId: crypto.randomUUID(),
            recordUid: crypto.randomUUID(),
            sendAtMillis: Date.now(),
            ...(this.frozenComment ? { commentText: this.frozenComment, commentRecordUid: crypto.randomUUID() } : {}),
          } }
          this.deliveries.set(key, delivery)
        }
        const receipt = await this.sender.forward({ ...delivery.input, targetSourceRef: target.sourceRef }, signal)
        // Closing a view cannot undo a delivery that the owner has confirmed.
        delivery.receipt = receipt
        if (!signal.aborted) onResult(key, receipt.warningText || '已转发')
      } catch (reason) {
        if (!signal.aborted) onResult(key, reason instanceof Error ? reason.message : '转发结果未确认，请重试确认')
      }
    }
    const keys = targets.map(recordingForwardTargetKey)
    if (signal.aborted || keys.some(key => !this.hasSent(key))) return undefined
    const warnings = keys.flatMap(key => {
      const warning = this.deliveries.get(key)?.receipt?.warningText
      return warning ? [warning] : []
    })
    return warnings.join('；') || '转发成功'
  }
}
