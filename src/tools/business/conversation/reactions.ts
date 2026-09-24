import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import type { ReactionRequest } from '../../../reaction-contract.js'

function request(raw: string, write: boolean): ReactionRequest {
  const input = JSON.parse(raw) as ReactionRequest
  const allowed = write ? ['set', 'library-set', 'history-policy-set', 'notifications-read'] : ['notifications', 'query', 'actors', 'groups', 'history', 'received', 'history-policy-query', 'library-query']
  if (!input || !allowed.includes(input.action) || typeof input.accountKey !== 'string') throw new TypeError('Invalid reaction request or action for this tool')
  return input
}
export const readReactionsToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.conversation.reactions-read.v1', toolName: 'arkme_reactions_read', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create(ports) { return defineTool({ name: 'arkme_reactions_read', description: 'Read authorized message reactions, actors, own dated reaction history or own phrase library. accountKey is environment:userId from current account. query targets use id, sourceRef and messageActionRef returned by conversation reads. World targets instead use id and worldRecordRef from World reads. Actions: notifications, query, actors, groups, history, received, history-policy-query, library-query. Locked history is denied, never bypass it. Never invent message references.', parameters: { request_json: { type: 'string', required: true, description: 'ReactionRequest JSON: accountKey and action; notifications after_id/limit (max50); query targets (max50); actors target/key/after_user_id/limit; history start_at/end_at/before_at/before_id/limit (UTC ms, max32 days); groups target/after_key/limit; received world_only/limit/before_at/before_id; history-policy-query and library-query no extra fields.' } }, output: TEXT_OUTPUT, async execute(args, exec) { return taggedJSON('表态', await ports.reactions(request(args.request_json, false), exec.signal)) } }) },
})
export const writeReactionsToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.conversation.reactions-write.v1', toolName: 'arkme_reactions_write', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create(ports) { return defineTool({ name: 'arkme_reactions_write', description: 'Only after an explicit user request, add/remove a message reaction or save the user phrase library. Query current revision first. Use a unique request_id and reuse exactly that request on uncertain failure; never auto-overwrite a revision conflict. set is explicit active true/false, not a toggle. No chat message is sent.', parameters: { request_json: { type: 'string', required: true, description: 'JSON accountKey; notifications-read requires items:[{id,revision}] (max50) from notifications read results and explicitly acknowledges viewed reactions. Other actions: set, library-set or history-policy-set; expected_revision. set and library-set require request_id. history-policy-set requires locked:boolean and must have explicit user authorization to unlock. set also target:{id,sourceRef,messageActionRef} or {id,worldRecordRef}, expression:{text,emoji?,hand?,color?}, active:boolean. library-set items: ordered expression array (max58); empty clears library only.' } }, output: TEXT_OUTPUT, async execute(args, exec) { return taggedJSON('表态保存结果', await ports.reactions(request(args.request_json, true), exec.signal)) } }) },
})
