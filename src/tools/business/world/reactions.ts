import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import type { WorldReactionRequest, WorldReactionArchiveRequest } from '../../../world-reaction-contract.js'

export const worldReactionReadTool = defineArkmeCoreToolModule({
  meta: { id: 'business.world.reactions-read.v1', toolName: 'arkme_world_reactions_read', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create(ports) { return defineTool({ name: 'arkme_world_reactions_read', description: 'Read cloud World reactions. First prepare current references from World recordRefs. Use returned opaque targets unchanged; they bind one publication version. Owner archive is read-only and never grants old content/media access. Notifications return a separate recordRef for public World navigation; never use their version-bound target.worldRecordRef as a content reference. Own history can return a target and own current state for retracting a historical reaction. Never upload local reactions automatically.', parameters: {
    request_json: { type: 'string', required: true, description: 'JSON accountKey (environment:userId). action prepare requires recordRefs (1..50). action from-note requires the owned original sourceRef and messageActionRef; derived private sources do not refer to published copies. Other actions: query targets; actors target/key/after_user_id/limit; groups target/after_key/limit; history start_at/end_at/limit/before_at/before_id; received limit; notifications limit/after_id/include_read. Optional archive:true only for owner query/actors/groups.' },
  }, output: TEXT_OUTPUT, async execute(args, exec) {
    const input = JSON.parse(args.request_json) as WorldReactionRequest & { archive?: boolean; recordRefs?: string[]; sourceRef?: string; messageActionRef?: string }
    if (!input || typeof input.accountKey !== 'string') throw new TypeError('Invalid World reaction request')
    if (String(input.action) === 'from-note') {
      if (!input.sourceRef || !input.messageActionRef) throw new TypeError('Original note references required')
      return taggedJSON('原件世界表态', await ports.prepareNoteWorldReactions(input.accountKey, input.sourceRef, input.messageActionRef, exec.signal))
    }
    if (String(input.action) === 'prepare') return taggedJSON('世界表态上下文', await ports.prepareWorldReactions(input.accountKey, input.recordRefs ?? [], exec.signal))
    if (input.archive === true) {
      if (!['query', 'actors', 'groups'].includes(input.action)) throw new TypeError('World archive is read-only')
      return taggedJSON('世界表态归档', await ports.worldReactionArchive(input as WorldReactionArchiveRequest, exec.signal))
    }
    if (!['query', 'actors', 'groups', 'history', 'received', 'notifications'].includes(input.action)) throw new TypeError('Invalid World reaction read action')
    return taggedJSON('世界表态', await ports.worldReactions(input, exec.signal))
  } }) },
})
export const worldReactionWriteTool = defineArkmeCoreToolModule({
  meta: { id: 'business.world.reactions-write.v1', toolName: 'arkme_world_reactions_write', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create(ports) { return defineTool({ name: 'arkme_world_reactions_write', description: 'Only on explicit user request, add/retract a cloud World reaction or acknowledge viewed notifications. Requires a prepared/history target. Query the revision first; reuse the exact request_id on uncertain failure and never overwrite conflicts. Historical retraction only changes your own reaction and does not reopen content.', parameters: {
    request_json: { type: 'string', required: true, description: 'JSON accountKey. set: target, expression:{text,emoji?,hand?,color?}, active:boolean, expected_revision, request_id. notifications-read: items:[{id,revision}] from a notification read (max50). No local reaction import.' },
  }, output: TEXT_OUTPUT, async execute(args, exec) {
    const input = JSON.parse(args.request_json) as WorldReactionRequest
    if (!input || typeof input.accountKey !== 'string' || !['set', 'notifications-read'].includes(input.action)) throw new TypeError('Invalid World reaction write action')
    return taggedJSON('世界表态结果', await ports.worldReactions(input, exec.signal))
  } }) },
})
