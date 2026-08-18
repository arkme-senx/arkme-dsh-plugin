import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { formatProfileResult, TEXT_OUTPUT } from '../../shared/output.js'

export const userProfileToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.account.profile.v1',
    toolName: 'arkme_user_profile',
    kind: 'business',
    phase: 'core',
    effect: 'read',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_user_profile',
      description: 'Read the signed-in user\'s safe Arkme display profile: nickname, avatar reference, current Arkme ID, whether its one-time change is still available, account type, creation time, bindings, and masked contact values. Raw phone, email, real name, and tokens are never returned. To inspect the actual avatar image, pass profile.avatarRef to arkme_image_read instead of constructing a URL.',
      parameters: {
        refresh: { type: 'boolean', description: 'Refresh from Arkme before reading. Defaults to true; set false for cache only.' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: args => args.refresh === false,
      async execute(args) {
        const snapshot = args.refresh === false
          ? await ports.cachedProfile()
          : await ports.refreshProfile()
        return formatProfileResult(snapshot)
      },
    })
  },
})
