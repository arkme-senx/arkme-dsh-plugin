import { callArkme } from './api.js'
import { acceptUnderlineSnapshot, type MessageUnderlineSnapshot, type MessageUnderlineCapabilities, type MessageUnderlineChange } from '../message-annotations.js'
import { messageSelectionReference, type MessageSelectionTarget } from './ArkmeMessageTextSelection.js'

export interface MessageMarkTransport {
  subscribe?(invalidate: () => void): () => void
  capabilities(sourceRef: string, signal: AbortSignal): Promise<MessageUnderlineCapabilities>
  list(sourceRef: string, refs: string[], signal: AbortSignal): Promise<{ actionRef: string; snapshot: MessageUnderlineSnapshot }[]>
  change(sourceRef: string, ref: string, change: MessageUnderlineChange, signal: AbortSignal): Promise<MessageUnderlineSnapshot>
}

export function underlineTargetKey(target: MessageSelectionTarget) {
  return JSON.stringify([target.item.itemUid, target.item.recordOwnerUserId ?? '', target.item.sequence ?? ''])
}
function accessLost(error: unknown) {
  const value = ((error as { body?: unknown })?.body ?? error) as { httpStatus?: number; status?: number; code?: string }
  return [401, 403].includes(value?.httpStatus ?? value?.status ?? 0) || /auth|forbidden|permission|login|account-unavailable|account-changed|not_accessible/u.test(value?.code ?? '')
}
export class MessageUnderlineSession {
  readonly controller = new AbortController()
  readonly snapshots = new Map<string, MessageUnderlineSnapshot>()
  readonly pending = new Set<string>()
  private accessEpoch = 0
  private epochs = new Map<string, number>()
  private failures = new Map<string, { notice: string; retry: () => Promise<void> }>()
  private loading = false
  private queuedTargets: MessageSelectionTarget[] | undefined
  capability: MessageUnderlineCapabilities | undefined
  notice = ''
  retry: (() => Promise<void>) | undefined
  constructor(public sourceRef: string, readonly viewerId: number, private emit: () => void, readonly storage: 'cloud' | 'local' = 'cloud', private transport?: MessageMarkTransport) {}
  invalidate() { this.accessEpoch++; this.snapshots.clear(); this.failures.clear(); this.notice = ''; this.retry = undefined; this.publish() }
  subscribe(invalidate: () => void) { return this.transport?.subscribe?.(invalidate) }
  dispose() { this.queuedTargets = undefined; this.controller.abort(); this.snapshots.clear(); this.pending.clear(); this.failures.clear() }
  private publish() {
    const failure = this.failures.values().next().value
    if (failure) { this.notice = failure.notice; this.retry = failure.retry }
    if (!this.controller.signal.aborted) this.emit()
  }
  report(error: unknown) { this.notice = error instanceof Error ? error.message : '标记操作失败'; this.publish() }
  async prepare() {
    try {
      const result = await (this.transport ? this.transport.capabilities(this.sourceRef, this.controller.signal)
        : callArkme<MessageUnderlineCapabilities>(this.storage === 'local' ? 'source.local-message-mark.capabilities' : 'source.message-underline.capabilities', { sourceRef: this.sourceRef }, this.controller.signal))
      if (this.controller.signal.aborted) return
      this.capability = result
      this.notice = result.supported ? '' : '标记尚待服务端接通，暂未保存'
      this.retry = undefined
    } catch (error) {
      if (this.controller.signal.aborted) return
      this.notice = error instanceof Error ? error.message : '无法确认标记支持情况'
      this.retry = () => this.prepare()
    }
    this.publish()
  }
  async read(targets: MessageSelectionTarget[]) {
    if (!this.capability?.supported || this.controller.signal.aborted) return
    if (this.loading) { this.queuedTargets = targets; return }
    this.loading = true
    let next: MessageSelectionTarget[] | undefined = targets
    try {
      while (next && !this.controller.signal.aborted) {
        this.queuedTargets = undefined
        await this.readTargets(next)
        next = this.queuedTargets
      }
    } finally { this.loading = false; this.queuedTargets = undefined }
  }
  private async readTargets(targets: MessageSelectionTarget[]) {
    const unique = new Map(targets.filter(target => target.sourceRef === this.sourceRef && messageSelectionReference(target)).map(target => [messageSelectionReference(target)!, target]))
    if (!unique.size) return
    const epochs = new Map(this.epochs), accessEpoch = this.accessEpoch
    try {
      const refs = [...unique.keys()]
      for (let i = 0; i < refs.length; i += 40) {
        const result = await (this.transport ? this.transport.list(this.sourceRef, refs.slice(i, i + 40), this.controller.signal)
          : callArkme<{ actionRef: string; snapshot: MessageUnderlineSnapshot }[]>(this.storage === 'local' ? 'source.local-message-mark.list' : 'source.message-underline.list', { sourceRef: this.sourceRef, actionRefs: refs.slice(i, i + 40) }, this.controller.signal))
        if (this.controller.signal.aborted) return
        for (const row of result) {
          const target = unique.get(row.actionRef)
          if (!target) continue
          const key = underlineTargetKey(target)
          if (row.snapshot.accessible && (accessEpoch !== this.accessEpoch || (epochs.get(key) ?? 0) !== (this.epochs.get(key) ?? 0))) continue
          const next = acceptUnderlineSnapshot(this.snapshots.get(key), row.snapshot, this.pending.has(key))
          if (next) this.snapshots.set(key, next)
        }
        this.notice = result.find(row => row.snapshot.syncNotice)?.snapshot.syncNotice ?? ''
        this.publish()
      }
    } catch (error) {
      if (!this.controller.signal.aborted) {
        // A failed cloud lookup cannot confirm source visibility. Invalidate
        // pending completions too: rollback must not restore the cleared text.
        if (this.storage === 'cloud' || accessLost(error)) {
          this.accessEpoch++
          this.snapshots.clear()
        }
        this.notice = error instanceof Error ? error.message : '标记同步失败'
        this.retry = () => this.read(targets)
        this.publish()
      }
    }
  }
  async change(target: MessageSelectionTarget, change: MessageUnderlineChange): Promise<void> {
    const reference = messageSelectionReference(target)
    if (this.controller.signal.aborted || target.sourceRef !== this.sourceRef || !reference || target.item.status !== 1) throw new Error('会话已变化，请重新选择')
    if (!this.capability?.supported) throw new Error(this.notice || '正在确认标记支持情况，请稍后重试')
    const key = underlineTargetKey(target), before = this.snapshots.get(key)
    if (this.pending.has(key)) throw new Error('这条消息的标记正在同步')
    if (change.kind === 'remove' && !before?.items.some(item => item.id === change.annotationId && item.mine)) throw new Error('只能取消自己的标记')
    if (change.kind === 'add' && change.anchor.text.length > this.capability.maxLength) throw new Error(`标记最多 ${this.capability.maxLength} 个字符`)
    if (change.kind === 'add' && before?.items.some(item => item.mine && JSON.stringify(item.anchor) === JSON.stringify(change.anchor))) return
    const accessEpoch = this.accessEpoch
    this.pending.add(key)
    this.failures.delete(key)
    this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1)
    this.snapshots.set(key, { revision: before?.revision ?? 0, accessible: true,
      items: change.kind === 'remove' ? (before?.items ?? []).filter(item => item.id !== change.annotationId)
        : [...(before?.items ?? []), { id: change.operationId, actorId: this.viewerId, actorName: '你', mine: true, anchor: change.anchor, state: 'available', pending: true }] })
    this.notice = ((this.capability?.storage ?? this.storage) === 'local' ? '正在保存本机标记…' : '正在同步标记…'); this.retry = undefined; this.publish()
    try {
      const result = await (this.transport ? this.transport.change(this.sourceRef, reference, change, this.controller.signal)
        : callArkme<MessageUnderlineSnapshot>(this.storage === 'local' ? 'source.local-message-mark.change' : 'source.message-underline.change', { sourceRef: this.sourceRef, messageActionRef: reference, change }, this.controller.signal))
      if (this.controller.signal.aborted) return
      const current = this.snapshots.get(key)
      if ((!result.accessible || accessEpoch === this.accessEpoch) && current?.accessible !== false) this.snapshots.set(key, acceptUnderlineSnapshot(current, result)!)
      this.failures.delete(key); this.notice = this.pending.size > 1 ? ((this.capability?.storage ?? this.storage) === 'local' ? '正在保存本机标记…' : '正在同步标记…') : ''; this.retry = undefined
    } catch (error) {
      if (this.controller.signal.aborted || accessEpoch !== this.accessEpoch) return
      if (this.storage === 'cloud' || accessLost(error)) {
        this.accessEpoch++
        this.snapshots.clear()
      }
      else if (accessEpoch === this.accessEpoch && this.snapshots.get(key)?.accessible !== false) {
        if (before) this.snapshots.set(key, before); else this.snapshots.delete(key)
      }
      this.notice = error instanceof Error ? error.message : '标记同步失败，请重试'
      this.retry = async () => {
        // Reconfirm access after clearing cloud text; preserve the original
        // operation ID when the owner allows the same command to be retried.
        if (this.storage === 'cloud') {
          await this.read([target])
          const confirmed = this.snapshots.get(key)
          if (!confirmed?.accessible || this.pending.has(key)) return
          // A lost response may already have completed. A complete owner read
          // can confirm the desired state without another write or stale error.
          const completed = change.kind === 'remove'
            ? !confirmed.items.some(item => item.id === change.annotationId)
            : confirmed.items.some(item => item.mine
              && item.anchor.sourceDigest === change.anchor.sourceDigest
              && item.anchor.start === change.anchor.start && item.anchor.end === change.anchor.end
              && (change.anchor.recordVersion === undefined || item.anchor.recordVersion === change.anchor.recordVersion))
          if (completed) {
            this.failures.delete(key)
            this.notice = this.pending.size ? '正在同步标记…' : ''; this.retry = undefined
            this.publish()
            return
          }
        }
        await this.change(target, change)
      }
      this.failures.set(key, { notice: this.notice, retry: this.retry })
    } finally {
      this.pending.delete(key); this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1); this.publish()
    }
  }
}
