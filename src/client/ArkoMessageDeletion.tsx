import { useEffect, useRef, useState } from 'react'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { tr } from './locale.js'
import { callArkme } from './api.js'
import { arkoLifecycleSync } from './arko-lifecycle-sync.js'
import { arkoLifecycleOperation } from './arko-lifecycle-operation.js'
import type { ArkmeArkoLifecycleItem, ArkmeArkoLifecycleSnapshot } from '../arko-lifecycle-contract.js'

const retentionDescription = '删除的消息将放入「数据管理 → 最近删除」，30 天内可恢复，之后自动清空。'

export function ArkoMessageDeletionDialog({ messageRefs, onClose, onFacts }: {
  messageRefs: readonly string[]; onClose(): void; onFacts(items: ArkmeArkoLifecycleItem[]): void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController>()
  const operation = useRef<ReturnType<typeof arkoLifecycleOperation>>()
  const refKey = JSON.stringify(messageRefs)
  useEffect(() => {
    operation.current = undefined
    setBusy(false); setError('')
    return () => { controller.current?.abort(); controller.current = undefined }
  }, [refKey])
  const confirm = async () => {
    if (controller.current || !messageRefs.length || messageRefs.length > 100) return
    const read = new AbortController(); controller.current = read
    setBusy(true); setError('')
    try {
      if (!operation.current) {
        const snapshot = await callArkme<ArkmeArkoLifecycleSnapshot>('arko.lifecycle.query', { messageRefs }, read.signal)
        if (read.signal.aborted) return
        onFacts(snapshot.items)
        if (snapshot.items.length !== messageRefs.length || snapshot.items.some(item => item.state === 'unavailable')) {
          throw new Error('删除失败，请刷新后重试')
        }
        if (snapshot.items.some(item => item.state === 'active' && item.deleteBlockedReason)) {
          throw new Error('所选消息仍在生成或发送结果待确认，请完成后再删除')
        }
        const targets = snapshot.items.filter(item => item.state === 'active' && !item.deleteBlockedReason)
          .map(item => ({ messageRef: item.messageRef, expectedVersion: item.version }))
        if (!targets.length) {
          if (snapshot.items.length === messageRefs.length && snapshot.items.every(item => item.state === 'deleted' || item.state === 'expired')) { onClose(); return }
          throw new Error('所选消息仍在生成或发送结果待确认，请完成后再删除')
        }
        operation.current = arkoLifecycleOperation({ action: 'delete', operationUid: crypto.randomUUID(), targets })
      }
      const result = await operation.current(read.signal)
      if (read.signal.aborted) return
      onFacts(result.items); arkoLifecycleSync.invalidate()
      if (result.complete) onClose()
      else setError('操作结果暂时无法确认，请重试')
    } catch (cause) {
      if (!read.signal.aborted) setError(cause instanceof Error ? cause.message : '删除失败')
    } finally {
      if (!read.signal.aborted) { controller.current = undefined; setBusy(false) }
    }
  }
  return <ArkmeConfirmDialog titleId="arkme-arko-delete-title" title={tr('删除所选 {v0} 条 Arko 消息？', { v0: String(messageRefs.length) })}
    description={tr(retentionDescription)} confirmLabel={tr('确认删除')} busyLabel={tr('删除中…')} confirmTone="danger"
    confirmDisabled={!messageRefs.length || messageRefs.length > 100} busy={busy} error={tr(error)}
    onClose={onClose} onConfirm={() => { void confirm() }} />
}
