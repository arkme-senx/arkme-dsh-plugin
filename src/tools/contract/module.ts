import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ArkmeCoreToolPorts, ArkmeToolPorts } from '../ports/index.js'

export type ArkmeToolKind = 'system' | 'business' | 'atomic'
export type ArkmeToolPhase = 'core' | 'attachments'
export type ArkmeToolEffect = 'read' | 'write'
export type ArkmeToolGrant = 'explicit-user-write'
export type ArkmeToolProfile = 'business' | 'atomic' | 'hybrid' | 'disabled'

export const ARKME_TOOL_PROFILES = ['business', 'atomic', 'hybrid', 'disabled'] as const

interface ArkmeToolModuleMetaBase {
  readonly id: string
  readonly toolName: `arkme_${string}`
  readonly kind: ArkmeToolKind
  readonly effect: ArkmeToolEffect
  readonly grant?: ArkmeToolGrant
  readonly profiles: readonly Exclude<ArkmeToolProfile, 'disabled'>[]
}

export interface ArkmeCoreToolModule {
  readonly meta: ArkmeToolModuleMetaBase & { readonly phase: 'core' }
  create(ports: ArkmeCoreToolPorts): ToolDefinition
}

export interface ArkmeContextToolModule {
  readonly meta: ArkmeToolModuleMetaBase & { readonly phase: 'attachments' }
  create(ctx: Context, ports: ArkmeToolPorts): ToolDefinition
}

export type ArkmeToolModule = ArkmeCoreToolModule | ArkmeContextToolModule

export function defineArkmeCoreToolModule(module: ArkmeCoreToolModule): ArkmeCoreToolModule {
  return module
}

export function defineArkmeContextToolModule(module: ArkmeContextToolModule): ArkmeContextToolModule {
  return module
}

export function isArkmeCoreToolModule(module: ArkmeToolModule): module is ArkmeCoreToolModule {
  return module.meta.phase === 'core'
}

export function isArkmeContextToolModule(module: ArkmeToolModule): module is ArkmeContextToolModule {
  return module.meta.phase === 'attachments'
}
