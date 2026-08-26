import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import type { ArkmeToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import { stableUidForToolCall } from '../../shared/stable-id.js'

const createRootTopics = defineArkmeCoreToolModule({
  meta: {
    id: 'business.topic.batch-create.v1', toolName: 'arkme_topics_create', kind: 'business', phase: 'core',
    effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_topics_create',
      description: 'Create 1-20 top-level Arkme personal topics requested by the current human. Each title has an independent result. Never claim success for failed or outcome_unknown items, and never retry outcome_unknown automatically.',
      parameters: {
        titles: { type: 'array', items: { type: 'string' }, required: true, description: 'One to twenty final topic titles, each 1-100 characters.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        return taggedJSON('Arkme 顶层主题批量创建结果', await ports.createTopicsBatch(
          args.titles,
          stableUidForToolCall('topic-root-batch', String(exec.callId)),
          undefined,
          exec.signal,
        ))
      },
    })
  },
})

const createChildTopics = defineArkmeCoreToolModule({
  meta: {
    id: 'business.topic.child-batch-create.v1', toolName: 'arkme_topic_children_create', kind: 'business', phase: 'core',
    effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_topic_children_create',
      description: 'Create 1-20 direct child topics under one Arkme parent requested by the current human. Use parent_source_ref unchanged from arkme_sources_list; never infer a parent from its title. Each title has an independent result. Never claim success for failed or outcome_unknown items, and never retry outcome_unknown automatically.',
      parameters: {
        parent_source_ref: { type: 'string', required: true, description: 'Account-bound topic source_ref returned unchanged by arkme_sources_list.' },
        titles: { type: 'array', items: { type: 'string' }, required: true, description: 'One to twenty final child-topic titles, each 1-100 characters.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        return taggedJSON('Arkme 子主题批量创建结果', await ports.createTopicsBatch(
          args.titles,
          stableUidForToolCall('topic-child-batch', String(exec.callId)),
          args.parent_source_ref,
          exec.signal,
        ))
      },
    })
  },
})

export const topicToolModules: readonly ArkmeToolModule[] = [createRootTopics, createChildTopics]
