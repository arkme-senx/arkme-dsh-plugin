import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ArkmeAuthSnapshot } from '../types.js'
import { ArkmeSurface } from './ArkmeSidebar.js'

export interface ArkmeConversationSurfaceProps {
  close(): void
  initialAuth: ArkmeAuthSnapshot | undefined
  openedFromSession: SessionId | undefined
  useSessions: PropsRuntime<'sidebar.footer.action'>['useSessions']
}

export interface ArkmeFloatingFrame {
  left: number
  top: number
  width: number
  height: number
}

const styles: Record<string, CSSProperties> = {
  card: {
    position: 'fixed', zIndex: 50, minWidth: 0, minHeight: 0, overflow: 'hidden', pointerEvents: 'auto',
    boxSizing: 'border-box',
    border: '1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, .58))', borderRadius: 18,
    backgroundColor: 'var(--dsw-alias-bg-base, rgba(255, 255, 255, .86))',
    background: 'color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 86%, transparent)',
    color: 'var(--dsw-alias-label-primary, #17191c)',
    backdropFilter: 'blur(24px) saturate(1.12)', WebkitBackdropFilter: 'blur(24px) saturate(1.12)',
    boxShadow: '0 18px 52px rgba(20, 24, 31, .13), 0 2px 10px rgba(20, 24, 31, .05)',
    isolation: 'isolate',
  },
  content: { width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden' },
  close: {
    position: 'absolute', zIndex: 2, top: 14, right: 16, width: 28, height: 28, padding: 0,
    display: 'grid', placeItems: 'center', border: 0, borderRadius: 999,
    background: 'transparent', color: 'var(--dsw-alias-label-tertiary, #9097a1)', opacity: .62,
    cursor: 'pointer', transition: 'background-color 120ms ease, color 120ms ease, opacity 120ms ease',
  },
}

/** Keep a visible margin around Arkme so the native DSH conversation remains perceptible behind it. */
export function calculateArkmeFloatingFrame(bounds: {
  left: number
  top: number
  width: number
  height: number
}): ArkmeFloatingFrame {
  const inset = 16
  const width = Math.max(0, bounds.width - inset * 2)
  return {
    left: bounds.left + (bounds.width - width) / 2,
    top: bounds.top + inset,
    width,
    height: Math.max(0, bounds.height - inset * 2),
  }
}

function conversationFrameElement(): HTMLElement | undefined {
  let element = document.querySelector<HTMLElement>('[data-slot="conversation"]')?.parentElement
  while (element !== null && element !== undefined) {
    const bounds = element.getBoundingClientRect()
    if (bounds.width > 0 && bounds.height > 0) return element
    element = element.parentElement
  }
  return undefined
}

function measureFloatingFrame(element: HTMLElement): ArkmeFloatingFrame {
  const bounds = element.getBoundingClientRect()
  return calculateArkmeFloatingFrame(bounds)
}

/** Non-modal portal that floats above, but never replaces, the native DSH conversation. */
export function ArkmeConversationSurface({ close, initialAuth, openedFromSession, useSessions }: ArkmeConversationSurfaceProps) {
  const currentSession = useSessions(state => state.current)
  const [frame, setFrame] = useState<ArkmeFloatingFrame>()

  useEffect(() => {
    if (currentSession !== openedFromSession) close()
  }, [close, currentSession, openedFromSession])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [close])
  useLayoutEffect(() => {
    const element = conversationFrameElement()
    if (element === undefined) return
    const update = () => { setFrame(measureFloatingFrame(element)) }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  if (frame === undefined) return null
  return createPortal(
    <section
      style={{ ...styles.card, ...frame }}
      role="dialog"
      aria-label="Arkme 悬浮对话"
    >
      <button
        type="button"
        style={styles.close}
        aria-label="关闭 Arkme 悬浮对话"
        title="关闭"
        onMouseEnter={event => {
          event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(23, 25, 28, .06))'
          event.currentTarget.style.color = 'var(--dsw-alias-label-secondary, #68707c)'
          event.currentTarget.style.opacity = '1'
        }}
        onMouseLeave={event => {
          event.currentTarget.style.background = 'transparent'
          event.currentTarget.style.color = 'var(--dsw-alias-label-tertiary, #9097a1)'
          event.currentTarget.style.opacity = '.62'
        }}
        onFocus={event => {
          event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(23, 25, 28, .06))'
          event.currentTarget.style.color = 'var(--dsw-alias-label-secondary, #68707c)'
          event.currentTarget.style.opacity = '1'
        }}
        onBlur={event => {
          event.currentTarget.style.background = 'transparent'
          event.currentTarget.style.color = 'var(--dsw-alias-label-tertiary, #9097a1)'
          event.currentTarget.style.opacity = '.62'
        }}
        onClick={close}
      >
        <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
      </button>
      <main style={styles.content}><ArkmeSurface floating initialAuth={initialAuth} /></main>
    </section>,
    document.body,
  )
}
