import { tr, useArkmeLocale } from './locale.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeGroupMemberRole, ArkmeMessageWithdrawalResult, ArkmeSourceItem, ArkmeTimelineItem } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeConfirmDialog, ArkmeConfirmDialogPreview } from './ArkmeConfirmDialog.js'

export function arkmeCanWithdrawTimelineMessage(
  source: ArkmeSourceItem | undefined,
  item: ArkmeTimelineItem,
  selfRole: ArkmeGroupMemberRole,
): boolean {
  if (item.messageActionsV2 === true && item.isMe && item.senderKind !== 'bot' && item.messageActionRef && (source?.kind === 'private_chat' || source?.kind === 'group_chat')) return true
  return source?.kind === 'group_chat' && selfRole === 'owner' && !item.isMe
    && (item.messageWithdrawalRef?.trim() ?? '') !== '' && (item.timelineItemKey?.trim() ?? '') !== ''
}

export function ArkmeMessageWithdrawalDialog(props: {
  item: ArkmeTimelineItem
  sourceRef?:string
  onClose: () => void
  onWithdrawn: (result: ArkmeMessageWithdrawalResult) => void
}) {
  useArkmeLocale()
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
    if (submittingRef.current || (!props.item.isMe && messageWithdrawalRef === '')) return
    const controller = new AbortController()
    requestRef.current = controller
    submittingRef.current = true
    setSubmitting(true)
    setError('')
    try {
      if (props.item.isMe && props.sourceRef && props.item.messageActionRef) {
        const action = await callArkme<import('../chat-message-actions.js').ChatMessageActionResult>('source.chat-message-action', {
          sourceRef: props.sourceRef, actionRef: props.item.messageActionRef, action: 'recall',
        }, controller.signal)
        if (mountedRef.current) props.onWithdrawn({ messageWithdrawalRef: '', timelineItemKey: action.timelineItemKey, withdrawnAtMillis: action.changedAtMillis, alreadyWithdrawn: false })
        return
      }
      const result = await callArkme<ArkmeMessageWithdrawalResult>('source.message-withdraw', {
        messageWithdrawalRef,
        ...(props.sourceRef===undefined?{}:{sourceRef:props.sourceRef}),
      }, controller.signal)
      if (mountedRef.current) props.onWithdrawn(result)
    } catch (caught) {
      if (mountedRef.current && !controller.signal.aborted) setError(caught instanceof Error && caught.message.trim() !== '' ? caught.message : '撤回失败，请稍后重试')
    } finally {
      if (requestRef.current === controller) requestRef.current = undefined
      submittingRef.current = false
      if (mountedRef.current) setSubmitting(false)
    }
  }, [props.item, props.onWithdrawn, props.sourceRef])

  const preview = props.item.textContent.trim() || props.item.title.trim() || '非文本消息'
  return <ArkmeConfirmDialog
    titleId="arkme-message-withdraw-title"
    title={tr("撤回这条消息？")}
    description={props.item.isMe ? tr("撤回后，此对话中将无法查看这条消息；你的原始快记会保留。") : tr("撤回后，所有群成员都无法再查看这条消息。此操作不会移除或限制发送者。")}
    error={error}
    busy={submitting}
    confirmLabel={tr("确认撤回")}
    busyLabel={tr("撤回中…")}
    confirmTone="danger"
    onClose={props.onClose}
    onConfirm={() => { void submit() }}
  >
    <ArkmeConfirmDialogPreview title={preview}>{preview}</ArkmeConfirmDialogPreview>
  </ArkmeConfirmDialog>
}
