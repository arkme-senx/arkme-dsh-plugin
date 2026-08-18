import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { JotmoConversationSurface } from './JotmoConversationSurface.js'
import { JotmoFooterAction } from './JotmoFooterAction.js'
import { JotmoFooterDropdown } from './JotmoFooterDropdown.js'
import { JotmoSettingsRow } from './JotmoSettingsRow.js'
import { watchOfficialNewSession } from './new-session-activation.js'
import { cachedSelectedSource, readLastNavigationCache } from './navigation-cache.js'
import { jotmoUi } from './ui-controller.js'

export const inject = ['slots']

/** Register Jiwo only through official additive DSH slots. */
export function apply(ctx: ClientContext): void {
  let disposeJotmoConversation: (() => void) | undefined
  let stopWatchingNewSession: (() => void) | undefined
  const closeSurface = () => {
    const dispose = disposeJotmoConversation
    disposeJotmoConversation = undefined
    dispose?.()
    jotmoUi.deactivateSurface()
  }
  const closeJotmo = () => {
    const stop = stopWatchingNewSession
    stopWatchingNewSession = undefined
    stop?.()
    closeSurface()
    jotmoUi.close()
  }
  const ensureSurface = (openedFromSession: SessionId | undefined) => {
    if (disposeJotmoConversation !== undefined) return
    disposeJotmoConversation = ctx.slots.register({
      name: 'conversation',
      priority: -10,
      inject: () => ({ close: closeSurface, openedFromSession }),
    }, JotmoConversationSurface)
  }
  const activateSurface = (openedFromSession: SessionId | undefined) => {
    ensureSurface(openedFromSession)
    jotmoUi.activateSurface()
  }
  const openJotmo = (openedFromSession: SessionId | undefined) => {
    if (stopWatchingNewSession === undefined) stopWatchingNewSession = watchOfficialNewSession(closeJotmo)
    const retained = jotmoUi.getSnapshot().selectedSource
    const cached = readLastNavigationCache()
    const restored = cached === undefined ? undefined : cachedSelectedSource(cached)
      ?? cached.sources.send_to_self?.find(source => source.kind === 'default_category')
    if (retained !== undefined) jotmoUi.open()
    else if (restored !== undefined) jotmoUi.selectSource(restored)
    else jotmoUi.focusSendToSelf()
    activateSurface(openedFromSession)
  }
  const openLogin = (openedFromSession: SessionId | undefined) => {
    if (stopWatchingNewSession === undefined) stopWatchingNewSession = watchOfficialNewSession(closeJotmo)
    ensureSurface(openedFromSession)
    jotmoUi.showLoginSurface()
  }
  const toggleJotmo = (openedFromSession: SessionId | undefined, authenticated: boolean) => {
    if (jotmoUi.getSnapshot().open) { closeJotmo(); return }
    if (authenticated) openJotmo(openedFromSession)
    else openLogin(openedFromSession)
  }

  ctx.effect(() => () => { closeJotmo() }, 'dsh-jotmo: restore native conversation on dispose')

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'jotmo',
    order: 70,
    label: '即我',
    inject: () => ({ toggle: toggleJotmo, activate: activateSurface }),
  }, JotmoFooterDropdown))

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'jotmo-account',
    order: 80,
    label: '即我账号',
  }, JotmoSettingsRow))
}

export { JotmoFooterAction } from './JotmoFooterAction.js'
export { JotmoFooterDropdown } from './JotmoFooterDropdown.js'
export { JotmoSettingsRow } from './JotmoSettingsRow.js'
export { JotmoConversationSurface } from './JotmoConversationSurface.js'
export { JotmoSurface } from './JotmoSidebar.js'
export { JotmoNavigation } from './JotmoVirtualWorkspace.js'
export { isOfficialNewSessionTarget, watchOfficialNewSession } from './new-session-activation.js'
