import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { isArkmeContextToolModule, isArkmeCoreToolModule } from '../contract/module.js'
import type { ArkmeToolModule, ArkmeToolProfile } from '../contract/module.js'
import type { ArkmeCoreToolPorts, ArkmeToolPorts } from '../ports/index.js'
import { promptForArkmeToolProfile } from '../prompts/index.js'
import { arkmeToolCatalog } from './catalog.js'

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
  }
  for (const definition of createArkmeCoreToolDefinitions(ports, profile)) ctx.tools.register(definition)
  const toolNames = arkmeToolCatalog.toolNamesFor(profile)
  if (toolNames.includes('arkme_id_set') || toolNames.includes('arkme_bot_openclaw_connect')
    || toolNames.includes('arkme_extension_review_create')) {
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.name !== 'arkme_id_set' && exec.name !== 'arkme_bot_openclaw_connect'
        && exec.name !== 'arkme_extension_review_create') return await next()
      const decision = await next()
      if (decision.kind !== 'allow') return decision
      if (exec.name === 'arkme_bot_openclaw_connect') {
        return {
          kind: 'ask',
          reason: '确认连接这个 Bot 到本机 OpenClaw 吗？这会读取该 Bot 凭据、安装固定版本 Channel、创建独立 Agent；若有待应用配置，重试本操作会重启指定 profile 的 Gateway 并短暂影响其中全部 Agent。同一 Bot 已在别处在线时可能发生接管。',
        }
      }
      const args = exec.arguments as Record<string, unknown>
      if (exec.name === 'arkme_id_set') {
        const raw = typeof args.arkme_id === 'string' ? args.arkme_id.trim() : ''
        const sanitized = raw.replace(/[\u0000-\u001F\u007F]/g, ' ')
        const display = sanitized.length > 64 ? `${sanitized.slice(0, 64)}…` : sanitized
        return {
          kind: 'ask',
          reason: display === ''
            ? 'Arkme ID 通常只能修改一次。确认执行本次设置吗？'
            : `Arkme ID 通常只能修改一次。确认将当前账号的 Arkme ID 设置为“${display}”吗？`,
        }
      }
      const extensionId = typeof args.extension_id === 'string' ? args.extension_id.trim().slice(0, 128) : ''
      const parentRef = typeof args.parent_review_ref === 'string' ? args.parent_review_ref.trim() : ''
      const rating = typeof args.rating === 'number' && Number.isSafeInteger(args.rating) ? args.rating : undefined
      return {
        kind: 'ask',
        reason: parentRef === ''
          ? `确认向扩展 ${extensionId} 发表 ${String(rating ?? '?')} 星评价吗？评论正文也会作为普通快记显示在首页。`
          : `确认回复扩展 ${extensionId} 的这条评论吗？回复正文也会作为普通快记显示在首页。`,
      }
    })
  }
  if (arkmeToolCatalog.modulesFor(profile, 'attachments').length === 0) return
  ctx.inject(['attachments'], imageCtx => {
    for (const definition of createArkmeContextToolDefinitions(imageCtx, ports, profile)) {
      imageCtx.tools.register(definition)
    }
  })
}
