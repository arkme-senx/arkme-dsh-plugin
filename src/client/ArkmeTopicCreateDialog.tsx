import { useState, type CSSProperties, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { arkmeTheme } from './arkme-theme.js'

export interface ArkmeTopicCreateDialogProps {
  mode: 'topic' | 'child'
  submitting: boolean
  error?: string
  onCancel: () => void
  onConfirm: (title: string) => void
}

export const ARKME_TOPIC_CREATE_ACTION_COLOR = '#09B83E'

const colors = {
  text: arkmeTheme.text,
  secondary: arkmeTheme.secondary,
  border: arkmeTheme.border,
  action: arkmeTheme.accent,
  actionText: 'var(--dsw-alias-label-primary-foreground, #ffffff)',
  surface: arkmeTheme.layer2,
  input: arkmeTheme.input,
}

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16, boxSizing: 'border-box', background: 'var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.24))',
    backdropFilter: 'var(--dsw-mask-blur, blur(2px))', WebkitBackdropFilter: 'var(--dsw-mask-blur, blur(2px))',
  },
  dialog: {
    width: 420, maxWidth: 'calc(100vw - 32px)', padding: 16, boxSizing: 'border-box', borderRadius: 12,
    border: '1px solid var(--dsw-alias-border-inverted, rgba(0, 0, 0, 0.04))',
    background: colors.surface, color: colors.text,
    boxShadow: 'var(--dsw-shadow-lv3, 0 18px 50px rgba(18, 22, 27, 0.24))', font: 'inherit',
  },
  header: { display: 'flex', alignItems: 'center', gap: 12 },
  title: { flex: 1, margin: 0, fontSize: 18, lineHeight: '25px', fontWeight: 600 },
  close: {
    width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, border: 0, borderRadius: 6, background: 'transparent', color: colors.text,
    cursor: 'pointer', font: 'inherit', fontSize: 24, lineHeight: 1,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 },
  label: { color: colors.secondary, fontSize: 13, lineHeight: '18px' },
  input: {
    width: '100%', height: 40, padding: '0 12px', boxSizing: 'border-box', border: `1px solid ${colors.border}`,
    borderRadius: 8, outline: 0, background: colors.input, color: colors.text, font: 'inherit',
    fontSize: 14, lineHeight: '20px',
  },
  error: { margin: '10px 0 0', color: arkmeTheme.danger, fontSize: 12, lineHeight: '18px' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 },
  button: {
    minWidth: 65, height: 36, padding: '0 14px', borderRadius: 8, cursor: 'pointer',
    font: 'inherit', fontSize: 14, fontWeight: 500,
  },
  cancel: { border: `1px solid ${colors.border}`, background: 'transparent', color: colors.text },
  confirm: { border: 0, background: colors.action, color: colors.actionText },
  confirmDisabled: {
    opacity: 0.4, cursor: 'not-allowed',
  },
}

export function ArkmeTopicCreateDialog({
  mode, submitting, error = '', onCancel, onConfirm,
}: ArkmeTopicCreateDialogProps) {
  const [title, setTitle] = useState('')
  const normalizedTitle = title.trim()
  const canConfirm = normalizedTitle !== '' && !submitting
  const dialogTitle = mode === 'child' ? '创建子主题' : '创建主题'

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (canConfirm) onConfirm(normalizedTitle)
  }
  const cancelFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !submitting) onCancel()
  }
  const cancelFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !submitting) onCancel()
  }

  return <div style={styles.backdrop} onMouseDown={cancelFromBackdrop} onKeyDown={cancelFromKeyboard}>
    <form
      role="dialog" aria-modal="true" aria-labelledby="arkme-topic-create-title"
      style={styles.dialog} onSubmit={submit}
    >
      <div style={styles.header}>
        <h2 id="arkme-topic-create-title" style={styles.title}>{dialogTitle}</h2>
        <button type="button" style={styles.close} aria-label="关闭" disabled={submitting} onClick={onCancel}>×</button>
      </div>
      <label style={styles.field}>
        <span style={styles.label}>主题名称</span>
        <input
          autoFocus maxLength={100} style={styles.input} value={title} disabled={submitting}
          placeholder="请输入主题名称" aria-invalid={error !== ''}
          onChange={event => { setTitle(event.currentTarget.value) }}
        />
      </label>
      {error !== '' && <p role="alert" style={styles.error}>{error}</p>}
      <div style={styles.actions}>
        <button type="button" style={{ ...styles.button, ...styles.cancel }} disabled={submitting} onClick={onCancel}>取消</button>
        <button
          type="submit" disabled={!canConfirm}
          style={{ ...styles.button, ...styles.confirm, ...(!canConfirm ? styles.confirmDisabled : {}) }}
        >{submitting ? '创建中…' : '确认'}</button>
      </div>
    </form>
  </div>
}
