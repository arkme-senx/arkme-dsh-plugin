import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const connectOpenClawBotToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.bot.connect-openclaw.v1', toolName: 'arkme_bot_openclaw_connect', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create(ports) {
    return defineTool({
      name: 'arkme_bot_openclaw_connect',
      description: 'Connect only one existing OpenClaw Bot to the host-configured local OpenClaw profile. Webhook Bots are not supported. The profile, package, workspace and credentials are never model parameters. The conversational confirmation for this Tool includes any required profile-wide Gateway restart and its temporary impact on every Agent in that profile.',
      parameters: {
        bot_ref: { type: 'string', required: true, description: 'Opaque bot_ref returned by arkme_bots_list or arkme_bot_create.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const result = await ports.connectOpenClawBot(args.bot_ref, { signal: exec.signal })
        return taggedJSON('Arkme OpenClaw Bot 连接结果', result)
      },
    })
  },
})
