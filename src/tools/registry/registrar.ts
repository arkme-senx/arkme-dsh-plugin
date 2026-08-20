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
} from '../shared/conversational-confirmation.js'
import { arkmeToolCatalog } from './catalog.js'

const CORE_CONFIRMATION_TOOLS = new Set([
  'arkme_id_set',
  'arkme_bot_openclaw_connect',
  'arkme_extension_review_create',
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
      const result = await conversation.prepareOrExecute({
        agent: exec.agent as Agent,
        operationKey: definition.name,
        arguments: args,
        question,
        execute: async () => await definition.execute(args, exec),
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
