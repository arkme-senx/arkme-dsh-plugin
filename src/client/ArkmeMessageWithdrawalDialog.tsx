import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeGroupMemberRole, ArkmeMessageWithdrawalResult, ArkmeSourceItem, ArkmeTimelineItem } from '../types.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'

const styles = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 10_300, display: 'grid', placeItems: 'center', padding: 16,
    boxSizing: 'border-box', background: 'var(--dsw-alias-bg-mask-1, rgba(19, 22, 26, 0.34))',
    backdropFilter: 'var(--dsw-mask-blur, blur(2px))', WebkitBackdropFilter: 'var(--dsw-mask-blur, blur(2px))',
  },
  dialog: {
    width: 'min(420px, 100%)', boxSizing: 'border-box', border: `1px solid ${arkmeTheme.border}`,
    borderRadius: 14, padding: 22, background: arkmeTheme.base, color: arkmeTheme.text,
    boxShadow: arkmeTheme.shadow,
  },
  title: { margin: 0, fontSize: 18, lineHeight: '25px', fontWeight: 650 },
  description: { margin: '10px 0 0', color: arkmeTheme.secondary, fontSize: 13, lineHeight: '21px' },
  preview: {
    margin: '16px 0 0', padding: '10px 12px', borderRadius: 10, background: arkmeTheme.layer1,
    color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px', overflow: 'hidden',
    whiteSpace: 'nowrap', textOverflow: 'ellipsis',
  },
  error: { marginTop: 12, padding: '9px 11px', borderRadius: 8, background: arkmeTheme.dangerSoft, color: arkmeTheme.danger, fontSize: 12, lineHeight: '18px' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 },
  button: {
    minWidth: 82, height: 36, padding: '0 16px', border: `1px solid ${arkmeTheme.border}`,
    borderRadius: 9, background: arkmeTheme.base, color: arkmeTheme.text, cursor: 'pointer', fontSize: 13,
  },
  danger: { borderColor: 'transparent', background: arkmeTheme.danger, color: arkmeTheme.onPrimaryAction },
  disabled: { cursor: 'not-allowed', opacity: .45 },
} satisfies Record<string, CSSProperties>

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
  const cancelRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => { if (!submittingRef.current) props.onClose() }, [props.onClose])

  useEffect(() => {
    if (typeof document === 'undefined') return
    cancelRef.current?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      requestRef.current?.abort()
    }
  }, [close])
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
  const dialog = <div style={styles.backdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="arkme-message-withdraw-title" aria-busy={submitting || undefined} style={styles.dialog}>
      <h2 id="arkme-message-withdraw-title" style={styles.title}>撤回这条消息？</h2>
      <p style={styles.description}>撤回后，所有群成员都无法再查看这条消息。此操作不会移除或限制发送者。</p>
      <p style={styles.preview} title={preview}>{preview}</p>
      {error === '' ? null : <div role="alert" style={styles.error}>{error}</div>}
      <footer style={styles.footer}>
        <button ref={cancelRef} type="button" style={{ ...styles.button, ...(submitting ? styles.disabled : {}) }} disabled={submitting} onClick={close}>取消</button>
        <button type="button" style={{ ...styles.button, ...styles.danger, ...(submitting ? styles.disabled : {}) }} disabled={submitting} onClick={() => { void submit() }}>
          {submitting ? '撤回中…' : '确认撤回'}
        </button>
      </footer>
    </section>
  </div>
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}
