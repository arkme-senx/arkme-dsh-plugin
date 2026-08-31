import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type {
  ArkmeMessageReportResult, ArkmeMessageReportType, ArkmeSourceItem, ArkmeTimelineItem,
} from '../types.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'

const REPORT_OPTIONS: ReadonlyArray<{ type: ArkmeMessageReportType; label: string }> = [
  { type: 1, label: '垃圾广告' },
  { type: 2, label: '违法违规' },
  { type: 3, label: '不友善内容' },
  { type: 4, label: '其他' },
]
const REPORT_TIMEOUT_MILLIS = 12_000

const styles = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 10_300, display: 'grid', placeItems: 'center', padding: 16,
    boxSizing: 'border-box', background: 'var(--dsw-alias-bg-mask-1, rgba(19, 22, 26, 0.34))',
    backdropFilter: 'var(--dsw-mask-blur, blur(2px))', WebkitBackdropFilter: 'var(--dsw-mask-blur, blur(2px))',
  },
  dialog: {
    position: 'relative', width: 'min(420px, 100%)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
    boxSizing: 'border-box', border: `1px solid ${arkmeTheme.border}`, borderRadius: 14,
    background: arkmeTheme.base, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow,
  },
  header: { padding: '22px 52px 14px 22px' },
  title: { margin: 0, fontSize: 18, lineHeight: '25px', fontWeight: 650 },
  subtitle: { margin: '7px 0 0', color: arkmeTheme.secondary, fontSize: 13, lineHeight: '20px' },
  close: {
    position: 'absolute', top: 14, right: 14, width: 32, height: 32, display: 'grid', placeItems: 'center',
    padding: 0, border: 0, borderRadius: 8, background: 'transparent', color: arkmeTheme.secondary,
    cursor: 'pointer', fontSize: 24, lineHeight: 1,
  },
  body: { padding: '0 22px 22px' },
  preview: {
    margin: '0 0 16px', padding: '10px 12px', borderRadius: 10, background: arkmeTheme.layer1,
    color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px', overflow: 'hidden',
    whiteSpace: 'nowrap', textOverflow: 'ellipsis',
  },
  group: { display: 'grid', gap: 8 },
  option: {
    width: '100%', minHeight: 42, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px',
    boxSizing: 'border-box', border: `1px solid ${arkmeTheme.border}`, borderRadius: 10,
    background: arkmeTheme.base, color: arkmeTheme.text, cursor: 'pointer', fontSize: 14, textAlign: 'left',
  },
  optionSelected: { borderColor: arkmeTheme.info, background: arkmeTheme.infoSoft },
  radio: {
    width: 16, height: 16, flex: 'none', display: 'grid', placeItems: 'center', boxSizing: 'border-box',
    border: `1.5px solid ${arkmeTheme.tertiary}`, borderRadius: '50%',
  },
  radioSelected: { borderColor: arkmeTheme.info },
  radioDot: { width: 8, height: 8, borderRadius: '50%', background: arkmeTheme.info },
  fieldLabel: { display: 'block', marginTop: 18, color: arkmeTheme.text, fontSize: 13, lineHeight: '20px', fontWeight: 600 },
  optional: { marginLeft: 5, color: arkmeTheme.tertiary, fontWeight: 400 },
  textarea: {
    width: '100%', minHeight: 92, marginTop: 8, padding: '10px 12px', resize: 'vertical', boxSizing: 'border-box',
    border: `1px solid ${arkmeTheme.border}`, borderRadius: 10, outline: 'none', background: arkmeTheme.input,
    color: arkmeTheme.text, font: 'inherit', fontSize: 13, lineHeight: '20px',
  },
  count: { marginTop: 4, color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '16px', textAlign: 'right' },
  error: { marginTop: 12, padding: '9px 11px', borderRadius: 8, background: arkmeTheme.dangerSoft, color: arkmeTheme.danger, fontSize: 12, lineHeight: '18px' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 },
  button: {
    minWidth: 82, height: 36, padding: '0 16px', border: `1px solid ${arkmeTheme.border}`,
    borderRadius: 9, background: arkmeTheme.base, color: arkmeTheme.text, cursor: 'pointer', fontSize: 13,
  },
  submit: { borderColor: 'transparent', background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction },
  disabled: { cursor: 'not-allowed', opacity: .45 },
} satisfies Record<string, CSSProperties>

function reportErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return '举报提交失败，请稍后重试'
}

export function arkmeCanReportTimelineMessage(
  source: ArkmeSourceItem | undefined,
  item: ArkmeTimelineItem,
): boolean {
  return source?.kind === 'group_chat' && !item.isMe && (item.messageRef?.trim() ?? '') !== ''
}

