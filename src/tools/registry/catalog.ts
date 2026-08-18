import { atomicToolModules } from '../atomic/index.js'
import { businessToolModules } from '../business/index.js'
import type { ArkmeToolModule, ArkmeToolPhase, ArkmeToolProfile } from '../contract/module.js'
import { systemToolModules } from '../system/index.js'

export interface ArkmeToolCatalog {
  readonly modules: readonly ArkmeToolModule[]
  modulesFor(profile: ArkmeToolProfile, phase?: ArkmeToolPhase): readonly ArkmeToolModule[]
  toolNamesFor(profile: ArkmeToolProfile): readonly string[]
}

const MODULE_ID = /^(system|business|atomic)(?:\.[a-z0-9-]+)+\.v[1-9][0-9]*$/
const TOOL_NAME = /^arkme_[a-z][a-z0-9_]*$/

export function defineArkmeToolCatalog(modules: readonly ArkmeToolModule[]): ArkmeToolCatalog {
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const module of modules) {
    const { meta } = module
    if (!MODULE_ID.test(meta.id) || !meta.id.startsWith(`${meta.kind}.`)) {
      throw new Error(`invalid Arkme tool module id "${meta.id}" for kind "${meta.kind}"`)
    }
    if (!TOOL_NAME.test(meta.toolName)) throw new Error(`invalid Arkme model tool name "${meta.toolName}"`)
    if (ids.has(meta.id)) throw new Error(`duplicate Arkme tool module id "${meta.id}"`)
    if (names.has(meta.toolName)) throw new Error(`duplicate Arkme model tool name "${meta.toolName}"`)
    if (meta.profiles.length === 0 || new Set(meta.profiles).size !== meta.profiles.length) {
      throw new Error(`Arkme tool module "${meta.id}" must declare unique non-empty profiles`)
    }
    if (meta.kind === 'business' && meta.profiles.some(profile => profile === 'atomic')) {
      throw new Error(`business Arkme tool module "${meta.id}" cannot join the atomic profile`)
    }
    if (meta.kind === 'atomic' && meta.profiles.some(profile => profile === 'business')) {
      throw new Error(`atomic Arkme tool module "${meta.id}" cannot join the business profile`)
    }
    if (meta.effect === 'write' && meta.grant !== 'explicit-user-write') {
      throw new Error(`write Arkme tool module "${meta.id}" must declare explicit-user-write grant ownership`)
    }
    if (meta.effect === 'read' && meta.grant !== undefined) {
      throw new Error(`read Arkme tool module "${meta.id}" must not declare a write grant`)
    }
    ids.add(meta.id)
    names.add(meta.toolName)
  }
  const stable = [...modules]
  return {
    modules: stable,
    modulesFor(profile, phase) {
      if (profile === 'disabled') return []
      return stable.filter(module => module.meta.profiles.includes(profile)
        && (phase === undefined || module.meta.phase === phase))
    },
    toolNamesFor(profile) {
      return this.modulesFor(profile).map(module => module.meta.toolName)
    },
  }
}

export const arkmeToolCatalog = defineArkmeToolCatalog([
  ...systemToolModules,
  ...businessToolModules,
  ...atomicToolModules,
])
