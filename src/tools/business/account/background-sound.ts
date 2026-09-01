import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import { withArkmeConfirmationContext } from '../../shared/conversational-confirmation.js'

interface DisableBackgroundSoundPreparedContext { expectedUserId: number }

function safePreference(preference: import('../../../types.js').ArkmeBackgroundSoundPreference): Record<string, unknown> {
  return {
    found: preference.found,
    enabled: preference.enabled,
    eligible: preference.eligible,
    eligibilityReason: preference.eligibilityReason,
    ...(preference.memberType === undefined ? {} : { memberType: preference.memberType }),
  }
}

function expectedUserId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('背景音设置的账号归属无效，请刷新后重试')
  }
  return value
}

export const backgroundSoundStatusToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.account.background-sound-status.v1',
    toolName: 'arkme_background_sound_status',
    kind: 'business',
    phase: 'core',
    effect: 'read',
    profiles: ['business', 'hybrid'],
  },
  create: ports => defineTool({
    name: 'arkme_background_sound_status',
    description: 'Read whether text background sound is enabled for the signed-in Arkme account. This does not request microphone permission, record audio, or change the preference.',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (_args, exec) => {
      const preference = await ports.backgroundSoundPreference(exec.signal)
      return taggedJSON('Arkme 文字背景音设置', safePreference(preference))
    },
  }),
})

export const disableBackgroundSoundToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.account.background-sound-disable.v1',
    toolName: 'arkme_background_sound_disable',
    kind: 'business',
    phase: 'core',
    effect: 'write',
    grant: 'explicit-user-write',
    profiles: ['business', 'hybrid'],
  },
  create: ports => withArkmeConfirmationContext(defineTool({
    name: 'arkme_background_sound_disable',
    description: 'Only after an explicit current human request: disable text background sound for the signed-in Arkme account. This Tool has no enable parameter and can never request microphone permission or start recording. Enabling is available only from an interactive UI/SDK action by the human.',
    parameters: {},
    output: TEXT_OUTPUT,
    execute: async (_args, exec) => {
      const current = await ports.backgroundSoundPreference(exec.signal)
      const preference = await ports.updateBackgroundSoundPreference(false, exec.signal, expectedUserId(current.userId))
      return taggedJSON('Arkme 文字背景音设置', safePreference(preference))
    },
  }), {
    prepare: async (_args, exec): Promise<DisableBackgroundSoundPreparedContext> => {
      const preference = await ports.backgroundSoundPreference(exec.signal)
      return { expectedUserId: expectedUserId(preference.userId) }
    },
    execute: async (_args, exec, prepared) => {
      const preference = await ports.updateBackgroundSoundPreference(
        false,
        exec.signal,
        expectedUserId(prepared.expectedUserId),
      )
      return taggedJSON('Arkme 文字背景音设置', safePreference(preference))
    },
  }),
})

export const backgroundSoundPreferenceToolModules = [
  backgroundSoundStatusToolModule,
  disableBackgroundSoundToolModule,
]
