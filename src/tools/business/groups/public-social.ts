import type { PublicSocialReadInput, PublicSocialWriteInput } from '../../../public-social-contract.js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const publicSocialToolModules = [
  defineArkmeCoreToolModule({
    meta: { id: 'business.social.read.v1', toolName: 'arkme_social_read', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
    create: ports => defineTool({
      name: 'arkme_social_read', description: 'Discover public groups or people, read your listing, or read group settings and pending join requests. References and pagination are account-bound. Use existing group source_ref for settings/requests, a returned person reference to read that public person, and pass returned accountScope unchanged to writes. No messages are read or sent.',
      parameters: {
        operation: { type: 'string', enum: ['groups', 'people', 'person', 'settings', 'requests'], required: true, description: 'Business read.' },
        account_scope: { type: 'string', description: 'Optional accountScope from the preceding read; rejects account changes.' },
        reference: { type: 'string', description: 'Unchanged reference or group source_ref as specified above.' },
        query: { type: 'string', description: 'Directory search text, at most 100 characters.' },
        cursor: { type: 'string', description: 'Unchanged opaque nextCursor from the same read.' },
      }, output: TEXT_OUTPUT,
      execute: async (args, exec) => taggedJSON('Arkme 公开社交', await ports.publicSocialRead({ operation: args.operation as PublicSocialReadInput['operation'], ...(args.account_scope ? { accountScope: args.account_scope } : {}), ...(args.reference ? { reference: args.reference } : {}), ...(args.query ? { query: args.query } : {}), ...(args.cursor ? { cursor: args.cursor } : {}) }, exec.signal)),
    }),
  }),
  defineArkmeCoreToolModule({
    meta: { id: 'business.social.write.v1', toolName: 'arkme_social_write', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
    create: ports => defineTool({
      name: 'arkme_social_write', description: 'Join a public group, open a public person’s existing private chat, publish/unpublish your listing, set group visibility/showcase, or approve/reject one pending request. Call only after an explicit human request and conversational confirmation. Rechecks server permissions. Never sends a message or adds a friend automatically.',
      parameters: {
        operation: { type: 'string', enum: ['join', 'chat', 'listing', 'group', 'showcase', 'resolve'], required: true, description: 'Business write.' },
        account_scope: { type: 'string', required: true, description: 'Unchanged accountScope from arkme_social_read.' },
        reference: { type: 'string', description: 'Directory reference for join/chat; group source_ref for group/showcase/resolve.' },
        request_id: { type: 'string', description: 'Stable UUID for join; reuse after an uncertain failure.' },
        request_ref: { type: 'string', description: 'Unchanged requestRef from requests read; required for resolve.' },
        enabled: { type: 'boolean', description: 'Required for listing/group/showcase/resolve. For resolve: true approves, false rejects.' },
        introduction: { type: 'string', description: 'Listing or group introduction, at most 500 characters. Omit to retain the saved introduction; pass an empty string only to clear it.' },
      }, output: TEXT_OUTPUT,
      execute: async (args, exec) => taggedJSON('Arkme 公开社交处理结果', await ports.publicSocialWrite({ operation: args.operation as PublicSocialWriteInput['operation'], accountScope: args.account_scope, ...(args.reference ? { reference: args.reference } : {}), ...(args.request_id ? { requestId: args.request_id } : {}), ...(args.request_ref ? { requestRef: args.request_ref } : {}), ...(args.enabled === undefined ? {} : { enabled: args.enabled }), ...(args.introduction === undefined ? {} : { introduction: args.introduction }) }, exec.signal)),
    }),
  }),
] as const
