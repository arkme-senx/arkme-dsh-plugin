import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ArkmeAuthSnapshot } from '../types.js'
import { ArkmeSurface } from './ArkmeSidebar.js'

export interface ArkmeConversationSurfaceProps {
  close(): void
  initialAuth: ArkmeAuthSnapshot | undefined
  openedFromSession: SessionId | undefined
  useSessions: PropsRuntime<'sidebar.footer.action'>['useSessions']
  renderSlot: PropsRenderSlots<'arkme.directory.entry'>['renderSlot']
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
    border: '1px solid #e1e1e5', borderRadius: 22,
    backgroundColor: '#ffffff',
    background: '#ffffff',
    color: 'var(--dsw-alias-label-primary, #17191c)',
    boxShadow: '0 22px 70px rgba(24, 27, 34, .14), 0 2px 8px rgba(24, 27, 34, .08)',
    isolation: 'isolate',
  },
  content: { width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden' },
}

/** Fit Arkme into the host conversation workspace while preserving a restrained card margin. */
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

/** Plugin-owned three-column client surface mounted through the official sidebar entry. */
export function ArkmeConversationSurface({ close, initialAuth, openedFromSession, useSessions, renderSlot }: ArkmeConversationSurfaceProps) {
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
      id="arkme-product-workspace"
      data-arkme-owned="workspace-card"
      style={{ ...styles.card, ...frame }}
      role="dialog"
      aria-label="Arkme 客户端"
    >
      <main style={styles.content}><ArkmeSurface
        floating
        initialAuth={initialAuth}
        currentSessionId={openedFromSession}
        renderSlot={renderSlot}
      /></main>
    </section>,
    document.body,
  )
}
