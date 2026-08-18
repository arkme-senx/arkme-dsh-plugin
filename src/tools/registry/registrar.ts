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
  if (arkmeToolCatalog.modulesFor(profile, 'attachments').length === 0) return
  ctx.inject(['attachments'], imageCtx => {
    for (const definition of createArkmeContextToolDefinitions(imageCtx, ports, profile)) {
      imageCtx.tools.register(definition)
    }
  })
}
