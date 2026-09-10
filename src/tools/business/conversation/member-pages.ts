import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const memberPageToolModules = [
  defineArkmeCoreToolModule({
    meta: { id: 'business.conversation.member-page.v1', toolName: 'arkme_source_members_page', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
    create: ports => defineTool({
      name: 'arkme_source_members_page',
      description: 'List chat members, up to 100 per page. Continue with nextCursor. Use arkme_source_members_presentation for names, avatars, statistics and current membership checks.',
      parameters: {
        source_ref: { type: 'string', required: true, description: 'Unchanged chat source_ref.' },
        cursor: { type: 'string', description: 'Opaque nextCursor from the previous page.' },
        limit: { type: 'integer', description: '1-100 members per page, defaults to 50.' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      execute: async (args, exec) => taggedJSON('Arkme 成员分页', await ports.pageSourceMembers(args.source_ref, {
        ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
        ...(args.limit === undefined ? {} : { limit: args.limit }), signal: exec.signal,
      })),
    }),
  }),
  defineArkmeCoreToolModule({
    meta: { id: 'business.conversation.member-presentation.v1', toolName: 'arkme_source_members_presentation', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
    create: ports => defineTool({
      name: 'arkme_source_members_presentation',
      description: 'Read names, avatars, statistics and current membership for 1-50 member references. Use mentionDisplayName for public mentions; displayName may contain a private contact remark.',
      parameters: {
        source_ref: { type: 'string', required: true, description: 'Unchanged chat source_ref.' },
        member_refs: { type: 'array', required: true, items: { type: 'string' }, description: '1-50 distinct opaque member_ref values.' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      execute: async (args, exec) => taggedJSON('Arkme 成员资料', await ports.sourceMembersPresentation(args.source_ref, args.member_refs, { signal: exec.signal })),
    }),
  }),
  defineArkmeCoreToolModule({
    meta: { id: 'business.conversation.member-cache.v1', toolName: 'arkme_source_members_cached', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
    create: ports => defineTool({
      name: 'arkme_source_members_cached',
      description: 'Read locally saved chat members and their saved time. Use arkme_source_members_page to check current membership.',
      parameters: { source_ref: { type: 'string', required: true, description: 'Unchanged chat source_ref bound to this account.' } },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      execute: async (args, exec) => taggedJSON('Arkme 本地成员缓存', await ports.cachedSourceMembers(args.source_ref, exec.signal) ?? null),
    }),
  }),
]
