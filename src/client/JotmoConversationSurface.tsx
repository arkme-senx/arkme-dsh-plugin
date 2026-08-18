import { useEffect, type CSSProperties } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { JotmoNavigation } from './JotmoVirtualWorkspace.js'
import { JotmoSurface } from './JotmoSidebar.js'

export interface JotmoConversationSurfaceInjected {
  close(): void
  openedFromSession: SessionId | undefined
}
export type JotmoConversationSurfaceProps = PropsRuntime<'conversation'> & InjectFace<JotmoConversationSurfaceInjected>

const styles: Record<string, CSSProperties> = {
  shell: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0,
    display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', overflow: 'hidden',
    background: 'var(--dsw-alias-bg-base, #fff)', color: 'var(--dsw-alias-label-primary, #17191c)',
  },
  navigation: {
    minWidth: 0, overflowY: 'auto', padding: '18px 12px', boxSizing: 'border-box',
    background: 'var(--dsw-specific-sidebar-fill, #f7f8fa)', borderRight: '1px solid var(--dsw-alias-border-l1, #e2e5e9)',
  },
  navHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px 14px' },
  navTitle: { margin: 0, fontSize: 15, fontWeight: 650 },
  close: {
    width: 28, height: 28, border: 0, borderRadius: 8, background: 'transparent', color: 'inherit',
    cursor: 'pointer', fontSize: 20, lineHeight: '28px',
  },
  content: { minWidth: 0, minHeight: 0, overflow: 'hidden' },
}

/** Official conversation-slot replacement; disposal restores the native DSH conversation entry. */
export function JotmoConversationSurface({ close, openedFromSession, useSessions }: JotmoConversationSurfaceProps) {
  const currentSession = useSessions(state => state.current)
  useEffect(() => {
    if (currentSession !== openedFromSession) close()
  }, [close, currentSession, openedFromSession])
  return (
    <div style={styles.shell} role="region" aria-label="即我">
      <aside style={styles.navigation}>
        <div style={styles.navHeader}>
          <h2 style={styles.navTitle}>即我</h2>
          <button type="button" style={styles.close} aria-label="关闭即我" title="关闭即我" onClick={close}>×</button>
        </div>
        <JotmoNavigation />
      </aside>
      <main style={styles.content}><JotmoSurface /></main>
    </div>
  )
}
