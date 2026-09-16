import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { installHarnessSessionListDefault } from './harness-session-list-default.js'
import { installHarnessSessionDropdown } from './harness-session-dropdown.js'
import { installHarnessSessionSummary } from './harness-session-summary.js'
import { installHarnessActivityReporter } from './harness-activity-reporter.js'

export const inject = ['slots', 'locale']

/** The outer Arkme shell owns authentication and the avatar settings entry. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const surface = window.frameElement?.parentElement
    if (surface?.getAttribute('data-arkme-owned') !== 'deepseek-harness-surface') return () => undefined
    let restoreSettings: (() => void) | undefined
    let restoreDropdown: (() => void) | undefined
    let restoreDefault: (() => void) | undefined
    let restoreSummary: (() => void) | undefined
    let restoreActivity: (() => void) | undefined
    const sync = () => {
      const accountId = Number(surface.getAttribute('data-arkme-account-id'))
      const authenticated = Number.isSafeInteger(accountId) && accountId > 0
      if (authenticated && restoreSettings === undefined) {
        restoreSettings = ctx.slots.inject('sidebar.settings', () => ctx.slots.register({
          name: 'sidebar.settings', priority: -100,
        }, () => null))
        restoreDefault = installHarnessSessionListDefault(ctx)
        restoreSummary = installHarnessSessionSummary(ctx)
        restoreActivity = installHarnessActivityReporter(ctx, surface)
        restoreDropdown = installHarnessSessionDropdown(document)
      } else if (!authenticated) {
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
      restoreActivity?.()
      restoreSummary?.()
      restoreDefault?.()
      restoreDropdown?.()
      restoreSettings?.()
    }
  }, 'arkme: native sidebar settings follow account state')
}
