import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeGroupMemberRole, ArkmeMessageWithdrawalResult, ArkmeSourceItem, ArkmeTimelineItem } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeConfirmDialog, ArkmeConfirmDialogPreview } from './ArkmeConfirmDialog.js'

export function arkmeCanWithdrawTimelineMessage(
  source: ArkmeSourceItem | undefined,
  item: ArkmeTimelineItem,
  selfRole: ArkmeGroupMemberRole,
): boolean {
  return source?.kind === 'group_chat' && selfRole === 'owner' && !item.isMe
    && (item.messageWithdrawalRef?.trim() ?? '') !== '' && (item.timelineItemKey?.trim() ?? '') !== ''
}

export function ArkmeMessageWithdrawalDialog(props: {
  item: ArkmeTimelineItem
  onClose: () => void
  onWithdrawn: (result: ArkmeMessageWithdrawalResult) => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef<AbortController>()
  const submittingRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; requestRef.current?.abort() }
  }, [])

  const submit = useCallback(async () => {
    const messageWithdrawalRef = props.item.messageWithdrawalRef?.trim() ?? ''
    if (messageWithdrawalRef === '' || submittingRef.current) return
    const controller = new AbortController()
    requestRef.current = controller
    submittingRef.current = true
    setSubmitting(true)
    setError('')
    try {
      const result = await callArkme<ArkmeMessageWithdrawalResult>('source.message-withdraw', {
        messageWithdrawalRef,
      }, controller.signal)
      if (mountedRef.current) props.onWithdrawn(result)
    } catch (caught) {
      if (mountedRef.current && !controller.signal.aborted) setError(caught instanceof Error && caught.message.trim() !== '' ? caught.message : '撤回失败，请稍后重试')
    } finally {
      if (requestRef.current === controller) requestRef.current = undefined
      submittingRef.current = false
      if (mountedRef.current) setSubmitting(false)
    }
  }, [props.item.messageWithdrawalRef, props.onWithdrawn])

  const preview = props.item.textContent.trim() || props.item.title.trim() || '非文本消息'
  return <ArkmeConfirmDialog
    titleId="arkme-message-withdraw-title"
    title="撤回这条消息？"
    description="撤回后，所有群成员都无法再查看这条消息。此操作不会移除或限制发送者。"
    error={error}
    busy={submitting}
    confirmLabel="确认撤回"
    busyLabel="撤回中…"
    confirmTone="danger"
    onClose={props.onClose}
    onConfirm={() => { void submit() }}
  >
    <ArkmeConfirmDialogPreview title={preview}>{preview}</ArkmeConfirmDialogPreview>
  </ArkmeConfirmDialog>
}
