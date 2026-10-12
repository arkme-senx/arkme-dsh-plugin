import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import { withArkmeConfirmationContext } from '../../shared/conversational-confirmation.js'
import type { ArkmeCapabilitySettings, AutomaticCapabilityKey } from '../../../capabilities.js'

const safe = (value: ArkmeCapabilitySettings) => ({ settings: value.settings.map(({ key, title, enabled }) => ({ key, title, enabled })), enableFrom: '由用户进入用量与额度中的自动 AI 设置，阅读并同意积分消耗说明后开启。' })

export const automaticCapabilityQueryToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.account.automatic-capabilities.v1', toolName: 'arkme_automatic_ai_settings', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_automatic_ai_settings', description: 'Read optional automatic AI settings for the signed-in user. Defaults are off. Enabling creates ongoing AI point charges and requires human consent in interactive settings; this tool cannot enable or analyze.',
    parameters: {}, output: TEXT_OUTPUT, isConcurrencySafe: () => true,
    execute: async (_, exec) => taggedJSON('自动 AI 设置', safe(await ports.automaticCapabilities(undefined, exec.signal))),
  }),
})

export const automaticCapabilityDisableToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.account.automatic-capability-disable.v1', toolName: 'arkme_disable_automatic_ai', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create: ports => {
    const prepare = async (key: string, signal?: AbortSignal) => {
      const current = await ports.automaticCapabilities(undefined, signal)
      const setting = current.settings.find(item => item.key === key)
      if (!setting) throw new Error('未知自动 AI 功能')
      return { scope: current.accountScope, key: setting.key, version: setting.version }
    }
    const disable = async (value: { scope: string; key: AutomaticCapabilityKey; version: number }, signal?: AbortSignal) => taggedJSON('自动 AI 设置', safe(await ports.updateAutomaticCapability({ key: value.key, enabled: false, expectedVersion: value.version, billingConsent: false }, value.scope, signal)))
    return withArkmeConfirmationContext(defineTool({
      name: 'arkme_disable_automatic_ai', description: 'After an explicit current human request, disable one automatic AI feature. Already-dispatched calls may complete and incur charges. This tool cannot enable features or delete existing results.',
      parameters: { key: { type: 'string', required: true, description: 'Capability key from arkme_automatic_ai_settings' } }, output: TEXT_OUTPUT,
      execute: async (args, exec) => disable(await prepare(args.key, exec.signal), exec.signal),
    }), { prepare: (args, exec) => prepare(String((args as { key?: unknown }).key ?? ''), exec.signal), execute: (_args, exec, prepared) => disable(prepared, exec.signal) })
  },
})

export const automaticCapabilityToolModules = [automaticCapabilityQueryToolModule, automaticCapabilityDisableToolModule]
