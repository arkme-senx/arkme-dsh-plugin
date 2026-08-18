import { useEffect, type CSSProperties } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { ArkmeSurface } from './ArkmeSidebar.js'

export interface ArkmeConversationSurfaceInjected {
  close(): void
  openedFromSession: SessionId | undefined
}
export type ArkmeConversationSurfaceProps = PropsRuntime<'conversation'> & InjectFace<ArkmeConversationSurfaceInjected>

const styles: Record<string, CSSProperties> = {
  shell: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0,
    display: 'flex', overflow: 'hidden',
    background: 'var(--dsw-alias-bg-base, #fff)', color: 'var(--dsw-alias-label-primary, #17191c)',
  },
  content: { flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' },
}

/** Official conversation-slot replacement; disposal restores the native DSH conversation entry. */
export function ArkmeConversationSurface({ close, openedFromSession, useSessions }: ArkmeConversationSurfaceProps) {
  const currentSession = useSessions(state => state.current)
  useEffect(() => {
    if (currentSession !== openedFromSession) close()
  }, [close, currentSession, openedFromSession])
  return (
    <div style={styles.shell} role="region" aria-label="Arkme">
      <main style={styles.content}><ArkmeSurface /></main>
    </div>
  )
}
