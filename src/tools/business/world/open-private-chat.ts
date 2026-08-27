import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { TEXT_OUTPUT } from '../../shared/output.js'

export const worldOpenPrivateChatToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.world.open-private-chat.v1', toolName: 'arkme_world_private_chat_open', kind: 'business', phase: 'core',
    effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_world_private_chat_open',
      description: 'Open or reuse a private Arkme chat with the non-self author of one World note. Use only an unchanged author_ref returned by arkme_world_recent, after an explicit current human request and conversational confirmation.',
      parameters: {
        author_ref: { type: 'string', required: true, description: 'Account-bound author_ref returned by arkme_world_recent.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const authorRef = args.author_ref.trim()
        if (authorRef === '') throw new Error('author_ref 不能为空')
        return JSON.stringify(await ports.openPrivateChatFromWorldAuthor(authorRef, exec.signal), undefined, 2)
      },
    })
  },
})
