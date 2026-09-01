import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ArkmeSourceItem, ArkmeSourceList } from '../types.js'
import './composer-draft-auth-binding.js'
import { callArkme } from './api.js'
import { ArkmeSettingsSurface } from './ArkmeSettingsSurface.js'
import { ArkmeStartupAuthGate, startupAuthGateEnabled } from './ArkmeStartupAuthGate.js'
import { ArkmeWebLoginOverlay } from './ArkmeWebLoginOverlay.js'
import {
  ArkmePersistentDetails, ArkmePersistentSidebar, ArkmePersistentWorkspace,
} from './ArkmePersistentShell.js'
import { arkmeChatDirectory } from './chat-directory-store.js'
import { arkmeAppUpdateStore } from './app-update-store.js'
import { arkmeDesktopNotifications } from './desktop-notification-runtime.js'
import { arkmeNotificationActivation } from './notification-activation-store.js'
import { arkmeUi } from './ui-controller.js'
import { observeExtensionShareDeepLinks } from './extension-share-deeplink.js'
import { deepSeekHarnessEmbedRequested, deepSeekHarnessNativeSettingsRequested } from './DeepSeekHarnessSurface.js'
import { installArkmeRedesignStyles } from './redesign/styles.js'
import { installArkmeAccountSettingsNavIcon } from './account-settings-nav-icon.js'
import { installArkmeSkinMarketBridge } from './skin-market-bridge.js'
import {
  ARKME_LOGIN_LOCALE_NAMESPACE, arkmeLoginEn, arkmeLoginZh,
} from './arkme-login-locales.js'

export const inject = ['slots', 'layout', 'locale', 'sessions']


function ArkmeDshSettingsSection() {
  return <ArkmeSettingsSurface />
}

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

/** Keep Arkme's shell resident and embed the native DSH client only in its conversation region. */
export function apply(ctx: ClientContext): void {
	if (deepSeekHarnessEmbedRequested()) {
		if (!deepSeekHarnessNativeSettingsRequested()) {
			ctx.slots.inject('sidebar.settings', () => ctx.slots.register({
				name: 'sidebar.settings',
				priority: -100,
			}, () => null))
		}
		return
	}
	if (typeof window !== 'undefined' && window.location !== undefined && window.history !== undefined) {
		ctx.effect(() => observeExtensionShareDeepLinks(
			window.location,
			window.history,
			window,
			intent => { arkmeUi.openExtensionShare(intent.shareRef, intent.action) },
		), 'dsh-arkme: extension share deep links')
	}

  ctx.effect(() => ctx.locale.register(ARKME_LOGIN_LOCALE_NAMESPACE, {
    zh: arkmeLoginZh,
    en: arkmeLoginEn,
  }), 'dsh-arkme: login dictionaries')
  const loginT = ctx.locale.bind(ARKME_LOGIN_LOCALE_NAMESPACE)

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

  ctx.effect(() => {
    let disposeSidebar: (() => void) | undefined
    let settingsTimer: number | undefined
    let settingsOpened = false
    let disposed = false

    const mountArkmeSidebar = () => {
      if (disposed || disposeSidebar !== undefined) return
      disposeSidebar = ctx.slots.inject('sidebar', () => ctx.slots.register({
        name: 'sidebar',
        priority: -100,
        children: {
          'arkme.directory.entry': { kind: 'list', scope: 'root' },
        },
        inject: () => ({
          collapseSidebar: () => { ctx.layout.toggleSidebar() },
          closeDetails: () => { ctx.layout.closeDetails() },
          searchDshMessages: async (query: string, signal: AbortSignal) => {
            const dshSessions = (ctx as unknown as { sessions?: ISessions }).sessions
            if (typeof dshSessions?.search !== 'function') throw new Error('当前 DSH 版本暂不支持任务消息搜索')
            const result = await dshSessions.search(query, signal)
            if (!result.ok) throw new Error(result.error.message)
            return result.value
          },
          openDshSession: (sessionId: string) => {
            const dshSessions = (ctx as unknown as { sessions?: ISessions }).sessions
            if (typeof dshSessions?.open !== 'function') throw new Error('当前 DSH 版本暂不支持打开任务')
            dshSessions.open(sessionId as SessionId)
          },
        }),
      }, ArkmePersistentSidebar))
    }
    const stopSettingsTimer = () => {
      if (settingsTimer === undefined || typeof window === 'undefined') return
      window.clearInterval(settingsTimer)
      settingsTimer = undefined
    }
    const restoreArkmeSidebar = () => {
      stopSettingsTimer()
      settingsOpened = false
      mountArkmeSidebar()
    }
    const openOfficialSettings = () => {
      if (disposed || typeof document === 'undefined' || typeof window === 'undefined') return
      stopSettingsTimer()
      disposeSidebar?.()
      disposeSidebar = undefined
      settingsOpened = false
      let attempts = 0
      let triggerClicked = false
      settingsTimer = window.setInterval(() => {
        if (disposed) return
        attempts += 1
        const sidebar = document.querySelector('[data-slot="sidebar"]')
        const arkmeSidebarPresent = sidebar?.querySelector('[data-arkme-owned="persistent-sidebar"]') !== null
        const trigger = arkmeSidebarPresent
          ? null
          : sidebar?.querySelector<HTMLButtonElement>(
            '[data-slot="sidebar.settings"] button[aria-haspopup="dialog"]',
          ) ?? null
        if (!triggerClicked && trigger !== null) {
          triggerClicked = true
          trigger.click()
        }
        const open = trigger?.getAttribute('aria-expanded') === 'true'
        if (open) settingsOpened = true
        if (settingsOpened && !open) {
          restoreArkmeSidebar()
          return
        }
        if (!settingsOpened && attempts >= 40) restoreArkmeSidebar()
      }, 50)
    }

    const unbindSettings = arkmeUi.bindSettingsOpener(openOfficialSettings)
    // Account logout is performed inside the native settings surface.  It can
    // replace the active sidebar before the settings-popover polling sees a
    // close event, so restore Arkme immediately when authentication returns to
    // its login state.
    const unsubscribeLogoutRestore = arkmeUi.subscribe(() => {
      if (arkmeUi.getSnapshot().mode === 'login') restoreArkmeSidebar()
    })
    mountArkmeSidebar()
    return () => {
      disposed = true
      unbindSettings()
      unsubscribeLogoutRestore()
      stopSettingsTimer()
      disposeSidebar?.()
      disposeSidebar = undefined
    }
  }, 'dsh-arkme: bridge to official settings sidebar')

  ctx.effect(() => {
    const disposeStyles = installArkmeRedesignStyles()
    return () => {
      disposeStyles()
    }
  }, 'dsh-arkme: install redesign visual system')

  ctx.effect(
    () => installArkmeSkinMarketBridge(),
    'dsh-arkme: mirror active skin market theme',
  )

  ctx.effect(
    () => installArkmeAccountSettingsNavIcon(),
    'dsh-arkme: render account settings navigation icon',
  )

  ctx.effect(() => {
    let disposeConversation: (() => void) | undefined
    let disposeDetails: (() => void) | undefined

    const mountArkmeSeats = () => {
      if (disposeConversation === undefined) {
        disposeConversation = ctx.slots.inject('conversation', () => ctx.slots.register({
          name: 'conversation',
          priority: -100,
          locale: ARKME_LOGIN_LOCALE_NAMESPACE,
          inject: () => ({ closeDetails: () => { ctx.layout.closeDetails() } }),
        }, ArkmePersistentWorkspace))
      }
      if (disposeDetails === undefined) {
        disposeDetails = ctx.slots.inject('details', () => ctx.slots.register({
          name: 'details',
          priority: -100,
          inject: () => ({ closeDetails: () => { ctx.layout.closeDetails() } }),
        }, ArkmePersistentDetails))
      }
    }
    mountArkmeSeats()
    return () => {
      disposeConversation?.()
      disposeConversation = undefined
      disposeDetails?.()
      disposeDetails = undefined
    }
  }, 'dsh-arkme: keep Arkme conversation seats around the embedded DeepSeek Harness')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'arkme-account',
    order: -1,
    label: '我的账户',
  }, ArkmeDshSettingsSection))

  if (!startupAuthGateEnabled()) {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'arkme-web-login-overlay',
      order: 100,
      label: () => loginT('gate.dialog'),
      locale: ARKME_LOGIN_LOCALE_NAMESPACE,
    }, ArkmeWebLoginOverlay))
  }

  if (startupAuthGateEnabled()) {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'arkme-startup-auth-gate',
      order: 100,
      label: () => loginT('gate.dialog'),
      locale: ARKME_LOGIN_LOCALE_NAMESPACE,
    }, ArkmeStartupAuthGate))
  }
}

