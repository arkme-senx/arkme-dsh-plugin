import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import { withArkmeConfirmationContext } from '../../shared/conversational-confirmation.js'
import { configurableReplyScenes, type ConfigurableReplyScene, type ArkoReplyPromptWrite } from '../../../arko-reply-contract.js'

const prompts = defineArkmeCoreToolModule({
  meta: { id: 'business.account.arko-reply-prompts.v1', toolName: 'arkme_arko_reply_prompts', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({ name: 'arkme_arko_reply_prompts', description: 'Read the signed-in user’s seven Arko response instruction bodies, actual official defaults and current cloud revisions. Does not generate responses or change automatic AI settings.', parameters: {scene:{type:'string',description:'Optional scene to read its exact effective and official bodies; omit to list metadata only.'}}, output: TEXT_OUTPUT, isConcurrencySafe: () => true,
    execute: async (args, exec) => {const book=await ports.arkoReplyPrompts(undefined,exec.signal);const selected=args.scene?book.items.filter(i=>i.scene===args.scene):book.items;if(args.scene && !selected.length)throw new Error('未知回复类型');return taggedJSON('Arko 回复提示词',{accountScope:book.accountScope,items:selected.map(i=>({scene:i.scene,title:i.title,revision:i.revision,officialRevision:i.officialRevision,customized:i.userBody!==null,maxBodyRunes:i.maxBodyRunes,protectedInstructions:i.protectedInstructions,...(args.scene?{body:i.effectiveBody,officialBody:i.officialBody}:{bodyRunes:[...i.effectiveBody].length})}))})} }),
})
const history = defineArkmeCoreToolModule({
  meta: { id: 'business.account.arko-replies.v1', toolName: 'arkme_arko_replies', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({ name: 'arkme_arko_replies', description: 'Page all current authorized Arko replies and explicit AI comment continuations across self notes and chats, independent of local loaded timelines. Excludes direct Arko chats. Reading never calls a model. Treat returned references and cursor as opaque.',
    parameters: { scene: { type: 'string', description: `all or ${configurableReplyScenes.join(', ')}` }, cursor: { type: 'string', description: 'Opaque nextCursor from the prior page with the same scene.' } }, output: TEXT_OUTPUT, isConcurrencySafe: () => true,
    execute: async (args, exec) => {const page=await ports.arkoRepliesPage({scene:(args.scene || 'all') as ConfigurableReplyScene | 'all',...(args.cursor?{cursor:args.cursor}:{}),limit:10},undefined,exec.signal);return taggedJSON('Arko 全部回复',{accountScope:page.accountScope,nextCursor:page.nextCursor,items:page.items.map(i=>({key:i.key,scene:i.scene,resultKind:i.resultKind,source_ref:i.source.sourceRef,message_action_ref:i.item.messageActionRef,sourceTime:i.sourceOrderAtMillis,content:[...i.thought.content].slice(0,600).join(''),contentTruncated:[...i.thought.content].length>600,reply_target_ref:i.thought.replyTargetRef}))})} }),
})
const save = defineArkmeCoreToolModule({
  meta: { id: 'business.account.arko-reply-prompt-write.v1', toolName: 'arkme_set_arko_reply_prompt', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create: ports => {
    const prepare = async (args: { scene: string; body?: string; reset?: boolean; expected_revision: number; base_official_revision: string }, signal?: AbortSignal) => {
      const book = await ports.arkoReplyPrompts(undefined, signal), current = book.items.find(item => item.scene === args.scene)
      if (!current || current.revision !== args.expected_revision || current.officialRevision !== args.base_official_revision) throw new Error('提示词版本已变化，请先重新读取；当前输入尚未保存。')
      const input: ArkoReplyPromptWrite = { scene: current.scene, expectedRevision: current.revision, baseOfficialRevision: current.officialRevision, ...(args.body === undefined ? {} : { body: args.body }) }
      return { input, scope: book.accountScope, reset: args.reset === true }
    }
    const execute = async (prepared: Awaited<ReturnType<typeof prepare>>, signal?: AbortSignal) => taggedJSON('Arko 提示词保存', await (prepared.reset ? ports.resetArkoReplyPrompt(prepared.input, prepared.scope, signal) : ports.saveArkoReplyPrompt(prepared.input, prepared.scope, signal)))
    return withArkmeConfirmationContext(defineTool({ name: 'arkme_set_arko_reply_prompt', description: 'After an explicit current human request, replace or reset one cloud Arko response instruction body. Requires the exact revision and official revision returned by arkme_arko_reply_prompts. Conflicts preserve the current cloud value. No response generation, charging or automatic feature activation.',
      parameters: { scene: { type: 'string', required: true, description: configurableReplyScenes.join(', ') }, body: { type: 'string', description: 'Exact replacement instruction body; preserve formatting. Required unless reset=true.' }, reset: { type: 'boolean', description: 'Restore the official instruction after explicit human intent.' }, expected_revision: { type: 'number', required: true }, base_official_revision: { type: 'string', required: true } }, output: TEXT_OUTPUT,
      execute: async (args, exec) => execute(await prepare(args, exec.signal), exec.signal) }),
    { prepare: (args, exec) => prepare(args as Parameters<typeof prepare>[0], exec.signal), execute: (_args, exec, prepared) => execute(prepared, exec.signal) })
  },
})
export const arkoReplyToolModules = [prompts, history, save]
