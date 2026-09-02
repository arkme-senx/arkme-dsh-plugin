import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { isArkmeContextToolModule, isArkmeCoreToolModule } from '../contract/module.js'
import type { ArkmeToolModule, ArkmeToolProfile } from '../contract/module.js'
import type { ArkmeCoreToolPorts, ArkmeToolPorts } from '../ports/index.js'
import { promptForArkmeToolProfile } from '../prompts/index.js'
import {
  ARKME_CONVERSATIONAL_CONFIRMATION_PROMPT,
  ArkmeConversationalConfirmation,
  arkmeConfirmationContextHooks,
} from '../shared/conversational-confirmation.js'
import { arkmeToolCatalog } from './catalog.js'

const CORE_CONFIRMATION_TOOLS = new Set([
  'arkme_background_sound_disable',
  'arkme_file_prepare',
  'arkme_files_send',
  'arkme_file_task',
  'arkme_id_set',
  'arkme_bot_openclaw_connect',
  'arkme_extension_review_create',
  'arkme_group_member_add',
  'arkme_contact_add',
  'arkme_contact_private_chat_open',
  'arkme_group_create',
  'arkme_group_rename',
  'arkme_world_voiceprint_invite',
  'arkme_world_private_chat_open',
  'arkme_voiceprint_invite',
  'arkme_voiceprint_recognized_person_invite',
  'arkme_voiceprint_revoke',
  'arkme_voiceprint_restore_playback',
])

function validateMaterializedTool(module: ArkmeToolModule, definition: ToolDefinition): ToolDefinition {
  if (definition.name !== module.meta.toolName) {
    throw new Error(`Arkme tool module "${module.meta.id}" declared "${module.meta.toolName}" but created "${definition.name}"`)
  }
  return definition
}

export function createArkmeCoreToolDefinitions(
  ports: ArkmeCoreToolPorts,
  profile: ArkmeToolProfile = 'business',
): ToolDefinition[] {
  return arkmeToolCatalog.modulesFor(profile).filter(isArkmeCoreToolModule)
    .map(module => validateMaterializedTool(module, module.create(ports)))
}

function createArkmeContextToolDefinitions(
  ctx: Context,
  ports: ArkmeToolPorts,
  profile: ArkmeToolProfile,
): ToolDefinition[] {
  return arkmeToolCatalog.modulesFor(profile).filter(isArkmeContextToolModule)
    .map(module => validateMaterializedTool(module, module.create(ctx, ports)))
}

function cleanArgument(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  const cleaned = value.trim().replace(/[\u0000-\u001F\u007F]/g, ' ')
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned
}

