import { useEffect } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsLauncherOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'

export const HARNESS_SETTINGS_OPEN = 'arkme:harness-settings-open'
export const HARNESS_SETTINGS_READY = 'data-arkme-harness-settings-ready'

/** The native SettingsRoot retains ownership of visibility, sections and writes. */
function SettingsLauncher({ openSettings }: SettingsLauncherOwnerProps) {
  useEffect(() => {
    const open = () => openSettings()
    document.addEventListener(HARNESS_SETTINGS_OPEN, open)
    document.documentElement.setAttribute(HARNESS_SETTINGS_READY, '')
    return () => {
      document.removeEventListener(HARNESS_SETTINGS_OPEN, open)
      document.documentElement.removeAttribute(HARNESS_SETTINGS_READY)
    }
  }, [openSettings])
  return null
}

export function installHarnessSettings(ctx: Context): () => void {
  const disposers = [
    ctx.slots.inject('settings.launcher', () => ctx.slots.register({
      name: 'settings.launcher', priority: -100,
    }, SettingsLauncher)),
    ctx.slots.inject('settings.header', () => ctx.slots.register({
      name: 'settings.header', priority: -100,
    }, () => 'DeepSeek Harness ' + (ctx.locale.getSnapshot().active === 'en' ? 'settings' : '设置'))),
    // These global controls live in Arkme settings; the existing providers and
    // Host documents remain active and are shared with the embedded client.
    ...['language', 'appearance'].map(id => ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item', id, priority: -100,
    }, () => null))),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
