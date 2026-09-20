import type { ArkmeSettingsSection } from './ui-controller.js'
import { tr } from './locale.js'

const labels: Record<ArkmeSettingsSection, string> = {
  'arkme-account': '我的账户', 'arkme-usage': '用量与额度', 'arkme-data': '数据管理',
}

/** The current Harness shell has no section-navigation API. Limit this adapter
 * to its own open settings dialog and nav, never arbitrary matching content. */
export function selectArkmeSettingsSection(section: ArkmeSettingsSection): boolean {
  const header = document.querySelector('[role="dialog"] [data-slot="settings.header"]')
  const panel = header?.closest('[role="dialog"]')
  if (!panel) return false
  const button = [...panel.querySelectorAll<HTMLButtonElement>('nav button')]
    .find(candidate => candidate.textContent?.trim() === tr(labels[section]))
  if (!button) return false
  if (button.getAttribute('aria-current') !== 'true') button.click()
  return true
}
