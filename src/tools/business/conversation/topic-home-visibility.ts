import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const topicHomeVisibilityToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.conversation.topic-home-visibility.v1',
    toolName: 'arkme_topic_home_visibility', kind: 'business', phase: 'core',
    effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'],
  },
  create: ports => defineTool({
    name: 'arkme_topic_home_visibility',
    description: 'Read a topic home visibility preference. Only set show_in_home after an explicit user request. This never changes topic contents, name, privacy or the origin of any message.',
    parameters: {
      source_ref: { type: 'string', required: true, description: 'Account-bound topic source_ref from arkme_sources_list.' },
      show_in_home: { type: 'boolean', description: 'Omit to read; true to show topic records on home, false to hide.' },
    },
    output: TEXT_OUTPUT,
    execute: async args => taggedJSON('主题首页展示', await ports.topicHomeVisibility(args.source_ref, args.show_in_home)),
  }),
})
