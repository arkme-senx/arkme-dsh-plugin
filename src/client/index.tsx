import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { ArkmeConversationSurface } from './ArkmeConversationSurface.js'
import { ArkmeFooterAction } from './ArkmeFooterAction.js'
import { ArkmeFooterDropdown } from './ArkmeFooterDropdown.js'
import { ArkmeSettingsRow } from './ArkmeSettingsRow.js'
import { watchOfficialNewSession } from './new-session-activation.js'
import { arkmeUi } from './ui-controller.js'

export const inject = ['slots']

/** Register Arkme only through official additive DSH slots. */
export function apply(ctx: ClientContext): void {
  let disposeArkmeConversation: (() => void) | undefined
  let stopWatchingNewSession: (() => void) | undefined
  const closeSurface = () => {
    const dispose = disposeArkmeConversation
    disposeArkmeConversation = undefined
    dispose?.()
    arkmeUi.deactivateSurface()
  }
  const closeArkme = () => {
    const stop = stopWatchingNewSession
    stopWatchingNewSession = undefined
    stop?.()
    closeSurface()
    arkmeUi.close()
  }
  const ensureSurface = (openedFromSession: SessionId | undefined) => {
    if (disposeArkmeConversation !== undefined) return
    disposeArkmeConversation = ctx.slots.register({
      name: 'conversation',
      priority: -10,
      inject: () => ({ close: closeSurface, openedFromSession }),
    }, ArkmeConversationSurface)
  }
  const activateSurface = (openedFromSession: SessionId | undefined) => {
    ensureSurface(openedFromSession)
    arkmeUi.activateSurface()
  }
  const openArkme = (openedFromSession: SessionId | undefined) => {
    if (stopWatchingNewSession === undefined) stopWatchingNewSession = watchOfficialNewSession(closeArkme)
    const retained = arkmeUi.getSnapshot().selectedSource
    if (retained !== undefined) arkmeUi.open()
    else arkmeUi.focusSendToSelf()
    activateSurface(openedFromSession)
  }
  const openLogin = (openedFromSession: SessionId | undefined) => {
    if (stopWatchingNewSession === undefined) stopWatchingNewSession = watchOfficialNewSession(closeArkme)
    ensureSurface(openedFromSession)
    arkmeUi.showLoginSurface()
  }
  const toggleArkme = (openedFromSession: SessionId | undefined, authenticated: boolean) => {
    if (arkmeUi.getSnapshot().open) { closeArkme(); return }
    if (authenticated) openArkme(openedFromSession)
    else openLogin(openedFromSession)
  }

  ctx.effect(() => () => { closeArkme() }, 'dsh-arkme: restore native conversation on dispose')

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'arkme',
    order: 70,
    label: 'Arkme',
    inject: () => ({ toggle: toggleArkme, activate: activateSurface }),
  }, ArkmeFooterDropdown))

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'arkme-account',
    order: 80,
    label: 'Arkme 账号',
  }, ArkmeSettingsRow))
}

export { ArkmeFooterAction } from './ArkmeFooterAction.js'
export { ArkmeFooterDropdown } from './ArkmeFooterDropdown.js'
export { ArkmeSettingsRow } from './ArkmeSettingsRow.js'
export { ArkmeConversationSurface } from './ArkmeConversationSurface.js'
export { ArkmeSurface } from './ArkmeSidebar.js'
export { ArkmeNavigation } from './ArkmeVirtualWorkspace.js'
export { isOfficialNewSessionTarget, watchOfficialNewSession } from './new-session-activation.js'
