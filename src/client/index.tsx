import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ArkmeSourceItem, ArkmeSourceList } from '../types.js'
import './composer-draft-auth-binding.js'
import { callArkme } from './api.js'
import { ArkmeAppUpdateDialog } from './ArkmeAppUpdateDialog.js'
import { ArkmeStartupAuthGate, startupAuthGateEnabled } from './ArkmeStartupAuthGate.js'
import {
  ArkmePersistentDetails, ArkmePersistentSidebar, ArkmePersistentWorkspace,
} from './ArkmePersistentShell.js'
import { arkmeChatDirectory } from './chat-directory-store.js'
import { arkmeAppUpdateStore } from './app-update-store.js'
import { arkmeDesktopNotifications } from './desktop-notification-runtime.js'
import { arkmeNotificationActivation } from './notification-activation-store.js'
import { readArkmePersonalTestEdition } from './personal-test-edition.js'
import { arkmePluginUpdateStore } from './plugin-update-store.js'
import { arkmeUi } from './ui-controller.js'
import { consumeExtensionShareDeepLink } from './extension-share-deeplink.js'

export const inject = ['slots', 'layout', 'sessions', 'workspaces']

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

/** Permanently replace DSH's visible sidebar/conversation/details seats with Arkme-owned surfaces. */
export function apply(ctx: ClientContext): void {
	if (typeof window !== 'undefined' && window.location !== undefined && window.history !== undefined) {
		const shareRef = consumeExtensionShareDeepLink(window.location, window.history)
		if (shareRef !== undefined) arkmeUi.openExtensionShare(shareRef)
	}

  ctx.effect(() => arkmePluginUpdateStore.start(), 'dsh-arkme: client plugin update status')
  ctx.effect(() => arkmeAppUpdateStore.start(), 'dsh-arkme: client app update status')
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

  ctx.slots.inject('sidebar', () => ctx.slots.register({
    name: 'sidebar',
    priority: -100,
    inject: () => ({
      collapseSidebar: () => { ctx.layout.toggleSidebar() },
      closeDetails: () => { ctx.layout.closeDetails() },
    }),
  }, ArkmePersistentSidebar))

  ctx.slots.inject('conversation', () => ctx.slots.register({
    name: 'conversation',
    priority: -100,
    children: {
      'arkme.directory.entry': { kind: 'list', scope: 'root' },
    },
    inject: () => ({ closeDetails: () => { ctx.layout.closeDetails() } }),
  }, ArkmePersistentWorkspace))

  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    priority: -100,
    inject: () => ({ closeDetails: () => { ctx.layout.closeDetails() } }),
  }, ArkmePersistentDetails))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'arkme-app-update-dialog',
    order: 90,
    label: 'Arkme APP 更新提示',
  }, ArkmeAppUpdateDialog))

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
export { ArkmeHeroBrandMark, ArkmeSidebarBrandMark, ArkmeSidebarBrandName } from './ArkmeBrand.js'
export { ArkmeFooterDropdown } from './ArkmeFooterDropdown.js'
export { ArkmeOutgoingCallHost, outgoingCallModalLayout } from './ArkmeOutgoingCallHost.js'
export { ArkmePrivateCallMenu } from './ArkmePrivateCallMenu.js'
export { ArkmeAppUpdateDialog } from './ArkmeAppUpdateDialog.js'
export { ArkmeSettingsRow } from './ArkmeSettingsRow.js'
export { ArkmeStartupAuthGate } from './ArkmeStartupAuthGate.js'
export {
  ArkmePersistentClientRuntime, ArkmePersistentDetails,
  ArkmePersistentSidebar, ArkmePersistentWorkspace,
} from './ArkmePersistentShell.js'
export { ArkmeConversationSurface } from './ArkmeConversationSurface.js'
export { ArkmeCalendarSurface } from './ArkmeCalendarSurface.js'
export { ArkmeCallHistorySurface } from './ArkmeCallHistorySurface.js'
export { ArkmeRecordingSurface } from './ArkmeRecordingSurface.js'
export { ArkmeWorldSurface } from './ArkmeWorldSurface.js'
export { ArkmeSearchSurface } from './ArkmeSearchSurface.js'
export { ArkmeContactAddSurface } from './ArkmeContactAddSurface.js'
export { ArkmeArkoSurface } from './ArkmeArkoSurface.js'
// Keep the legacy export as a compatibility alias for existing consumers while
// the primary module and public terminology move to Marketplace.
export {
  ArkmeMarketplace,
  ArkmeMarketplace as ArkmeExtensionCenter,
} from './ArkmeMarketplace.js'
export { ArkmeSharedExtensionDetail } from './ArkmeSharedExtensionDetail.js'
export {
  ARKME_PERSONAL_TEST_EDITION_STORAGE_KEY,
  arkmePersonalTestEditionLabel,
  parseArkmePersonalTestEdition,
  parseArkmePersonalTestEditionSearch,
  readArkmePersonalTestEdition,
} from './personal-test-edition.js'
export { consumeExtensionShareDeepLink, extensionShareRefFromHash } from './extension-share-deeplink.js'
export {
  ArkmeExtensionReviewComposerDialog,
  ArkmeExtensionReviews,
  extensionRatingLabel,
  extensionReviewTree,
} from './ArkmeExtensionReviews.js'
export { ArkmeSurface } from './ArkmeSidebar.js'
export { ArkmeProductNavigation } from './ArkmeProductNavigation.js'
export { ArkmeAccountMenu } from './ArkmeAccountMenu.js'
export { ArkmeSettingsSurface } from './ArkmeSettingsSurface.js'
export { ArkmeCallsRow, ArkmeDirectoryRow, ArkmeNavigation, ArkmeRecordingsRow, renderArkmeDirectoryRow } from './ArkmeVirtualWorkspace.js'
export { ArkmeRootFrame } from './redesign/ArkmeRootFrame.js'
export { ArkmeLayoutController } from './redesign/layout-controller.js'
export type { ArkmeDirectoryEntryOwnerProps, ArkmeDirectoryRowProps } from './slots-contract.js'
export { outgoingCallUi } from './outgoing-call-ui-controller.js'
export { ArkmePluginUpdateStore, arkmePluginUpdateStore } from './plugin-update-store.js'
export { ArkmeAppUpdateStore, arkmeAppUpdateStore } from './app-update-store.js'
export {
  isOfficialConversationTarget, isOfficialNewSessionTarget,
  watchOfficialConversationSelection, watchOfficialNewSession,
} from './new-session-activation.js'
