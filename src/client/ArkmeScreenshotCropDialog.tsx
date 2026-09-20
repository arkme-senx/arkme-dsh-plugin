import { tr, useArkmeLocale } from './locale.js'
import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { arkmeTheme as theme } from './arkme-theme.js'
import { cropScreenshot, screenshotPixelRect, screenshotSelection, type ScreenshotFrame, type ScreenshotRect } from './browser-screenshot.js'

const styles = {
  mask: { position: 'fixed', inset: 0, zIndex: 10400, display: 'grid', placeItems: 'center', padding: 16, boxSizing: 'border-box', background: 'rgba(0,0,0,.55)' },
  dialog: { width: 'min(1000px, 100%)', maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto', borderRadius: 16, border: `1px solid ${theme.border}`, background: theme.base, color: theme.text, boxShadow: theme.shadow, padding: 16, boxSizing: 'border-box', outline: 'none' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  button: { padding: '8px 14px', border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.elevated, color: theme.text, font: 'inherit', cursor: 'pointer' },
  footer: { marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'flex-end' },
  stage: { display: 'flex', justifyContent: 'center', padding: 12, borderRadius: 10, background: theme.layer2, overflow: 'hidden', marginTop: 12 },
} satisfies Record<string, CSSProperties>

export function ArkmeScreenshotCropDialog({ frame, rootRef, onClose, onComplete }: {
  frame: ScreenshotFrame
  rootRef: RefObject<HTMLDivElement>
  onClose(): void
  onComplete(blob: Blob): void
}) {
  useArkmeLocale()
  const titleId = useId()
  const dialog = useRef<HTMLElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const start = useRef<{ x: number; y: number; id: number }>()
  const [selection, setSelection] = useState<ScreenshotRect>()
  const [url, setUrl] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const submitting = useRef(false)
  const latestClose = useRef(onClose); latestClose.current = onClose
  useEffect(() => {
    const value = URL.createObjectURL(frame.blob)
    setUrl(value)
    return () => { generation.current += 1; URL.revokeObjectURL(value) }
  }, [frame])
  useEffect(() => {
    const element = dialog.current
    element?.focus({ preventScroll: true })
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); latestClose.current()
      } else if (event.key === 'Tab') {
        const controls = element?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
        if (!controls?.length) return
        const first = controls[0]!, last = controls[controls.length - 1]!
        if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    const focus = (event: FocusEvent) => { if (element && !element.contains(event.target as Node)) element.focus({ preventScroll: true }) }
    document.addEventListener('keydown', keyboard, true)
    document.addEventListener('focusin', focus)
    return () => { document.removeEventListener('keydown', keyboard, true); document.removeEventListener('focusin', focus) }
  }, [])
  const pixels = selection && screenshotPixelRect(selection, frame.width, frame.height)
  const valid = !!pixels && pixels.width > 1 && pixels.height > 1
  const confirm = async (full: boolean) => {
    if (submitting.current || !loaded || (!full && !valid)) return
    submitting.current = true; setBusy(true); setError('')
    const version = generation.current
    try {
      const blob = full ? frame.blob : await cropScreenshot(image.current!, frame, selection!)
      if (generation.current === version) onComplete(blob)
    } catch (caught) {
      if (generation.current === version) setError(caught instanceof Error ? caught.message : '裁剪失败，请重试。')
    } finally {
      if (generation.current === version) { submitting.current = false; setBusy(false) }
    }
  }
  const content = <div ref={rootRef} style={styles.mask} data-arkme-screenshot-dialog="true" data-arkme-notification-blocking-overlay="true"
    onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialog} style={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header style={styles.header}>
        <h2 id={titleId} style={{ margin: 0, fontSize: 17 }}>{tr("截图")}</h2>
        <button type="button" data-arkme-feedback="neutral" aria-label={tr("关闭截图")} style={{ ...styles.button, padding: 6, display: 'grid', border: 0 }} onClick={onClose}><X size={20} /></button>
      </header>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: theme.secondary }}>{tr("屏幕共享已停止。拖动框选需要的区域，或使用整张图片。")}</p>
      <div style={styles.stage}>
        <div data-arkme-screenshot-image="true" style={{ position: 'relative', width: `min(100%, ${60 * frame.width / frame.height}vh)`, aspectRatio: `${frame.width} / ${frame.height}`, cursor: busy ? 'wait' : 'crosshair', touchAction: 'none', userSelect: 'none', overflow: 'hidden' }}
          onPointerDown={event => {
            if (event.button !== 0 || !loaded || busy || start.current) return
            event.preventDefault()
            const bounds = event.currentTarget.getBoundingClientRect()
            if (!bounds.width || !bounds.height) return
            const point = { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height }
            start.current = { ...point, id: event.pointerId }
            setSelection(screenshotSelection(point, point))
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={event => {
            if (start.current?.id !== event.pointerId) return
            const bounds = event.currentTarget.getBoundingClientRect()
            if (!bounds.width || !bounds.height) return
            setSelection(screenshotSelection(start.current, { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height }))
          }}
          onPointerUp={event => {
            if (start.current?.id !== event.pointerId) return
            start.current = undefined
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => { start.current = undefined; setSelection(undefined) }}
          onLostPointerCapture={() => { start.current = undefined }}>
          {url && <img ref={image} src={url} alt={tr("待裁剪的截图")} draggable={false} onLoad={() => setLoaded(true)} onError={() => setError('截图预览失败，请取消后重新截屏。')}
            style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} />}
          {selection && <div data-arkme-screenshot-selection="true" style={{ position: 'absolute', pointerEvents: 'none', boxSizing: 'border-box',
            left: `${selection.x * 100}%`, top: `${selection.y * 100}%`, width: `${selection.width * 100}%`, height: `${selection.height * 100}%`,
            border: '2px solid #6b9eff', boxShadow: '0 0 0 9999px rgba(0,0,0,.48)' }} />}
        </div>
      </div>
      {error && <p role="alert" style={{ color: theme.danger, fontSize: 13 }}>{error}</p>}
      <footer style={styles.footer}>
        <span role="status" style={{ marginRight: 'auto', color: theme.secondary, fontSize: 12 }}>{valid ? `${pixels.width} × ${pixels.height}` : '尚未选择裁剪区域'}</span>
        <button type="button" data-arkme-feedback="neutral" style={styles.button} onClick={onClose}>{tr("取消")}</button>
        <button type="button" data-arkme-feedback="neutral" style={styles.button} disabled={!loaded || busy} onClick={() => { void confirm(true) }}>{tr("使用整张")}</button>
        <button type="button" data-arkme-feedback="primary" style={{ ...styles.button, background: theme.primaryAction, color: theme.onPrimaryAction, opacity: !loaded || busy || !valid ? .45 : 1 }} disabled={!loaded || busy || !valid} onClick={() => { void confirm(false) }}>{busy ? tr("处理中…") : '完成裁剪'}</button>
      </footer>
    </section>
  </div>
  return createPortal(content, document.body)
}
