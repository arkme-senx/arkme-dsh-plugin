import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { ArkmeFooterAction } from './ArkmeFooterAction.js'
import { ArkmeFooterDropdown } from './ArkmeFooterDropdown.js'
import { ArkmeSettingsRow } from './ArkmeSettingsRow.js'
import { watchOfficialConversationSelection, watchOfficialNewSession } from './new-session-activation.js'
import { arkmePluginUpdateStore } from './plugin-update-store.js'
import { arkmeUi } from './ui-controller.js'

export const inject = ['slots']

/** Register Arkme only through official additive DSH slots. */
export function apply(ctx: ClientContext): void {
  let openedFromSession: SessionId | undefined
  let stopWatchingConversationSelection: (() => void) | undefined
  let stopWatchingNewSession: (() => void) | undefined
  const closeSurface = () => {
    openedFromSession = undefined
    arkmeUi.deactivateSurface()
  }
  const closeArkme = () => {
    const stopConversationSelection = stopWatchingConversationSelection
    stopWatchingConversationSelection = undefined
    stopConversationSelection?.()
    const stop = stopWatchingNewSession
    stopWatchingNewSession = undefined
    stop?.()
    closeSurface()
    arkmeUi.close()
  }
  const activateSurface = (session: SessionId | undefined) => {
    openedFromSession = session
    arkmeUi.activateSurface()
  }
  const watchOfficialNavigation = () => {
    if (stopWatchingConversationSelection === undefined) {
      stopWatchingConversationSelection = watchOfficialConversationSelection(closeSurface)
    }
    if (stopWatchingNewSession === undefined) stopWatchingNewSession = watchOfficialNewSession(closeArkme)
  }
  const openArkme = (session: SessionId | undefined) => {
    watchOfficialNavigation()
    const retained = arkmeUi.getSnapshot().selectedSource
    if (retained !== undefined) arkmeUi.open()
    else arkmeUi.focusSendToSelf()
    activateSurface(session)
  }
  const openLogin = (session: SessionId | undefined) => {
    watchOfficialNavigation()
    openedFromSession = session
    arkmeUi.showLoginSurface()
  }
  const toggleArkme = (openedFromSession: SessionId | undefined, authenticated: boolean) => {
    if (arkmeUi.getSnapshot().open) { closeArkme(); return }
    if (authenticated) openArkme(openedFromSession)
    else openLogin(openedFromSession)
  }

  ctx.effect(() => () => { closeArkme() }, 'dsh-arkme: close floating surface on dispose')
  ctx.effect(() => arkmePluginUpdateStore.start(), 'dsh-arkme: client plugin update status')

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'arkme',
    order: 70,
    label: 'Arkme',
    inject: () => ({
      toggle: toggleArkme,
      activate: activateSurface,
      closeSurface,
      surfaceSession: () => openedFromSession,
    }),
  }, ArkmeFooterDropdown))

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'arkme-account',
    order: 80,
    label: 'Arkme',
  }, ArkmeSettingsRow))
}

export { ArkmeFooterAction } from './ArkmeFooterAction.js'
export { ArkmeFooterDropdown } from './ArkmeFooterDropdown.js'
export { ArkmeOutgoingCallHost, outgoingCallModalLayout } from './ArkmeOutgoingCallHost.js'
export { ArkmePrivateCallMenu } from './ArkmePrivateCallMenu.js'
export { ArkmeSettingsRow } from './ArkmeSettingsRow.js'
export { ArkmeConversationSurface } from './ArkmeConversationSurface.js'
export { ArkmeRecordingSurface } from './ArkmeRecordingSurface.js'
export { ArkmeSearchSurface } from './ArkmeSearchSurface.js'
export { ArkmeArkoSurface } from './ArkmeArkoSurface.js'
export { ArkmeSurface } from './ArkmeSidebar.js'
export { ArkmeNavigation } from './ArkmeVirtualWorkspace.js'
export { outgoingCallUi } from './outgoing-call-ui-controller.js'
export { ArkmePluginUpdateStore, arkmePluginUpdateStore } from './plugin-update-store.js'
export {
  isOfficialConversationTarget, isOfficialNewSessionTarget,
  watchOfficialConversationSelection, watchOfficialNewSession,
} from './new-session-activation.js'
