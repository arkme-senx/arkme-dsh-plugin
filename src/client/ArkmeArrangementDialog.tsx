import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { tr } from './locale.js'
import css from './arrangement-recognition.css?inline'

interface Props {
  title: string
  description: string
  busy: boolean
  onClose(): void
  children: ReactNode
  className?: string
  trapPaused?: boolean
}

export function ArkmeArrangementDialog({
  title,
  description,
  busy,
  onClose,
  children,
  className = '',
  trapPaused = false,
}: Props) {
  const panel = useRef<HTMLElement>(null),
    headingId = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  return createPortal(
    <div
      className="arkme-recognition-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy && !trapPaused) onClose()
      }}
    >
      <style>{css}</style>
      <section
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={`arkme-recognition-settings ${className}`}
        onKeyDown={(event) => {
          if (trapPaused) return
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation()
            onClose()
          }
          if (event.key !== 'Tab') return
          const nodes = panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),a[href],summary,[tabindex="0"]',
          )
          if (!nodes?.length) {
            event.preventDefault()
            return
          }
          const first = nodes[0]!,
            last = nodes[nodes.length - 1]!
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === panel.current)
          ) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <header>
          <div>
            <h2 id={headingId}>{tr(title)}</h2>
            <p>{tr(description)}</p>
          </div>
          <button type="button" aria-label={tr('关闭')} disabled={busy} onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  )
}
