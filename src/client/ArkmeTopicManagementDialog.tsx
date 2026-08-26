import { useEffect, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import type { ArkmeSourceItem, ArkmeTopicDissolveProgress } from '../types.js'
import { arkmeTheme } from './arkme-theme.js'

interface ArkmeTopicDialogBaseProps {
  topic: ArkmeSourceItem
  submitting: boolean
  error?: string
  onCancel(): void
}

interface ArkmeTopicRenameDialogProps extends ArkmeTopicDialogBaseProps {
  onConfirm(title: string): void
}

interface ArkmeTopicDissolveDialogProps extends ArkmeTopicDialogBaseProps {
  childCount: number
  parent: ArkmeSourceItem | undefined
  recordCount: number | undefined
  progress?: ArkmeTopicDissolveProgress
  onMinimize?(): void
  onConfirm(): void
}

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16, boxSizing: 'border-box', background: 'var(--dsw-alias-bg-mask-1, rgba(19, 22, 26, 0.34))',
    backdropFilter: 'var(--dsw-mask-blur, blur(2px))', WebkitBackdropFilter: 'var(--dsw-mask-blur, blur(2px))',
  },
  dialog: {
    width: 420, maxWidth: 'calc(100vw - 32px)', padding: 16, boxSizing: 'border-box', borderRadius: 12,
    border: '1px solid var(--dsw-alias-border-inverted, rgba(0, 0, 0, 0.04))',
    background: arkmeTheme.menu, color: arkmeTheme.text, boxShadow: 'var(--dsw-shadow-lv3, 0 18px 50px rgba(18, 22, 27, 0.24))',
    font: 'inherit',
  },
  header: { display: 'flex', alignItems: 'center', gap: 12 },
  title: { flex: 1, margin: 0, fontSize: 18, lineHeight: '25px', fontWeight: 600 },
  close: {
    width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
    border: 0, borderRadius: 6, background: 'transparent', color: arkmeTheme.text, cursor: 'pointer',
    font: 'inherit', fontSize: 24, lineHeight: 1,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 },
  label: { color: arkmeTheme.secondary, fontSize: 13, lineHeight: '18px' },
  input: {
    width: '100%', height: 40, padding: '0 12px', boxSizing: 'border-box', border: `1px solid ${arkmeTheme.borderSoft}`,
    borderRadius: 8, outline: 0, background: arkmeTheme.input, color: arkmeTheme.text, font: 'inherit', fontSize: 14,
  },
  notice: { margin: '16px 0 0', color: arkmeTheme.secondary, fontSize: 13, lineHeight: '20px' },
  error: { margin: '10px 0 0', color: arkmeTheme.danger, fontSize: 12, lineHeight: '18px' },
  progress: { margin: '10px 0 0', color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 },
  button: { minWidth: 65, height: 36, padding: '0 14px', borderRadius: 8, cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 500 },
  cancel: { border: `1px solid ${arkmeTheme.borderSoft}`, background: 'transparent', color: arkmeTheme.text },
  confirm: { border: 0, background: '#17191c', color: arkmeTheme.foreground },
  danger: { border: 0, background: arkmeTheme.danger, color: arkmeTheme.foreground },
  disabled: { background: arkmeTheme.accentSoft, color: arkmeTheme.tertiary, cursor: 'default' },
}

function ArkmeTopicDialogFrame({
  title, submitting, onCancel, children,
}: { title: string; submitting: boolean; onCancel(): void; children: ReactNode }) {
  const cancelFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !submitting) onCancel()
  }
  const cancelFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !submitting) onCancel()
  }
  return <div style={styles.backdrop} onMouseDown={cancelFromBackdrop} onKeyDown={cancelFromKeyboard}>
    <section role="dialog" aria-modal="true" aria-label={title} style={styles.dialog}>
      <div style={styles.header}>
        <h2 style={styles.title}>{title}</h2>
        <button type="button" aria-label="关闭" style={styles.close} disabled={submitting} onClick={onCancel}>×</button>
      </div>
      {children}
    </section>
  </div>
}

export function ArkmeTopicRenameDialog({
  topic, submitting, error = '', onCancel, onConfirm,
}: ArkmeTopicRenameDialogProps) {
  const [title, setTitle] = useState(topic.displayName)
  useEffect(() => { setTitle(topic.displayName) }, [topic.displayName, topic.sourceRef])
  const normalized = title.trim()
  const canConfirm = normalized !== '' && !submitting
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (canConfirm) onConfirm(normalized)
  }
  return <ArkmeTopicDialogFrame title="重命名主题" submitting={submitting} onCancel={onCancel}>
    <form onSubmit={submit}>
      <label style={styles.field}>
        <span style={styles.label}>主题名称</span>
        <input
          autoFocus maxLength={100} style={styles.input} value={title} disabled={submitting}
          aria-invalid={error !== ''} onChange={event => { setTitle(event.currentTarget.value) }}
        />
      </label>
      {error !== '' && <p role="alert" style={styles.error}>{error}</p>}
      <div style={styles.actions}>
        <button type="button" style={{ ...styles.button, ...styles.cancel }} disabled={submitting} onClick={onCancel}>取消</button>
        <button type="submit" style={{ ...styles.button, ...styles.confirm, ...(!canConfirm ? styles.disabled : {}) }} disabled={!canConfirm}>{submitting ? '保存中…' : '保存'}</button>
      </div>
    </form>
  </ArkmeTopicDialogFrame>
}

export function ArkmeTopicDissolveDialog({
  topic, childCount, parent, recordCount, progress, submitting, error = '', onCancel, onConfirm, onMinimize,
}: ArkmeTopicDissolveDialogProps) {
  const recordLabel = recordCount === undefined ? '其中快记' : `${String(Math.max(0, recordCount))} 条快记`
  const recordDestination = parent === undefined ? '回到未分类' : `归入“${parent.displayName}”`
  const childDestination = parent === undefined ? '提升为一级主题' : `提升为“${parent.displayName}”的子主题`
  const progressText = progress === undefined || !submitting ? ''
    : progress.stage === 'reading' ? `正在读取快记 ${String(progress.completedRecordCount)} / ${String(progress.totalRecordCount)} 条…`
      : progress.stage === 'migrating' ? `正在迁移 ${String(progress.completedRecordCount)} / ${String(progress.totalRecordCount)} 条快记…`
        : progress.stage === 'promoting' ? '正在调整子主题…'
          : progress.stage === 'dissolving' ? '正在解散主题…'
            : progress.stage === 'completed' ? '解散完成'
              : '解散失败'
  return <ArkmeTopicDialogFrame title="解散主题" submitting={submitting} onCancel={onCancel}>
    <p style={styles.notice}>“{topic.displayName}”中的{recordLabel}将{recordDestination}。{childCount > 0 ? `${String(childCount)} 个子主题会${childDestination}。` : '此操作不会删除快记。'}</p>
    {progressText !== '' && <p role="status" style={styles.progress}>{progressText}</p>}
    {error !== '' && <p role="alert" style={styles.error}>{error}</p>}
    <div style={styles.actions}>
      <button type="button" style={{ ...styles.button, ...styles.cancel }}
        disabled={submitting && onMinimize === undefined} onClick={submitting ? onMinimize : onCancel}
      >{submitting ? '收起' : '取消'}</button>
      <button type="button" style={{ ...styles.button, ...styles.danger }} disabled={submitting} onClick={onConfirm}>{submitting ? '解散中…' : '解散主题'}</button>
    </div>
  </ArkmeTopicDialogFrame>
}
