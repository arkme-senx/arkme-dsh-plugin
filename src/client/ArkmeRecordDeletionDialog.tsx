import { tr, useArkmeLocale } from './locale.js'
import { useEffect, useRef, useState } from 'react'
import type { ArkmeRecordDeletionResult } from '../record-deletion-contract.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { recordDeletionClientPort, type RecordDeletionClientPort } from './record-deletion-port.js'

/** Dialog-local attempt only; the parent owns selection and Record owns deletion facts. */
export function ArkmeRecordDeletionDialog(props: {
  sourceRef: string
  deletionRefs: readonly string[]
  port?: RecordDeletionClientPort
  onCancel(): void
  onRefresh(): void
  onResult(result: ArkmeRecordDeletionResult): void
}) {
  useArkmeLocale()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController>()
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort() } }, [])
  const invalid = props.deletionRefs.length < 1 || props.deletionRefs.length > 100
  const confirm = async () => {
    if (request.current || invalid) return
    if (error) { props.onRefresh(); return }
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    let result: ArkmeRecordDeletionResult
    try { result = await (props.port ?? recordDeletionClientPort).delete(props.sourceRef, props.deletionRefs, controller.signal) }
    catch (caught) {
      if (mounted.current && !controller.signal.aborted) setError(`${caught instanceof Error ? caught.message : '删除失败'}；请刷新核对后再操作`)
      return
    } finally {
      if (mounted.current) setPending(false)
      request.current = undefined
    }
    if (mounted.current && !controller.signal.aborted) props.onResult(result)
  }
  return <ArkmeConfirmDialog titleId="arkme-record-delete-title" title={`确定删除 ${String(props.deletionRefs.length)} 条内容？`}
    description={pending ? '停止后不再继续删除其余内容，已提交的删除仍可能完成。退出后将刷新核对。' : tr("删除的内容将在数据管理中保留30天")} confirmLabel={error ? '刷新核对' : tr("确认删除")} busyLabel={tr("删除中…")}
    confirmTone="danger" busy={pending} closeWhileBusy cancelLabel={pending ? '停止并退出' : tr("取消")} confirmDisabled={invalid} error={invalid ? '请选择 1 至 100 条快记' : error}
    onClose={() => {
      if (request.current) {
        request.current.abort()
        props.onRefresh()
      } else props.onCancel()
    }} onConfirm={() => { void confirm() }} />
}
