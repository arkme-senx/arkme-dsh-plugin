import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const archiveListToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.conversation.archive-list.v1', toolName: 'arkme_archives_list', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_archives_list', description: 'List all archived personal topics, including topics archived through an ancestor. Returns account-bound source references and independent/effective archive states. Privacy-locked titles remain masked.',
    parameters: { cursor: { type: 'string', description: 'Opaque nextCursor from the previous page.' } }, output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => taggedJSON('已归档主题', await ports.listArchives(args.cursor, exec.signal)),
  }),
})

export const archiveStateToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.conversation.archive-state.v1', toolName: 'arkme_archive_state', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_archive_state', description: 'Read the current independent and effective archive states and revision of a personal topic before changing it.',
    parameters: { source_ref: { type: 'string', required: true, description: 'Account-bound topic source reference.' } }, output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => taggedJSON('主题归档状态', await ports.getArchiveStates([args.source_ref], exec.signal)),
  }),
})

export const archiveSetToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.conversation.archive-set.v1', toolName: 'arkme_archive_set', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_archive_set', description: 'Only after an explicit user request, set the selected topic independent archive marker. Descendants inherit archive visibility. Restoring a parent preserves independently archived descendants; restoring a child does not clear ancestor markers. Never automatically retry with a newer revision after a conflict or clear other markers.',
    parameters: {
      source_ref: { type: 'string', required: true, description: 'Account-bound topic source reference.' },
      self_archived: { type: 'boolean', required: true, description: 'True to independently archive; false to remove only this topic independent archive marker.' },
      expected_revision: { type: 'integer', required: true, description: 'Revision from a fresh arkme_archive_state response.' },
    }, output: TEXT_OUTPUT,
    execute: async (args, exec) => taggedJSON('主题归档结果', await ports.setArchiveState({ sourceRef: args.source_ref, selfArchived: args.self_archived, expectedRevision: args.expected_revision }, exec.signal)),
  }),
})

export const archiveToolModules = [archiveListToolModule, archiveStateToolModule, archiveSetToolModule] as const
