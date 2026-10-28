import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolArgsError, validateJsonSchemaValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { isArkmeContextToolModule, isArkmeCoreToolModule } from '../contract/module.js'
import type { ArkmeToolModule, ArkmeToolProfile } from '../contract/module.js'
import type { ArkmeCoreToolPorts, ArkmeToolPorts } from '../ports/index.js'
import { promptForArkmeToolProfile } from '../prompts/index.js'
import {
  ARKME_CONVERSATIONAL_CONFIRMATION_PROMPT,
  ArkmeConversationalConfirmation,
  arkmeConfirmationContextHooks,
} from '../shared/conversational-confirmation.js'
import { registerGroupGovernanceConfirmation, type GroupGovernancePresentation } from './group-governance-confirmation.js'
import { arkmeToolCatalog } from './catalog.js'

const CORE_CONFIRMATION_TOOLS = new Set([
  'arkme_recording_strategy_start',
  'arkme_realtime_dictation',
  'arkme_recording_strategy_preference',
  'arkme_arko_change_lifecycle',
  'arkme_device_lock', 'arkme_device_unlock_request',
  'arkme_day_review_generate',
  'arkme_conversation_words_generate',
  'arkme_message_sync_retry',
  'arkme_recording_speaker_correct',
  'arkme_team_profile_update', 'arkme_team_external_chat_share', 'arkme_team_message_send', 'arkme_team_message_forward', 'arkme_team_message_copy_link', 'arkme_team_message_report', 'arkme_team_send_task', 'arkme_team_mark_change',
  'arkme_team_notification_policy_set',
  'arkme_team_entry_preference_change',
  'arkme_reactions_write',
  'arkme_dsh_annotations_write',
  'arkme_bot_conversation_pin',
  'arkme_direct_message_refusal_set',
  'arkme_topic_home_visibility',
  'arkme_archive_set',
  'arkme_official_notifications_read',
  'arkme_background_sound_disable',
  'arkme_disable_automatic_ai',
  'arkme_file_prepare',
  'arkme_files_send',
  'arkme_file_task',
  'arkme_recording_import',
  'arkme_recording_import_folder',
  'arkme_id_set',
  'arkme_record_reedit',
  'arkme_bot_openclaw_connect',
  'arkme_extension_review_create',
  'arkme_group_member_add',
  'arkme_group_member_remove',
  'arkme_group_self_nickname_set',
  'arkme_group_join_restriction_set',
  'arkme_message_withdraw',
  'arkme_contact_add',
  'arkme_team_join',
  'arkme_contact_private_chat_open',
  'arkme_group_create',
  'arkme_group_rename',
  'arkme_world_voiceprint_invite',
  'arkme_world_private_chat_open',
  'arkme_voiceprint_invite',
  'arkme_voiceprint_recognized_person_invite',
  'arkme_voiceprint_revoke',
  'arkme_voiceprint_restore_playback',
  'arkme_user_ban',
  'arkme_user_unban',
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
  phase: 'host' | 'attachments',
): ToolDefinition[] {
  return arkmeToolCatalog.modulesFor(profile, phase).filter(isArkmeContextToolModule)
    .map(module => validateMaterializedTool(module, module.create(ctx, ports)))
}

function cleanArgument(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  const cleaned = value.trim().replace(/[\u0000-\u001F\u007F]/g, ' ')
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned
}

function coreConfirmationQuestion(name: string, args: Record<string, unknown>): string {
  if (name === 'arkme_realtime_dictation') return '是否对刚才提供的音频执行实时听写操作？这会使用当前账号的语音权益，不获取麦克风或发送消息。'
  if (name === 'arkme_recording_strategy_preference') return `是否将当前账号的统一录音处理策略设为${args.strategy === 'baseline-sd-asr/20261026' ? '默认版' : '测试版v1'}？新录音和新提交的导入使用此设置，已提交任务保持原方案。`
  if (name === 'arkme_recording_strategy_start') return `是否使用${args.strategy === 'baseline-sd-asr/20261026' ? '默认版' : '测试版v1'}处理刚才指定的录音，生成独立对比结果？这会增加处理与存储用量，不会替换正式正文或说话人绑定。`
  if (name === 'arkme_arko_change_lifecycle') return `是否${args.action === 'restore' ? '恢复' : '删除'}刚才选定的 ${Array.isArray(args.message_refs) ? args.message_refs.length : 0} 条 Arko 消息？删除后 30 天内可恢复，已创建的快记和安排会保留。`
  if (name === 'arkme_conversation_words_generate') return '是否按刚才指定的对话、人员和日期范围开始或更新词频统计？这不会调用大模型或扣除 AI 积分。'
  if (name === 'arkme_device_lock') return '是否锁定当前电脑上的即我？'
  if (name === 'arkme_device_unlock_request') return '是否发起当前电脑的解锁验证？仍需手机确认或电脑密码验证。'
  if (name === 'arkme_day_review_generate') return `是否${args.action === 'reconcile' ? '核对原提交' : args.action === 'resume' ? '继续原任务' : '生成'} ${cleanArgument(args.date, 10)} 的完整日回顾？模型用量使用当前账号的 AI 积分，已完成的付费步骤会保留。`
  if (name === 'arkme_message_sync_retry') return '是否重新检查当前账号的消息同步？这不会发送消息或改变阅读位置。'
  if (name === 'arkme_recording_speaker_correct') return args.action === 'undo' ? '是否撤销刚才指定的说话人纠错？后续人工修改会受到保护。' : '是否保存刚才逐段确认的说话人纠错与声音来源？范围仅限明确选中的片段。'
  if (name === 'arkme_team_join') return `是否确认加入团队“${cleanArgument(args.jotmo_id, 64)}”？需要审批时将提交入队申请。`
  if (name === 'arkme_team_external_chat_share') return args.operation === 'unshare' ? '是否取消这段对外私聊的团队共享？双方原私聊仍会保留。' : '是否将这段私聊共享到选定团队？全体现任成员将能查看完整历史和后续消息，包括隐私锁定消息及附件。'
  if (name === 'arkme_team_entry_preference_change') return '是否确认修改刚才指定团队入口的本人置顶或移除设置？此设置会在你的设备同步，不删除消息、不退出团队，也不修改已读或免打扰。'
  if (name === 'arkme_team_notification_policy_set') return `是否确认${args.muted === true ? '开启' : '关闭'}刚才选定团队对话的个人消息免打扰？消息和未读记录仍会保留。`;
  if (name === 'arkme_team_profile_update') return `是否确认保存刚才选定的团队资料${typeof args.name === 'string' ? `，名称为“${cleanArgument(args.name, 64)}”` : ''}${args.avatar_action === 'default' ? '，恢复默认头像' : args.avatar_action === 'custom' ? '，使用所选图片作为头像' : ''}？`;
  if (name === 'arkme_official_notifications_read') return args.all === true ? '是否将当前全部官方通知标记为已读？' : '是否将指定的官方通知标记为已读？'
  if (name === 'arkme_dsh_annotations_write') return '是否确认添加或取消刚才指定的 DSH 个人标记？该标记会在同账号设备同步，不修改原文。'
  if (name === 'arkme_reactions_write') {
    const request = JSON.parse(String(args.request_json)) as Record<string, unknown>
    if (request.action === 'history-policy-set') return request.locked === true
      ? '是否确认锁定自己的表态操作记录？锁定后时间轴、数据管理和 AI 都不能读取这些记录。'
      : '是否确认解锁自己的表态操作记录，恢复时间轴、数据管理和 AI 的读取？'
    if (request.action === 'notifications-read') return '是否将刚才指定的表态提醒标记为已查看？'
    if (request.action === 'library-set') return '是否确认保存刚才指定的短语、颜色和顺序？这不会发送表态。'
    return request.active === true ? '是否确认给刚才指定的消息添加这个表态？' : '是否确认取消刚才指定的表态？'
  }
  if (name === 'arkme_direct_message_refusal_set') return args.refused === true
    ? '是否确认拒收这个私聊用户的消息？拒收期间双方都无法发送新消息，历史记录保留。'
    : '是否确认解除你对这个私聊用户的拒收？如果对方仍拒收，双方依然无法发送新消息。'
  if (name === 'arkme_recording_import') return args.action === 'retry'
    ? '是否确认重试这条失败的录音上传任务？'
    : `是否确认按指定的开始时间导入所选${Array.isArray(args.files) ? ` ${args.files.length} 个` : ''}录音，并将归属设为“${args.ownership === 'other' ? '其他' : '自己'}”？服务支持时，新录音处理完成后将发送通知，并自动生成对应日期的日总结和时间轴。`
  if (name === 'arkme_archive_set') return args.self_archived === true
    ? '是否确认归档此主题及其子主题？内容仍可搜索和引用，可在已归档中恢复。'
    : '是否确认取消此主题的单独归档？独立归档的子主题会保留；如果父级仍归档，此主题仍随父级归档。'
  if (name === 'arkme_team_mark_change') return cleanArgument(args.audience,30)==='team' ? '是否确认修改这条消息的团队内部共享标记？' : '是否确认修改此会话双方都可见的共享标记？'
  if (name === 'arkme_team_message_forward') return '是否确认将所选团队消息转发到指定目标？目标中的冻结内容和附件将按其当前访问权限提供。'
  if (name === 'arkme_team_message_copy_link') return '是否确认生成所选团队消息的公开分享链接？取得链接的人可按分享审核规则查看这些内容。'
  if (name === 'arkme_team_message_report') return '是否确认将这条团队消息的当前版本举报给平台审核？这不会删除作者的个人快记。'
  if (name === 'arkme_team_send_task') return cleanArgument(args.action, 30) === 'cancel'
    ? '是否确认取消这条尚未发布的团队发送任务？已发布消息仍遵循作者全局删除规则。'
    : '是否确认继续原团队发送任务？将保留原请求身份，不创建重复消息。'
  if (name === 'arkme_team_message_send') return '是否确认将这段文字发送到已选择的团队对外会话？引用和正文将按当前权限与版本校验。'
  if (name === 'arkme_topic_home_visibility') return args.show_in_home === true
    ? '是否确认将这个主题的快记展示在首页？'
    : '是否确认在首页隐藏这个主题的快记？主题与快记不会被删除。'
  if (name === 'arkme_disable_automatic_ai') return `是否关闭自动 AI 功能“${cleanArgument(args.key, 40)}”？关闭后不再开始新的模型调用，已经发出的调用可能完成并产生费用。`
  if (name === 'arkme_background_sound_disable') return '是否确认关闭当前 Arkme 账号的文字背景音？这不会删除已经发送的背景音。'
  if (name === 'arkme_user_ban') return '是否确认封禁这个私聊用户？确认后将无法重新登录；Backend、聊天和录音请求立即受限；其他仅离线验 JWT 的服务中，旧 Access Token 最迟约 1 小时失效。'
  if (name === 'arkme_user_unban') return '是否确认解封这个私聊用户？确认后该用户可重新登录并恢复操作。'
  if (name === 'arkme_file_prepare') return `是否确认将“${cleanArgument(args.file_name, 100)}”暂存到本地？这一步不会上传或发送。`
  if (name === 'arkme_files_send') return `是否确认向刚才指定的 Arkme 会话发送这 ${Array.isArray(args.file_refs) ? args.file_refs.length : 0} 个文件及附带文字？确认后开始上传。`
  if (name === 'arkme_file_task') return cleanArgument(args.action, 30) === 'open-local'
    ? '是否确认使用本机默认应用打开这个 Arkme 文件？'
    : `是否确认执行文件任务操作“${cleanArgument(args.action, 30)}”？移除本地任务不会撤回已发送的消息。`
  if (name === 'arkme_group_member_add') {
    const count = Array.isArray(args.candidate_refs) ? args.candidate_refs.length : 0
    return `是否确认向这个群聊添加或邀请 ${String(count)} 位成员？成员加入后将可以看到群内后续消息。`
  }
  if (name === 'arkme_group_self_nickname_set') return '是否确认将你在这个群聊中的昵称修改为“' + cleanArgument(args.nickname, 40) + '”？'
  if (name === 'arkme_group_member_remove') {
    return args.prevent_rejoin === true
      ? '是否确认将这位成员移出群聊，并禁止其再次加入？'
      : '是否确认将这位成员移出群聊？本次不会禁止其以后再次加入。'
  }
  if (name === 'arkme_group_join_restriction_set') {
    return args.restricted === true
      ? '是否确认禁止这位用户以后再次加入该群？此操作本身不会移除当前活跃成员。'
      : '是否确认解除这位用户的群聊加入限制？'
  }
  if (name === 'arkme_message_withdraw') {
    return '是否确认撤回这条群消息？撤回后所有群成员都无法再查看，但不会移除或限制发送者。'
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
      const violations = validateJsonSchemaValue(definition.parameters, args, '')
      if (violations.length > 0) throw new ToolArgsError(violations)
      if (definition.name === 'arkme_recording_import'
        && typeof args === 'object' && args !== null && 'action' in args && args.action === 'status') {
        return await definition.execute(args, exec)
      }
      if (definition.name === 'arkme_topic_home_visibility' && (args as Record<string, unknown>).show_in_home === undefined) {
        return await definition.execute(args, exec)
      }
      if (definition.name === 'arkme_realtime_dictation') {
        const request = JSON.parse(String((args as Record<string, unknown>).request_json)) as { action?: string }
        // The confirmed start returns a short-lived account-bound capability; audio/control use it.
        if (['audio', 'status', 'finish', 'cancel'].includes(request.action ?? '')) return await definition.execute(args, exec)
      }
      if (exec.agent === undefined) throw new Error('该 Arkme 操作必须在一个真实 DSH Agent 会话中执行')
      const hooks = arkmeConfirmationContextHooks(definition)
      const request = hooks?.confirmationRequest?.(args)
      const result = await conversation.prepareOrExecute({
        agent: exec.agent as Agent,
        callId: exec.callId, rootCallId: exec.rootCallId,
        operationKey: definition.name,
        arguments: request === undefined ? args : request.arguments,
        ...(request === undefined ? {} : { forcePrepare: request.forcePrepare }),
        question: hooks?.question === undefined ? coreConfirmationQuestion(
          definition.name,
          typeof args === 'object' && args !== null ? args as Record<string, unknown> : {},
        ) : prepared => hooks.question!(args, prepared),
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
  presentation?: GroupGovernancePresentation,
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
  registerGroupGovernanceConfirmation(ctx, coreConversation, presentation)
  for (const definition of createArkmeCoreToolDefinitions(ports, profile)) {
    ctx.tools.register(withCoreConversationalConfirmation(definition, coreConversation))
  }
  for (const definition of createArkmeContextToolDefinitions(ctx, ports, profile, 'host')) ctx.tools.register(definition)
  if (arkmeToolCatalog.modulesFor(profile, 'attachments').length === 0) return
  ctx.inject(['attachments'], imageCtx => {
    for (const definition of createArkmeContextToolDefinitions(imageCtx, ports, profile, 'attachments')) {
      imageCtx.tools.register(definition)
    }
  })
}
