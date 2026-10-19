import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { ArkmeNotificationCenter } from './ArkmeNotificationCenter.js'
import { suspendArkmeVisibleReadIntent } from './read-intent-visibility.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

/** Shares the inbox presentation while keeping both it and the underlying chat unread. */
export function ArkmeNotificationPreview({ onClose, onOpen }: { onClose(): void; onOpen(): void }) {
  const dialog = useRef<HTMLDivElement>(null)
  useLayoutEffect(suspendArkmeVisibleReadIntent, [])
  useLayoutEffect(() => {
    const previous = document.activeElement
    dialog.current?.focus({ preventScroll: true })
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  if (typeof document === 'undefined') return null
  return createPortal(<div data-arkme-notification-preview-backdrop
    style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(0,0,0,.3)' }}
    onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={tr('通知预览')}
      style={{ width: 520, maxWidth: '100%', height: 600, maxHeight: 'calc(100dvh - 48px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 16, background: arkmeTheme.base, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow }}
      onKeyDown={event => {
        if (event.target instanceof Element && event.target.closest('[aria-modal="true"]') !== dialog.current) return
        event.stopPropagation()
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); onClose() }
        if (event.key === 'Tab') {
          const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]')
          const first = controls?.[0], last = controls?.[controls.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus() }
        }
      }}>
      <ArkmeNotificationCenter preview headerAction={<button type="button" aria-label={tr('关闭通知预览')} onClick={onClose}
        style={{ justifySelf: 'end', display: 'flex', border: 0, padding: 6, background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer' }}><X size={20} /></button>} />
      <footer style={{ flexShrink: 0, padding: '8px 16px', borderTop: `1px solid ${arkmeTheme.borderSoft}`, textAlign: 'right' }}>
        <button type="button" onClick={() => { onClose(); onOpen() }} style={{ border: 0, padding: '6px 8px', background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', fontSize: 13 }}>{tr('打开通知')}</button>
      </footer>
    </div>
  </div>, document.body)
}
