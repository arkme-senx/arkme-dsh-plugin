import type { ArkmeArkoModelCatalog, ArkmeRecordingSummaryModelConfig } from './types.js'
import type { DshRemoteModelCatalog } from './dsh-remote/types.js'

export type ModelScene = 'dsh' | 'arko' | 'recording' | 'explore'
export interface ModelChoice {
  id: string
  name: string
  channel: string
  identifier: string
  version?: string
  catalogRevision?: string
  offeringRevision?: string
  supplierCode?: string
  pricing?: string
  billing?: 'arkme-points' | 'provider-account'
  images?: boolean
  reasoning?: { efforts: { id: string; name: string; description?: string }[]; defaultEffort?: string }
  dsh?: { provider: string; model: string }
  arko?: string
  recording?: string
  /** Account- and module-bound activation reference from the Explore owner. */
  explore?: string
  /** Public Intelligent route identity, used only for exact catalog reconciliation. */
  exploreRouteKey?: string
}
export interface UnifiedModelCatalog {
  accountScope: string
  observedAt: number
  models: ModelChoice[]
  failures: { source: string; message: string }[]
}
export function dshModelChoices(catalog: DshRemoteModelCatalog): ModelChoice[] {
  return catalog.items.map(model => ({ id: JSON.stringify(['dsh', model.provider, model.model]), name: model.displayName,
    channel: model.provider === 'arkme-managed' ? 'Arkme 托管' : model.providerName,
    identifier: model.model, billing: model.provider === 'arkme-managed' ? 'arkme-points' : 'provider-account', ...(model.provider === 'arkme-managed' && model.description ? { pricing: model.description } : {}),
    ...(model.supportsImages === undefined ? {} : { images: model.supportsImages }),
    ...(model.reasoningEfforts?.length ? { reasoning: { efforts: model.reasoningEfforts.map(effort => ({ id: effort.id, name: effort.displayName,
      ...(effort.description ? { description: effort.description } : {}) })), ...(model.defaultReasoningEffort ? { defaultEffort: model.defaultReasoningEffort } : {}) } } : {}),
    dsh: { provider: model.provider, model: model.model } }))
}
export function arkoModelChoices(catalog: ArkmeArkoModelCatalog): ModelChoice[] {
  return catalog.options.map(model => ({ id: JSON.stringify(['arko', model.routeKey]), name: model.displayName,
    channel: model.provider === 'managed-ai' ? 'Arkme 托管' : model.provider, identifier: model.routeKey,
    ...(model.costDescription ? { pricing: model.costDescription } : {}), ...(model.imageInput ? { images: true } : {}), arko: model.routeKey }))
}
export function recordingModelChoices(catalog: ArkmeRecordingSummaryModelConfig): ModelChoice[] {
  return catalog.options.map(model => ({ id: JSON.stringify(['recording', model.routeKey]), name: model.displayName,
    channel: model.provider === 'dashscope' ? '百炼' : model.provider, identifier: model.modelKey, recording: model.routeKey }))
}
/** Only stable source identities deduplicate entries. Similar names are not route mappings. */
export function mergeModelChoices(...lists: readonly (readonly ModelChoice[])[]): ModelChoice[] {
  const result = new Map<string, ModelChoice>()
  for (const models of lists) for (const model of models) {
    const route = model.exploreRouteKey
    const owner = route ? [...result.values()].find(existing => existing.arko === route || existing.recording === route || existing.exploreRouteKey === route) : undefined
    if (owner && route) result.set(owner.id, { ...owner,
      ...(owner.channel === '分析模型' ? { channel: model.channel } : {}),
      ...(!owner.billing && model.billing ? { billing: model.billing } : {}),
      ...(model.explore ? { explore: model.explore } : {}), exploreRouteKey: route })
    else result.set(model.id, { ...result.get(model.id), ...model })
  }
  return [...result.values()]
}
