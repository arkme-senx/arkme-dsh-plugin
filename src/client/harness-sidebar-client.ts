import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { installHarnessAccountSessions } from './harness-account-sessions.js'
import { installHarnessSessionListDefault } from './harness-session-list-default.js'
import { installHarnessSessionDropdown } from './harness-session-dropdown.js'
import { installHarnessSessionSummary } from './harness-session-summary.js'
import { installProjectedConversation } from './harness-projected-conversation.js'
import { installHarnessActivityReporter } from './harness-activity-reporter.js'
import { installHarnessSettings } from './harness-settings.js'
import { installNativeModelSettings, nativeModelSettingsRequested } from './native-model-settings.js'

export const inject = ['slots', 'locale', 'sessions']

/** The outer Arkme shell owns authentication and the avatar settings entry. */
export function apply(ctx: ClientContext): void {
  if (nativeModelSettingsRequested()) {
    ctx.effect(() => installNativeModelSettings(ctx), 'arkme: native model settings surface')
    return
  }
  ctx.effect(() => {
    const surface = window.frameElement?.parentElement
    if (surface?.getAttribute('data-arkme-owned') !== 'deepseek-harness-surface') return () => undefined
    let restoreSettings: (() => void) | undefined
    let restoreDropdown: (() => void) | undefined
    let restoreDefault: (() => void) | undefined
    let restoreSummary: (() => void) | undefined
    let restoreAccountSessions: (() => void) | undefined
    let restoreHistory: (() => void) | undefined
    let restoreActivity: (() => void) | undefined
    const sync = () => {
      const accountId = Number(surface.getAttribute('data-arkme-account-id'))
      const authenticated = Number.isSafeInteger(accountId) && accountId > 0
      if (authenticated && restoreSettings === undefined) {
        restoreSettings = installHarnessSettings(ctx)
        restoreDefault = installHarnessSessionListDefault(ctx)
        restoreAccountSessions = installHarnessAccountSessions(ctx, surface)
        restoreSummary = installHarnessSessionSummary(ctx, surface)
        restoreActivity = installHarnessActivityReporter(ctx, surface)
        restoreDropdown = installHarnessSessionDropdown(document)
        restoreHistory = installProjectedConversation(ctx, surface)
      } else if (!authenticated) {
        restoreHistory?.(); restoreHistory = undefined
        restoreAccountSessions?.()
        restoreAccountSessions = undefined
        restoreActivity?.()
        restoreActivity = undefined
        restoreSummary?.()
        restoreSummary = undefined
        restoreDefault?.()
        restoreDefault = undefined
        restoreDropdown?.()
        restoreDropdown = undefined
        restoreSettings?.()
        restoreSettings = undefined
      }
    }
    const observer = new MutationObserver(sync)
    observer.observe(surface, { attributes: true, attributeFilter: ['data-arkme-account-id'] })
    sync()
    return () => {
      observer.disconnect()
      restoreHistory?.()
      restoreAccountSessions?.()
      restoreActivity?.()
      restoreSummary?.()
      restoreDefault?.()
      restoreDropdown?.()
      restoreSettings?.()
    }
  }, 'arkme: native sidebar settings follow account state')
}
