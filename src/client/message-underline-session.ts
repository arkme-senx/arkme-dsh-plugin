import { callArkme } from './api.js'
import { acceptUnderlineSnapshot, type MessageUnderlineSnapshot, type MessageUnderlineCapabilities, type MessageUnderlineChange } from '../message-annotations.js'
import type { MessageSelectionTarget } from './ArkmeMessageTextSelection.js'

export function underlineTargetKey(target: MessageSelectionTarget) {
  return JSON.stringify([target.item.itemUid, target.item.recordOwnerUserId ?? '', target.item.sequence ?? ''])
}
function accessLost(error: unknown) {
  const value = ((error as { body?: unknown })?.body ?? error) as { httpStatus?: number; status?: number; code?: string }
  return [401, 403].includes(value?.httpStatus ?? value?.status ?? 0) || /auth|forbidden|permission|login|account-unavailable/u.test(value?.code ?? '')
}
export class MessageUnderlineSession {
  readonly controller = new AbortController()
  readonly snapshots = new Map<string, MessageUnderlineSnapshot>()
  readonly pending = new Set<string>()
  private epochs = new Map<string, number>()
  private failures = new Map<string, { notice: string; retry: () => Promise<void> }>()
  private loading = false
  capability: MessageUnderlineCapabilities | undefined
  notice = ''
  retry: (() => Promise<void>) | undefined
  constructor(public sourceRef: string, readonly viewerId: number, private emit: () => void) {}
  dispose() { this.controller.abort(); this.snapshots.clear(); this.pending.clear(); this.failures.clear() }
  private publish() {
    const failure = this.failures.values().next().value
    if (failure) { this.notice = failure.notice; this.retry = failure.retry }
    if (!this.controller.signal.aborted) this.emit()
  }
  report(error: unknown) { this.notice = error instanceof Error ? error.message : '标记操作失败'; this.publish() }
  async prepare() {
    try {
      const result = await callArkme<MessageUnderlineCapabilities>('source.message-underline.capabilities', { sourceRef: this.sourceRef }, this.controller.signal)
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
    if (this.loading || !this.capability?.supported || this.controller.signal.aborted) return
    const unique = new Map(targets.filter(target => target.sourceRef === this.sourceRef && target.item.messageActionRef).map(target => [target.item.messageActionRef!, target]))
    if (!unique.size) return
    this.loading = true
    const epochs = new Map(this.epochs)
    try {
      const refs = [...unique.keys()]
      for (let i = 0; i < refs.length; i += 40) {
        const result = await callArkme<{ actionRef: string; snapshot: MessageUnderlineSnapshot }[]>('source.message-underline.list', { sourceRef: this.sourceRef, actionRefs: refs.slice(i, i + 40) }, this.controller.signal)
        if (this.controller.signal.aborted) return
        for (const row of result) {
          const target = unique.get(row.actionRef)
          if (!target) continue
          const key = underlineTargetKey(target)
          if (row.snapshot.accessible && (epochs.get(key) ?? 0) !== (this.epochs.get(key) ?? 0)) continue
          const next = acceptUnderlineSnapshot(this.snapshots.get(key), row.snapshot, this.pending.has(key))
          if (next) this.snapshots.set(key, next)
        }
        this.publish()
      }
    } catch (error) {
      if (!this.controller.signal.aborted) {
        // No stale annotation content after authorization loss.
        if (accessLost(error)) this.snapshots.clear()
        this.notice = error instanceof Error ? error.message : '标记同步失败'
        this.retry = () => this.read(targets)
        this.publish()
      }
    } finally { this.loading = false }
  }
  async change(target: MessageSelectionTarget, change: MessageUnderlineChange): Promise<void> {
    if (this.controller.signal.aborted || target.sourceRef !== this.sourceRef || !target.item.messageActionRef || target.item.status !== 1) throw new Error('会话已变化，请重新选择')
    if (!this.capability?.supported) throw new Error(this.notice || '正在确认标记支持情况，请稍后重试')
    const key = underlineTargetKey(target), before = this.snapshots.get(key)
    if (this.pending.has(key)) throw new Error('这条消息的标记正在同步')
    if (change.kind === 'remove' && !before?.items.some(item => item.id === change.annotationId && item.mine)) throw new Error('只能取消自己的标记')
    if (change.kind === 'add' && change.anchor.text.length > this.capability.maxLength) throw new Error(`标记最多 ${this.capability.maxLength} 个字符`)
    if (change.kind === 'add' && before?.items.some(item => item.mine && JSON.stringify(item.anchor) === JSON.stringify(change.anchor))) return
    this.pending.add(key)
    this.failures.delete(key)
    this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1)
    this.snapshots.set(key, { revision: before?.revision ?? 0, accessible: true,
      items: change.kind === 'remove' ? (before?.items ?? []).filter(item => item.id !== change.annotationId)
        : [...(before?.items ?? []), { id: change.operationId, actorId: this.viewerId, actorName: '你', mine: true, anchor: change.anchor, state: 'available', pending: true }] })
    this.notice = '正在同步标记…'; this.retry = undefined; this.publish()
    try {
      const result = await callArkme<MessageUnderlineSnapshot>('source.message-underline.change', { sourceRef: this.sourceRef, messageActionRef: target.item.messageActionRef, change }, this.controller.signal)
      if (this.controller.signal.aborted) return
      const current = this.snapshots.get(key)
      if (current?.accessible !== false) this.snapshots.set(key, acceptUnderlineSnapshot(current, result)!)
      this.failures.delete(key); this.notice = this.pending.size > 1 ? '正在同步标记…' : ''; this.retry = undefined
    } catch (error) {
      if (this.controller.signal.aborted) return
      if (accessLost(error)) this.snapshots.clear()
      else if (this.snapshots.get(key)?.accessible !== false) {
        if (before) this.snapshots.set(key, before); else this.snapshots.delete(key)
      }
      this.notice = error instanceof Error ? error.message : '标记同步失败，已恢复'
      this.retry = () => this.change(target, change) // Stable idempotency key for uncertain writes.
      this.failures.set(key, { notice: this.notice, retry: this.retry })
    } finally {
      this.pending.delete(key); this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1); this.publish()
    }
  }
}
