import { useSyncExternalStore, type CSSProperties } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { ArkmeFooterAction, type ArkmeFooterActionProps } from './ArkmeFooterAction.js'
import { ArkmeOutgoingCallHost } from './ArkmeOutgoingCallHost.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeAttentionSummary } from './attention-summary-store.js'
import { useArkmeRealtimeClientEvents } from './realtime-client-events.js'
import { arkmeUi } from './ui-controller.js'

const styles: Record<string, CSSProperties> = {
  root: { width: '100%', minWidth: 0 },
}

/** The DSH sidebar owns only the Arkme entry; all Arkme product UI lives in the right workspace. */
export type ArkmeFooterDropdownProps = ArkmeFooterActionProps & PropsRenderSlots<'arkme.directory.entry'>

export function ArkmeFooterDropdown(props: ArkmeFooterDropdownProps) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getViewSnapshot, arkmeUi.getViewSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const attention = useSyncExternalStore(arkmeAttentionSummary.subscribe, arkmeAttentionSummary.getSnapshot, arkmeAttentionSummary.getSnapshot)
  const auth = authState.auth
  const unreadCount = auth?.status === 'authenticated' && attention.ready
    && attention.accountUserId === auth.userId
    ? attention.summary?.badgeCount ?? 0
    : 0
  useArkmeRealtimeClientEvents(auth, ui.authRevision, false)
  return <>
    <ArkmeOutgoingCallHost />
    <div style={{ ...styles.root, width: props.wide ? '100%' : 36 }}>
    <ArkmeFooterAction
      {...props}
      expanded
      loggedOut={authState.checked && (auth === undefined || !['authenticated', 'binding-required'].includes(auth.status))}
      bindingRequired={auth?.status === 'binding-required'}
      authenticated={auth?.status === 'authenticated'}
      authPending={!authState.checked || authState.busy}
      unreadCount={unreadCount}
    />
    </div>
  </>
}
