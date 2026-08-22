import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ArkmeSourceItem, ArkmeSourceList } from '../types.js'
import './composer-draft-auth-binding.js'
import { callArkme } from './api.js'
import { ArkmeFooterAction } from './ArkmeFooterAction.js'
import { ArkmeFooterDropdown } from './ArkmeFooterDropdown.js'
import { ArkmeSettingsSection } from './ArkmeSettingsSection.js'
import { ArkmeStartupAuthGate, startupAuthGateEnabled } from './ArkmeStartupAuthGate.js'
import { arkmeChatDirectory } from './chat-directory-store.js'
import { arkmeDesktopNotifications } from './desktop-notification-runtime.js'
import { watchOfficialConversationSelection, watchOfficialNewSession } from './new-session-activation.js'
import { arkmeNotificationActivation } from './notification-activation-store.js'
import { arkmePluginUpdateStore } from './plugin-update-store.js'
import { arkmeUi } from './ui-controller.js'
import { consumeExtensionShareDeepLink } from './extension-share-deeplink.js'

export const inject = ['slots']

async function resolveNotificationSource(
  activation: { sourceRef: string; sourceKey?: string },
  signal: AbortSignal,
): Promise<ArkmeSourceItem | undefined> {
  const matches = (source: ArkmeSourceItem) => source.sourceRef === activation.sourceRef
    || (activation.sourceKey !== undefined && source.sourceKey === activation.sourceKey)
  const cached = arkmeChatDirectory.getSnapshot().sources.find(matches)
  if (cached !== undefined) return cached
  let cursor: string | undefined
  for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
    const page = await callArkme<ArkmeSourceList>('sources.list', {
      directory: 'root',
      limit: 50,
      refresh: true,
      ...(cursor === undefined ? {} : { cursor }),
    }, signal)
    const source = page.items.find(matches)
    if (source !== undefined) return source
    if (!page.hasMore || page.nextCursor === undefined) return undefined
    cursor = page.nextCursor
  }
  return undefined
}

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
	if (typeof window !== 'undefined' && window.location !== undefined && window.history !== undefined) {
		const shareRef = consumeExtensionShareDeepLink(window.location, window.history)
		if (shareRef !== undefined) arkmeUi.openExtensionShare(shareRef)
	}

  ctx.effect(() => () => { closeArkme() }, 'dsh-arkme: close floating surface on dispose')
  ctx.effect(() => arkmePluginUpdateStore.start(), 'dsh-arkme: client plugin update status')
  ctx.effect(() => {
    let disposed = false
    let activationGeneration = 0
    let controller: AbortController | undefined
    const stop = arkmeDesktopNotifications.onActivated(activation => {
      const generation = ++activationGeneration
      controller?.abort()
      const request = new AbortController()
      controller = request
      void resolveNotificationSource(activation, request.signal).then(source => {
        if (disposed || generation !== activationGeneration || source === undefined) return
        arkmeChatDirectory.upsert(source)
        arkmeUi.selectSource(source)
        arkmeNotificationActivation.publish(source)
        openArkme(undefined)
      }).catch(error => {
        if (!request.signal.aborted) console.warn('dsh-arkme: notification_source_resolve_failed', error)
      })
    })
    return () => {
      disposed = true
      activationGeneration += 1
      controller?.abort()
      stop()
    }
  }, 'dsh-arkme: activate message notification sources')

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'arkme',
    order: 70,
    label: 'Arkme',
    children: {
      'arkme.directory.entry': { kind: 'list', scope: 'root' },
    },
    inject: () => ({
      toggle: toggleArkme,
      activate: activateSurface,
      closeSurface,
      surfaceSession: () => openedFromSession,
    }),
  }, ArkmeFooterDropdown))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'arkme',
    order: 80,
    label: 'Arkme',
  }, ArkmeSettingsSection))

  if (startupAuthGateEnabled()) {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'arkme-startup-auth-gate',
      order: 100,
      label: 'Arkme 启动认证门禁',
    }, ArkmeStartupAuthGate))
  }
}

export { ArkmeFooterAction } from './ArkmeFooterAction.js'
export { ArkmeFooterDropdown } from './ArkmeFooterDropdown.js'
export { ArkmeOutgoingCallHost, outgoingCallModalLayout } from './ArkmeOutgoingCallHost.js'
export { ArkmePrivateCallMenu } from './ArkmePrivateCallMenu.js'
export { ArkmeSettingsSection } from './ArkmeSettingsSection.js'
export { ArkmeStartupAuthGate } from './ArkmeStartupAuthGate.js'
export { ArkmeConversationSurface } from './ArkmeConversationSurface.js'
export { ArkmeCalendarSurface } from './ArkmeCalendarSurface.js'
export { ArkmeRecordingSurface } from './ArkmeRecordingSurface.js'
export { ArkmeSearchSurface } from './ArkmeSearchSurface.js'
export { ArkmeArkoSurface } from './ArkmeArkoSurface.js'
export { ArkmeExtensionCenter } from './ArkmeExtensionCenter.js'
export { ArkmeSharedExtensionDetail } from './ArkmeSharedExtensionDetail.js'
export { consumeExtensionShareDeepLink, extensionShareRefFromHash } from './extension-share-deeplink.js'
export {
  ArkmeExtensionReviewComposerDialog,
  ArkmeExtensionReviews,
  extensionRatingLabel,
  extensionReviewTree,
} from './ArkmeExtensionReviews.js'
export { ArkmeSurface } from './ArkmeSidebar.js'
export { ArkmeDirectoryRow, ArkmeNavigation, renderArkmeDirectoryRow } from './ArkmeVirtualWorkspace.js'
export type { ArkmeDirectoryEntryOwnerProps, ArkmeDirectoryRowProps } from './slots-contract.js'
export { outgoingCallUi } from './outgoing-call-ui-controller.js'
export { ArkmePluginUpdateStore, arkmePluginUpdateStore } from './plugin-update-store.js'
export {
  isOfficialConversationTarget, isOfficialNewSessionTarget,
  watchOfficialConversationSelection, watchOfficialNewSession,
} from './new-session-activation.js'
