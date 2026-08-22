import type { CSSProperties } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ArkmeAuthSnapshot } from '../types.js'
import { ArkmeSurface } from './ArkmeSidebar.js'

export interface ArkmeConversationSurfaceProps {
  /** @deprecated The persistent shell never closes; retained for source compatibility. */
  close(): void
  initialAuth: ArkmeAuthSnapshot | undefined
  openedFromSession: SessionId | undefined
  useSessions: PropsRuntime<'conversation'>['useSessions']
  renderSlot: PropsRenderSlots<'arkme.directory.entry'>['renderSlot']
}

const root: CSSProperties = {
  width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden',
}

/**
 * Inline compatibility wrapper. The production path mounts Arkme directly in
 * DSH's conversation slot; this export no longer measures or portals over DSH.
 */
export function ArkmeConversationSurface({
  initialAuth, openedFromSession, useSessions, renderSlot,
}: ArkmeConversationSurfaceProps) {
  const currentSession = useSessions(state => state.current)
  return <section data-arkme-owned="persistent-conversation-compat" style={root} aria-label="Arkme 客户端">
    <ArkmeSurface
      productNavigation={false}
      initialAuth={initialAuth}
      currentSessionId={currentSession ?? openedFromSession}
      renderSlot={renderSlot}
    />
  </section>
}
