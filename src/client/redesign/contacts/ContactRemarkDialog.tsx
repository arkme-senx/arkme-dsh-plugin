import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react/X'
import type { ArkmeDirectoryContactProfile } from '../../../types.js'

export type ContactRemarkSaver = (contactRef: string, remark: string, signal: AbortSignal) => Promise<ArkmeDirectoryContactProfile>

export function ContactRemarkDialog({ profile, saveRemark, onClose, onSaved }: {
  profile: ArkmeDirectoryContactProfile
  saveRemark: ContactRemarkSaver
  onClose(): void
  onSaved(profile: ArkmeDirectoryContactProfile): void
}) {
  const id = useId()
  const [draft, setDraft] = useState(profile.remark)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLFormElement>(null)
  const pendingRef = useRef<AbortController>()
  const activeRef = useRef(true)

  useEffect(() => {
    activeRef.current = true
    const previous = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    inputRef.current?.focus({ preventScroll: true })
    inputRef.current?.select()
    return () => {
      activeRef.current = false
      pendingRef.current?.abort()
      if (previous?.isConnected === true) previous.focus({ preventScroll: true })
    }
  }, [])

  const submit = async () => {
    if (pendingRef.current !== undefined) return
    const remark = draft.trim()
    if (Array.from(remark).length > 100) { setError('备注名最多 100 个字符'); return }
    const controller = new AbortController()
    pendingRef.current = controller
    inputRef.current?.focus({ preventScroll: true })
    setBusy(true)
    setError(undefined)
    try {
      const updated = await saveRemark(profile.contactRef, remark, controller.signal)
      if (!activeRef.current || controller.signal.aborted) return
      if (updated.contactRef !== profile.contactRef) throw new Error('备注保存响应不匹配，请重试')
      onSaved(updated)
    } catch (reason) {
      if (activeRef.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : '备注保存失败，请重试')
    } finally {
      if (pendingRef.current === controller) pendingRef.current = undefined
      if (activeRef.current) setBusy(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation()
      if (!busy) onClose()
    }
    if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
    if (event.key !== 'Tab' || typeof document === 'undefined') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
    const first = focusable?.[0]
    const last = focusable?.[focusable.length - 1]
    if (first === undefined) { event.preventDefault(); return }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const dialog = <div className="arkme-contact-remark-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !busy) onClose()
  }}>
    <form ref={dialogRef} className="arkme-contact-remark-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-busy={busy}
      onKeyDown={onKeyDown} onSubmit={event => { event.preventDefault(); void submit() }}>
      <header className="arkme-contact-remark-header">
        <h2 id={`${id}-title`}>修改备注</h2>
        <button type="button" className="arkme-contact-remark-close" aria-label="关闭修改备注" disabled={busy} onClick={onClose}><X size={20} aria-hidden /></button>
      </header>
      <label className="arkme-contact-remark-label" htmlFor={`${id}-input`}>备注名</label>
      <input ref={inputRef} className="arkme-contact-remark-input" id={`${id}-input`} value={draft} placeholder="输入备注名" maxLength={100}
        readOnly={busy} autoComplete="off" aria-invalid={error !== undefined} aria-describedby={error === undefined ? undefined : `${id}-error`}
        onChange={event => { setDraft(event.target.value); setError(undefined) }} />
      {error !== undefined && <p className="arkme-contact-remark-error" id={`${id}-error`} role="alert">{error}</p>}
      <footer className="arkme-contact-remark-footer">
        <button type="button" className="arkme-contact-remark-cancel" disabled={busy} onClick={onClose}>取消</button>
        <button type="submit" className="arkme-contact-remark-confirm" disabled={busy}>{busy ? '保存中…' : '确认'}</button>
      </footer>
    </form>
  </div>
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}
