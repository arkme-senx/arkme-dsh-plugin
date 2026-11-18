import { useEffect } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsLauncherOwnerProps, SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import { HARNESS_MODELS_SETTINGS_OPEN } from '../harness-embed-contract.js'

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

function ModelsRedirect({ close }: SettingsSectionOwnerProps) {
  useEffect(() => {
    const surface = window.frameElement?.parentElement
    const accountScope = surface?.getAttribute('data-arkme-account-scope')
    if (!accountScope || window.parent === window) return
    close()
    window.parent.document.dispatchEvent(new CustomEvent(HARNESS_MODELS_SETTINGS_OPEN, { detail: { accountScope } }))
  }, [close])
  return null
}

export function installHarnessSettings(ctx: Context): () => void {
  const disposers = [
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: 'models', priority: -100, order: 10,
      label: () => ctx.locale.getSnapshot().active === 'en' ? 'Models ↗' : '模型 ↗',
    }, ModelsRedirect)),
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