export function ArkmeMessageReportDialog({
  item,
  onClose,
  onSubmitted,
}: {
  item: ArkmeTimelineItem
  onClose: () => void
  onSubmitted: (result: ArkmeMessageReportResult) => void
}) {
  const [reportType, setReportType] = useState<ArkmeMessageReportType>()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [requestUid] = useState(() => crypto.randomUUID())
  const closeRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLElement>()
  const requestRef = useRef<AbortController>()
  const submittingRef = useRef(false)
  const mountedRef = useRef(true)
  const onCloseRef = useRef(onClose)
  const onSubmittedRef = useRef(onSubmitted)
  onCloseRef.current = onClose
  onSubmittedRef.current = onSubmitted
  const normalizedReason = reason.trim()
  const canSubmit = reportType !== undefined && (reportType !== 4 || normalizedReason !== '') && !submitting

  const close = useCallback(() => {
    if (!submittingRef.current) onCloseRef.current()
  }, [])

  useEffect(() => { submittingRef.current = submitting }, [submitting])

  useEffect(() => {
    if (typeof document === 'undefined') return
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    closeRef.current?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      triggerRef.current?.focus({ preventScroll: true })
    }
  }, [close])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestRef.current?.abort()
    }
  }, [])

  const submit = useCallback(async () => {
    const messageRef = item.messageRef?.trim() ?? ''
    if (submittingRef.current || !canSubmit || reportType === undefined || messageRef === '') return
    const controller = new AbortController()
    requestRef.current?.abort()
    requestRef.current = controller
    const timeout = globalThis.setTimeout(() => { controller.abort('message-report-timeout') }, REPORT_TIMEOUT_MILLIS)
    submittingRef.current = true
    setSubmitting(true)
    setError('')
    let result: ArkmeMessageReportResult | undefined
    try {
      result = await callArkme<ArkmeMessageReportResult>('source.message-report', {
        messageRef,
        reportType,
        ...(normalizedReason === '' ? {} : { reason: normalizedReason }),
        requestUid,
      }, controller.signal)
    } catch (caught) {
      if (mountedRef.current) {
        setError(controller.signal.aborted ? '举报提交超时，请重试' : reportErrorMessage(caught))
      }
    } finally {
      globalThis.clearTimeout(timeout)
      if (requestRef.current === controller) requestRef.current = undefined
      submittingRef.current = false
      if (mountedRef.current) setSubmitting(false)
    }
    if (result !== undefined && mountedRef.current) onSubmittedRef.current(result)
  }, [canSubmit, item.messageRef, normalizedReason, reportType, requestUid])

  const preview = item.textContent.trim() || item.title.trim() || '非文本消息'
  const dialog = <div
    style={styles.backdrop}
    role="presentation"
    onMouseDown={event => { if (event.target === event.currentTarget) close() }}
  >
    <section role="dialog" aria-modal="true" aria-labelledby="arkme-message-report-title" style={styles.dialog}>
      <button ref={closeRef} type="button" aria-label="关闭举报" style={{ ...styles.close, ...(submitting ? styles.disabled : {}) }} disabled={submitting} onClick={close}>×</button>
      <header style={styles.header}>
        <h2 id="arkme-message-report-title" style={styles.title}>举报和反馈</h2>
        <p style={styles.subtitle}>你的反馈可以帮助我们持续优化，Arkme 会及时处理。</p>
      </header>
      <div style={styles.body}>
        <p style={styles.preview} title={preview}>{preview}</p>
        <div role="radiogroup" aria-label="举报类型" style={styles.group}>
          {REPORT_OPTIONS.map(option => {
            const selected = reportType === option.type
            return <button
              key={option.type}
              type="button"
              role="radio"
              aria-label={option.label}
              aria-checked={selected}
              disabled={submitting}
              style={{ ...styles.option, ...(selected ? styles.optionSelected : {}), ...(submitting ? styles.disabled : {}) }}
              onClick={() => { setReportType(option.type); setError('') }}
            ><span style={{ ...styles.radio, ...(selected ? styles.radioSelected : {}) }} aria-hidden>{selected ? <span style={styles.radioDot} /> : null}</span>{option.label}</button>
          })}
        </div>
        <label style={styles.fieldLabel}>
          举报补充说明
          <span style={styles.optional}>{reportType === 4 ? '必填' : '选填'}</span>
          <textarea
            aria-label="举报补充说明"
            value={reason}
            disabled={submitting}
            placeholder="请描述具体问题"
            style={styles.textarea}
            onChange={event => { setReason(Array.from(event.currentTarget.value).slice(0, 500).join('')); setError('') }}
          />
        </label>
        <div style={styles.count}>{String(Array.from(reason).length)}/500</div>
        {error !== '' ? <div role="alert" style={styles.error}>{error}</div> : null}
        <footer style={styles.footer}>
          <button type="button" style={{ ...styles.button, ...(submitting ? styles.disabled : {}) }} disabled={submitting} onClick={close}>取消</button>
          <button
            type="button"
            aria-label="提交举报"
            style={{ ...styles.button, ...styles.submit, ...(!canSubmit ? styles.disabled : {}) }}
            disabled={!canSubmit}
            onClick={submit}
          >{submitting ? '提交中…' : '提交'}</button>
        </footer>
      </div>
    </section>
  </div>
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}
