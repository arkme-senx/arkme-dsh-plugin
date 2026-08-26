import { createGroupToolModule } from './create.js'
import { renameGroupToolModule } from './rename.js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import type { ArkmeToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

const candidates = defineArkmeCoreToolModule({
  meta: { id: 'business.group.member-candidates.v1', toolName: 'arkme_group_member_candidates', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create(ports) {
    return defineTool({
      name: 'arkme_group_member_candidates',
      description: 'List people from the signed-in user\'s Arkme private chats and, when requested, members of other group chats who can be added or invited to one group. Use unchanged group source_ref values from arkme_sources_list. Candidate references are account-bound and must be passed unchanged to arkme_group_member_add.',
      parameters: {
        group_source_ref: { type: 'string', required: true, description: 'Account-bound group_chat source_ref returned by arkme_sources_list.' },
        query: { type: 'string', description: 'Optional display-name filter.' },
        limit: { type: 'integer', description: 'Maximum candidates, 1-50. Defaults to 20.' },
        group_source_refs: { type: 'array', items: { type: 'string' }, description: 'Optional group_chat source_ref values to expand into member candidates.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        return taggedJSON('Arkme 群成员候选', await ports.listGroupMemberCandidates(args.group_source_ref, {
          ...(args.query === undefined ? {} : { query: args.query }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.group_source_refs === undefined ? {} : { groupSourceRefs: args.group_source_refs }),
          signal: exec.signal,
        }))
      },
    })
  },
})

const add = defineArkmeCoreToolModule({
  meta: { id: 'business.group.member-add.v1', toolName: 'arkme_group_member_add', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create(ports) {
    return defineTool({
      name: 'arkme_group_member_add',
      description: 'Add or invite 1-20 selected people to one Arkme group. Call only after an explicit current human request. Use only unchanged group_source_ref and candidate_ref values returned by Arkme tools. The Tool asks for conversational confirmation before performing the write.',
      parameters: {
        group_source_ref: { type: 'string', required: true, description: 'Account-bound group_chat source_ref returned by arkme_sources_list.' },
        candidate_refs: { type: 'array', items: { type: 'string' }, required: true, description: 'One to twenty account-bound candidate_ref values from arkme_group_member_candidates.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        return taggedJSON('Arkme 群成员添加结果', await ports.addGroupMembers(
          args.group_source_ref, args.candidate_refs, exec.signal,
        ))
      },
    })
  },
})

export const groupMemberToolModules: readonly ArkmeToolModule[] = [candidates, add]
export const groupToolModules = [createGroupToolModule, renameGroupToolModule] as const