export { ArkmeFooterAction } from './ArkmeFooterAction.js'
export { ArkmeHeroBrandMark, ArkmeSidebarBrandMark, ArkmeSidebarBrandName } from './ArkmeBrand.js'
export { ArkmeFooterDropdown } from './ArkmeFooterDropdown.js'
export {
  DEEPSEEK_HARNESS_EMBED_QUERY,
  DeepSeekHarnessSurface,
  deepSeekHarnessEmbedRequested,
  deepSeekHarnessEmbedUrl,
} from './DeepSeekHarnessSurface.js'
export { ArkmeOutgoingCallHost, outgoingCallModalLayout } from './ArkmeOutgoingCallHost.js'
export { ArkmePrivateCallMenu } from './ArkmePrivateCallMenu.js'
export { ArkmeAppUpdateDialog } from './ArkmeAppUpdateDialog.js'
export { ArkmeUpdateRailSlot, ArkmeUpdateTopCapsule, deriveArkmeUpdatePresentation } from './ArkmeUpdateSurfaces.js'
export { ArkmeStartupAuthGate } from './ArkmeStartupAuthGate.js'
export { ArkmeWebLoginOverlay } from './ArkmeWebLoginOverlay.js'
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
	consumeExtensionShareDeepLink,
	consumeExtensionShareDeepLinkIntent,
	extensionShareIntentFromHash,
	extensionShareRefFromHash,
	observeExtensionShareDeepLinks,
} from './extension-share-deeplink.js'
export {
  ArkmeExtensionReviewComposerDialog,
  ArkmeExtensionReviews,
  extensionRatingLabel,
  extensionReviewTree,
} from './ArkmeExtensionReviews.js'
export { ArkmeSurface } from './ArkmeSidebar.js'
export { ArkmeProductNavigation } from './ArkmeProductNavigation.js'
export { ArkmeCallSurface } from './ArkmeCallSurface.js'
export { ArkmeCallsRow, ArkmeDirectoryRow, ArkmeNavigation, ArkmeRecordingsRow, renderArkmeDirectoryRow } from './ArkmeVirtualWorkspace.js'
export { ArkmeLayoutController } from './redesign/layout-controller.js'
export type { ArkmeDirectoryEntryOwnerProps, ArkmeDirectoryRowProps } from './slots-contract.js'
export { outgoingCallUi } from './outgoing-call-ui-controller.js'
export { ArkmeAppUpdateStore, arkmeAppUpdateStore } from './app-update-store.js'
export {
  isOfficialConversationTarget, isOfficialNewSessionTarget,
  watchOfficialConversationSelection, watchOfficialNewSession,
} from './new-session-activation.js'
