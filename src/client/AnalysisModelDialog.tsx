import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { tr, useArkmeLocale } from './locale.js'
import { arkmeTheme as colors } from './arkme-theme.js'
type RecordingDropdownAnchor = { left: number; right: number; top: number; bottom: number }
const styles: Record<string, CSSProperties> = {
  analysisDropdownButton: { height: 36, minWidth: 0, padding: '0 12px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${colors.border}`, borderRadius: 10, background: colors.input, color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 14, lineHeight: 1, textAlign: 'left' },
  analysisDropdownLabel: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  analysisDropdownBackdrop: { position: 'fixed', zIndex: 1_119, inset: 0, padding: 0, border: 0, background: 'transparent', cursor: 'default' },
  analysisDropdownMenu: { position: 'fixed', zIndex: 1_120, maxHeight: 360, padding: '4px 0', boxSizing: 'border-box', overflowY: 'auto', border: `1px solid ${colors.border}`, borderRadius: 16, background: colors.layer2, boxShadow: '0 8px 24px rgba(0,0,0,.18)' },
  analysisDropdownOption: { width: 'calc(100% - 8px)', minHeight: 34, margin: '4px', padding: '10px 16px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8, border: 0, borderRadius: 10, background: 'transparent', color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 14, lineHeight: 1, textAlign: 'left' },
  analysisDropdownBadge: { flex: 'none', padding: '4px 10px', borderRadius: 99, background: colors.subtle, color: colors.secondary, fontSize: 12, lineHeight: 1 },
  analysisDropdownCheck: { width: 18, height: 18, flex: 'none', display: 'grid', placeItems: 'center', color: colors.secondary },
  modelBackdrop: { position: 'fixed', zIndex: 1_100, inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.28)' },
  modelDialog: { width: 360, maxWidth: 'calc(100vw - 40px)', padding: '18px 20px', boxSizing: 'border-box', borderRadius: 14, background: colors.layer2, boxShadow: '0 16px 48px rgba(0,0,0,.2)' },
  modelDialogHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  modelDialogTitle: { margin: 0, color: colors.text, fontSize: 18, lineHeight: 1, fontWeight: 600 },
  modelDialogClose: { width: 36, height: 36, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 9, background: 'transparent', color: colors.secondary, cursor: 'pointer' },
  modelField: { marginTop: 18, display: 'flex', alignItems: 'center', gap: 10 },
  modelFieldLabel: { flexShrink: 0, whiteSpace: 'nowrap', color: colors.text, fontSize: 14, lineHeight: 1, fontWeight: 500 },
  modelDialogActions: { marginTop: 26, display: 'flex', justifyContent: 'flex-end', gap: 10 },
  modelDialogButton: { width: 72, height: 34, padding: 0, border: `1px solid ${colors.border}`, borderRadius: 9, background: 'transparent', color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 14, lineHeight: 1, fontWeight: 500 },
}
interface AnalysisDropdownOption {
  value: string
  label: string
  latest?: boolean
}

export function AnalysisDropdown({ ariaLabel, value, options, width, variant, autoFocus = false, onChange }: {
  ariaLabel: string
  value: string
  options: AnalysisDropdownOption[]
  width: number
  variant: 'version' | 'model'
  autoFocus?: boolean
  onChange(value: string): void
}) {
  useArkmeLocale()
  const [anchor, setAnchor] = useState<RecordingDropdownAnchor>()
  const selected = options.find(option => option.value === value) ?? (variant === 'version' ? options[0] : undefined)
  const open = anchor !== undefined
  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAnchor(undefined) }
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('keydown', closeOnEscape) }
  }, [open])
  const menuHeight = Math.min(360, options.length * 42 + 8)
  const viewport = typeof window === 'undefined' ? { width: 1_024, height: 768 } : { width: window.innerWidth, height: window.innerHeight }
  const menuLeft = anchor === undefined ? 0 : Math.min(Math.max(8, anchor.left), Math.max(8, viewport.width - width - 8))
  const menuTop = anchor === undefined ? 0 : anchor.bottom + 4 + menuHeight <= viewport.height - 8
    ? anchor.bottom + 4
    : Math.max(8, anchor.top - menuHeight - 4)
  const menu = anchor === undefined ? null : <>
    <button type="button" tabIndex={-1} aria-label={`关闭${ariaLabel}`} style={styles.analysisDropdownBackdrop} onClick={() => { setAnchor(undefined) }} />
    <div role="listbox" aria-label={tr("{v0}选项", { v0: ariaLabel })} style={{ ...styles.analysisDropdownMenu, left: menuLeft, top: menuTop, width }}>
      {options.map(option => {
        const isSelected = option.value === selected?.value
        return <button data-arkme-feedback="neutral" key={option.value} type="button" role="option" aria-selected={isSelected} title={option.label} style={{ ...styles.analysisDropdownOption, ...(variant === 'model' ? { paddingLeft: 20, paddingRight: 20 } : {}), ...(isSelected ? { background: colors.subtle } : {}) }} onClick={() => { onChange(option.value); setAnchor(undefined) }}>
          <span style={styles.analysisDropdownLabel}>{option.label}</span>
          {variant === 'version' && option.latest && <span style={styles.analysisDropdownBadge}>New</span>}
          {variant === 'model' && <span style={styles.analysisDropdownCheck}>{isSelected && <Check size={18} aria-hidden />}</span>}
        </button>
      })}
    </div>
  </>
  return <>
    <button data-arkme-feedback="neutral" type="button" autoFocus={autoFocus} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={options.length === 0} style={{ ...styles.analysisDropdownButton, width }} onClick={event => {
      if (open) { setAnchor(undefined); return }
      const rect = event.currentTarget.getBoundingClientRect()
      setAnchor({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
    }}><span style={styles.analysisDropdownLabel}>{selected?.label ?? (options.length ? tr('请选择模型') : tr('当前暂无可用模型'))}</span><CaretRight aria-hidden size={18} style={{ flex: 'none', transform: 'rotate(90deg)', color: colors.secondary }} /></button>
    {menu !== null && (typeof document === 'undefined' || document.body === undefined ? menu : createPortal(menu, document.body))}
  </>
}

export function AnalysisModelDialog({ ariaLabel, initialValue, options, onClose, onConfirm }: {
  ariaLabel: string
  initialValue: string
  options: AnalysisDropdownOption[]
  onClose(): void
  onConfirm(value: string): void
}) {
  useArkmeLocale()
  const [routeKey, setRouteKey] = useState(options.some(option => option.value === initialValue) ? initialValue : '')
  const dialog = <div style={styles.modelBackdrop} role="presentation" onKeyDown={event => { if (event.key === 'Escape') onClose() }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section role="dialog" aria-modal="true" aria-label={ariaLabel} style={styles.modelDialog}>
      <header style={styles.modelDialogHeader}><h2 style={styles.modelDialogTitle}>{tr("选择模型")}</h2><button data-arkme-feedback="neutral" type="button" aria-label={tr("关闭")} style={styles.modelDialogClose} onClick={onClose}><X size={20} aria-hidden /></button></header>
      <div style={styles.modelField}><span style={styles.modelFieldLabel}>{tr("模型：")}</span><AnalysisDropdown autoFocus ariaLabel={tr("选择生成模型")} value={routeKey} options={options} width={280} variant="model" onChange={setRouteKey} /></div>
      <footer style={styles.modelDialogActions}><button data-arkme-feedback="neutral" type="button" style={styles.modelDialogButton} onClick={onClose}>{tr("取消")}</button><button data-arkme-feedback="primary" type="button" disabled={routeKey === ''} style={{ ...styles.modelDialogButton, background: colors.primaryAction, color: colors.onPrimaryAction, borderColor: 'transparent', ...(routeKey === '' ? { opacity: .5, cursor: 'default' } : {}) }} onClick={() => { onConfirm(routeKey) }}>{tr("确认")}</button></footer>
    </section>
  </div>
  return typeof document === 'undefined' || document.body === undefined ? dialog : createPortal(dialog, document.body)
}