function coreConfirmationQuestion(name: string, args: Record<string, unknown>): string {
  if (name === 'arkme_background_sound_disable') return '是否确认关闭当前 Arkme 账号的文字背景音？这不会删除已经发送的背景音。'
  if (name === 'arkme_file_prepare') return `是否确认将“${cleanArgument(args.file_name, 100)}”暂存到本地？这一步不会上传或发送。`
  if (name === 'arkme_files_send') return `是否确认向刚才指定的 Arkme 会话发送这 ${Array.isArray(args.file_refs) ? args.file_refs.length : 0} 个文件及附带文字？确认后开始上传。`
  if (name === 'arkme_file_task') return cleanArgument(args.action, 30) === 'open-local'
    ? '是否确认使用本机默认应用打开这个 Arkme 文件？'
    : `是否确认执行文件任务操作“${cleanArgument(args.action, 30)}”？移除本地任务不会撤回已发送的消息。`
  if (name === 'arkme_group_member_add') {
    const count = Array.isArray(args.candidate_refs) ? args.candidate_refs.length : 0
    return `是否确认向这个群聊添加或邀请 ${String(count)} 位成员？成员加入后将可以看到群内后续消息。`
  }
  if (name === 'arkme_contact_add') {
    const remark = cleanArgument(args.remark, 100)
    return remark === ''
      ? '是否确认添加刚才搜索到的这个联系人并打开会话？'
      : `是否确认添加刚才搜索到的这个联系人、备注为“${remark}”并打开会话？`
  }
  if (name === 'arkme_contact_private_chat_open') {
    return '是否确认打开刚才搜索到的这个已注册 Arkme 用户的私聊？'
  }
  if (name === 'arkme_group_create') {
    const title = cleanArgument(args.title, 80)
    return title === '' ? '是否确认创建这个群聊？' : `是否确认创建群聊“${title}”？`
  }
  if (name === 'arkme_group_rename') {
    const title = cleanArgument(args.title, 80)
    return title === ''
      ? '是否确认修改这个群聊的名称？'
      : `是否确认将这个群聊的名称修改为“${title}”？`
  }
  if (name === 'arkme_world_voiceprint_invite') {
    return '是否确认给这条世界动态的发布者发送一条私聊，邀请对方开启声纹？'
  }
  if (name === 'arkme_world_private_chat_open') {
    return '是否确认打开与这条世界动态作者的私聊？'
  }
  if (name === 'arkme_voiceprint_invite') {
    return '是否确认生成一条 24 小时有效的声纹播放授权邀请链接？链接会显示给你，但不会自动发送给任何人。'
  }
  if (name === 'arkme_voiceprint_recognized_person_invite') {
    return cleanArgument(args.target_contact_ref, 256) === ''
      ? '是否确认为这个已识别声音的当前绑定用户生成播放授权邀请？链接会显示给你，但不会自动发送。'
      : '是否确认针对这个尚未绑定的已识别声音，为刚才搜索到的 Arkme 用户生成认领与播放授权邀请？链接会显示给你，但不会自动发送。'
  }
  if (name === 'arkme_voiceprint_revoke') {
    return '是否确认撤销这位用户的声纹播放授权？这不会删除已有识别数据；如需恢复，必须由对方重新接受邀请。'
  }
  if (name === 'arkme_voiceprint_restore_playback') {
    return '是否确认使用留底参考音频恢复你的声纹播放能力？这可能调用当前配置的声音复刻服务。'
  }
  if (name === 'arkme_bot_openclaw_connect') {
    return '是否确认连接这个 Bot 到本机 OpenClaw？这会读取该 Bot 凭据、安装固定版本 Channel、创建独立 Agent；如有待应用配置，还会重启指定 profile 的 Gateway 并短暂影响其中全部 Agent。同一 Bot 已在别处在线时可能发生接管。'
  }
  if (name === 'arkme_id_set') {
    const display = cleanArgument(args.arkme_id, 64)
    return display === ''
      ? 'Arkme ID 通常只能修改一次。是否确认执行本次设置？'
      : `Arkme ID 通常只能修改一次。是否确认将当前账号的 Arkme ID 设置为“${display}”？`
  }
  const extensionId = cleanArgument(args.extension_id, 128)
  const parentRef = cleanArgument(args.parent_review_ref, 128)
  const rating = typeof args.rating === 'number' && Number.isSafeInteger(args.rating) ? args.rating : undefined
  return parentRef === ''
    ? `是否确认向扩展 ${extensionId} 发表 ${String(rating ?? '?')} 星评价？评论正文也会作为普通快记显示在首页。`
    : `是否确认回复扩展 ${extensionId} 的这条评论？回复正文也会作为普通快记显示在首页。`
}

function withCoreConversationalConfirmation(
  definition: ToolDefinition,
  conversation: ArkmeConversationalConfirmation,
): ToolDefinition {
  if (!CORE_CONFIRMATION_TOOLS.has(definition.name)) return definition
  return {
    ...definition,
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('该 Arkme 操作必须在一个真实 DSH Agent 会话中执行')
      const question = coreConfirmationQuestion(
        definition.name,
        typeof args === 'object' && args !== null ? args as Record<string, unknown> : {},
      )
      const hooks = arkmeConfirmationContextHooks(definition)
      const result = await conversation.prepareOrExecute({
        agent: exec.agent as Agent,
        operationKey: definition.name,
        arguments: args,
        question,
        ...(hooks === undefined ? {} : { prepare: async () => await hooks.prepare(args, exec) }),
        execute: async preparedContext => hooks === undefined
          ? await definition.execute(args, exec)
          : await hooks.execute(args, exec, preparedContext),
      })
      return typeof result === 'string' ? result : JSON.stringify(result, undefined, 2)
    },
  }
}

export function registerArkmeTools(
  ctx: Context,
  ports: ArkmeToolPorts,
  profile: ArkmeToolProfile = 'business',
): void {
  const prompt = promptForArkmeToolProfile(profile)
  if (prompt !== '') {
    ctx.systemPrompt.section({
      name: 'tool:arkme',
      order: 116,
      text: () => promptForArkmeToolProfile(profile, { attachments: ctx.get('attachments') !== undefined }),
    })
    ctx.systemPrompt.section({
      name: 'tool:arkme-conversational-confirmation',
      order: 118,
      text: () => ARKME_CONVERSATIONAL_CONFIRMATION_PROMPT,
    })
  }
  const coreConversation = new ArkmeConversationalConfirmation()
  for (const definition of createArkmeCoreToolDefinitions(ports, profile)) {
    ctx.tools.register(withCoreConversationalConfirmation(definition, coreConversation))
  }
  if (arkmeToolCatalog.modulesFor(profile, 'attachments').length === 0) return
  ctx.inject(['attachments'], imageCtx => {
    for (const definition of createArkmeContextToolDefinitions(imageCtx, ports, profile)) {
      imageCtx.tools.register(definition)
    }
  })
}
