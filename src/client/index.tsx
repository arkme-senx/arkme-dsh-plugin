import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { JotmoConversationSurface } from './JotmoConversationSurface.js'
import { JotmoFooterAction } from './JotmoFooterAction.js'
import { JotmoSettingsRow } from './JotmoSettingsRow.js'
import { JotmoWorkspaceSurface } from './JotmoWorkspaceSurface.js'
import { watchOfficialNewSession } from './new-session-activation.js'
import { jotmoUi } from './ui-controller.js'

export const inject = ['slots']

/** Register Jiwo only through official additive DSH slots. */
export function apply(ctx: ClientContext): void {
  let disposeJotmoConversation: (() => void) | undefined
  let disposeJotmoWorkspace: (() => void) | undefined
  let stopWatchingNewSession: (() => void) | undefined
  const closeJotmo = () => {
    const stop = stopWatchingNewSession
    stopWatchingNewSession = undefined
    stop?.()
    const dispose = disposeJotmoConversation
    disposeJotmoConversation = undefined
    const disposeWorkspace = disposeJotmoWorkspace
    disposeJotmoWorkspace = undefined
    dispose?.()
    disposeWorkspace?.()
    jotmoUi.close()
  }
  const openJotmo = (openedFromSession: SessionId | undefined) => {
    if (disposeJotmoConversation !== undefined || disposeJotmoWorkspace !== undefined) return
    const disposeWorkspace = ctx.slots.register({
      name: 'sidebar.workspaces',
      priority: -10,
    }, JotmoWorkspaceSurface)
    try {
      disposeJotmoConversation = ctx.slots.register({
        name: 'conversation',
        priority: -10,
        inject: () => ({ close: closeJotmo, openedFromSession }),
      }, JotmoConversationSurface)
      disposeJotmoWorkspace = disposeWorkspace
    } catch (error) {
      disposeWorkspace()
      throw error
    }
    stopWatchingNewSession = watchOfficialNewSession(closeJotmo)
    jotmoUi.focusSendToSelf()
  }
  const toggleJotmo = (openedFromSession: SessionId | undefined) => {
    if (disposeJotmoConversation === undefined) openJotmo(openedFromSession)
    else closeJotmo()
  }

  ctx.effect(() => () => { closeJotmo() }, 'dsh-jotmo: restore native conversation on dispose')

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'jotmo',
    order: 70,
    label: '即我',
    inject: () => ({ toggle: toggleJotmo }),
  }, JotmoFooterAction))

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'jotmo-account',
    order: 80,
    label: '即我账号',
  }, JotmoSettingsRow))
}

export { JotmoFooterAction } from './JotmoFooterAction.js'
export { JotmoSettingsRow } from './JotmoSettingsRow.js'
export { JotmoConversationSurface } from './JotmoConversationSurface.js'
export { JotmoSurface } from './JotmoSidebar.js'
export { JotmoNavigation } from './JotmoVirtualWorkspace.js'
export { JotmoWorkspaceSurface } from './JotmoWorkspaceSurface.js'
export { isOfficialNewSessionTarget, watchOfficialNewSession } from './new-session-activation.js'
