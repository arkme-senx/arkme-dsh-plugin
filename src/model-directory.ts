import { publishedChoiceId } from './model-execution.js'
import type { ArkmeArkoModelCatalog, ArkmeRecordingSummaryModelConfig } from './types.js'
import type { DshRemoteModelCatalog } from './dsh-remote/types.js'

export type ModelScene = 'dsh' | 'arko' | 'recording-summary' | 'recording-timeline' | 'explore-profile' | 'explore-event' | 'explore-goal' | 'explore-anniversary' | 'arrangement' | 'dayReview'
export type ModelOrigin = 'official' | 'user-provided'
export type ModelBilling = 'arkme-points' | 'provider-account' | 'unknown'
export interface ModelChoice {
  id: string
  name: string
  /** Product ownership is independent of the upstream model supplier. */
  origin: ModelOrigin
  channel: string
  identifier: string
  version?: string
  catalogRevision?: string
  offeringRevision?: string
  supplierCode?: string
  pricing?: string
  pointPricing?: { cacheMissInputPerThousand: string; cacheHitInputPerThousand: string; outputPerThousand: string }
  referencesByScene?: Partial<Record<ModelScene, string>>
  availabilityByScene?: Partial<Record<ModelScene, { available: boolean; reason?: string }>>
  /** Account requirements explain rejection; they never authorize a business route. */
  capabilityIssuesByScene?: Partial<Record<ModelScene, string[]>>
  billing?: ModelBilling
  /** A shared route can have different billing contracts in different scenes. */
  billingByScene?: Partial<Record<ModelScene, ModelBilling>>
  images?: boolean
  reasoning?: { efforts: { id: string; name: string; description?: string }[]; defaultEffort?: string }
  dsh?: { provider: string; model: string }
  arko?: string
  arrangement?: string
  recording?: string
  dayReview?: string
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
    origin: model.provider === 'arkme-managed' ? 'official' : 'user-provided',
    channel: model.provider === 'arkme-managed' ? 'Arkme 托管' : model.providerName,
    identifier: model.model, billing: model.provider === 'arkme-managed' ? 'arkme-points' : 'provider-account', ...(model.provider === 'arkme-managed' && model.description ? { pricing: model.description } : {}),
    billingByScene: { dsh: model.provider === 'arkme-managed' ? 'arkme-points' : 'provider-account' },
    ...(model.supportsImages === undefined ? {} : { images: model.supportsImages }),
    ...(model.reasoningEfforts?.length ? { reasoning: { efforts: model.reasoningEfforts.map(effort => ({ id: effort.id, name: effort.displayName,
      ...(effort.description ? { description: effort.description } : {}) })), ...(model.defaultReasoningEffort ? { defaultEffort: model.defaultReasoningEffort } : {}) } } : {}),
    dsh: { provider: model.provider, model: model.model } }))
}
export function arkoModelChoices(catalog: ArkmeArkoModelCatalog): ModelChoice[] {
  return catalog.options.map(model => ({ id: publishedChoiceId(model.binding, ['arko', model.routeKey]), name: model.displayName,
    origin: model.provider === 'user-api' ? 'user-provided' : 'official',
    channel: model.provider === 'managed-ai' ? 'Arkme 托管' : model.provider, identifier: model.routeKey,
    billingByScene: { arko: model.provider === 'managed-ai' ? 'arkme-points' : model.provider === 'user-api' ? 'provider-account' : 'unknown' },
    ...(model.binding ? {catalogRevision:model.binding.catalogReleaseId,offeringRevision:model.binding.offeringRevisionId} : {}),
    ...(model.provider === 'user-api' ? { exploreRouteKey: model.routeKey } : {}),
    ...(model.supplierCode ? {supplierCode:model.supplierCode} : {}),
    ...(model.costDescription ? { pricing: model.costDescription } : {}), ...(model.imageInput ? { images: true } : {}), arko: model.routeKey }))
}
export function recordingModelChoices(catalog: ArkmeRecordingSummaryModelConfig, kind: 'summary' | 'timeline'): ModelChoice[] {
  const scene = kind === 'timeline' ? 'recording-timeline' : 'recording-summary'
  return catalog.options.map(model => ({ id: publishedChoiceId(model.binding, [scene, model.routeKey]), name: model.displayName,
    origin: model.provider === 'user-api' ? 'user-provided' : 'official', billingByScene: { [scene]: model.provider === 'user-api' ? 'provider-account' : model.binding ? 'arkme-points' : 'unknown' },
    availabilityByScene: { [scene]: { available: model.available === true, ...(model.unavailableReason ? { reason: model.unavailableReason } : {}) } },
    ...(model.provider === 'user-api' ? { exploreRouteKey: model.routeKey } : {}),
    ...(model.binding ? { catalogRevision: model.binding.catalogReleaseId, offeringRevision: model.binding.offeringRevisionId } : {}),
    ...(model.supplierCode ? { supplierCode: model.supplierCode } : {}), ...(model.costDescription ? { pricing: model.costDescription } : {}),
    channel: model.provider === 'dashscope' ? '百炼' : model.provider, identifier: model.binding?.publicModelCode ?? model.modelKey, recording: model.routeKey }))
}
export function sceneReference(model: ModelChoice, scene: ModelScene): string | object | undefined {
  if (model.referencesByScene?.[scene]) return model.referencesByScene[scene]
  if (scene.startsWith('recording-')) return model.recording
  if (scene.startsWith('explore-')) return model.explore
  return model[scene as 'dsh' | 'arko' | 'arrangement' | 'dayReview']
}
export function modelAvailable(model: ModelChoice, scene: ModelScene): boolean {
  return !(model.origin === 'user-provided' && model.capabilityIssuesByScene?.[scene]?.length) && !!sceneReference(model, scene) && (scene === 'dsh' || scene === 'arko' || scene === 'arrangement' || scene === 'dayReview' ? model.availabilityByScene?.[scene]?.available !== false : model.availabilityByScene?.[scene]?.available === true)
}
export function unavailableLabel(model: ModelChoice, scene: ModelScene): string {
  const issues = model.origin === 'user-provided' ? model.capabilityIssuesByScene?.[scene] : undefined
  if (issues?.length) return issues.join('、')
  const reason = model.availabilityByScene?.[scene]?.reason
  return ({model_not_priced:'此模型尚未配置报价',model_price_ambiguous:'此模型报价无法确认',catalog_unavailable:'模型目录暂不可用',adapter_unavailable:'此模型暂不可用',business_not_opened:'此场景尚未开放',fixed_model_policy:'此场景按固定模型自动运行，暂不支持切换'} as Record<string,string>)[reason ?? ''] ?? '此场景支持情况待确认'
}
export function modelSceneBilling(model: ModelChoice, scene: ModelScene): ModelBilling {
  if (!sceneReference(model, scene) && !model.availabilityByScene?.[scene]) return 'unknown'
  return model.billingByScene?.[scene] ?? model.billing ?? 'unknown'
}
/** Only stable source identities deduplicate entries. Similar names are not route mappings. */
export function mergeModelChoices(...lists: readonly (readonly ModelChoice[])[]): ModelChoice[] {
  const result = new Map<string, ModelChoice>()
  for (const models of lists) for (const model of models) {
    // Published offerings join only by the complete immutable identity. The
    // independent account/calendar owners also publish exact route aliases.
    const route = model.exploreRouteKey
    const existing = result.get(model.id) ?? (route && (model.origin === 'user-provided' || model.dayReview)
      ? [...result.values()].find(owner => owner.origin === model.origin &&
        (owner.arko === route || owner.recording === route || owner.exploreRouteKey === route || owner.dsh?.model === route))
      : undefined)
    const id = existing?.id ?? model.id
    result.set(id, { ...existing, ...model, id,
      ...(existing?.billingByScene || model.billingByScene ? { billingByScene: { ...existing?.billingByScene, ...model.billingByScene } } : {}),
      ...(existing?.referencesByScene || model.referencesByScene ? { referencesByScene: { ...existing?.referencesByScene, ...model.referencesByScene } } : {}),
      ...(existing?.capabilityIssuesByScene || model.capabilityIssuesByScene ? { capabilityIssuesByScene: { ...existing?.capabilityIssuesByScene, ...model.capabilityIssuesByScene } } : {}),
      ...(existing?.availabilityByScene || model.availabilityByScene ? { availabilityByScene: { ...existing?.availabilityByScene, ...model.availabilityByScene } } : {}) })
  }
  return [...result.values()]
}

/** Calendar activation references come only from its authenticated scene owner. */
export function dayReviewModelChoices(catalog: import('./calendar-day-review.js').DayReviewModels): ModelChoice[] {
  return catalog.models.map(model => ({
    id: JSON.stringify(['day-review', model.route ?? model.code]),
    name: model.displayName, identifier: model.catalogRoute ?? model.code,
    origin: model.origin ?? 'official', channel: model.origin === 'user-provided' ? '账号绑定模型' : '即我官方',
    billingByScene: { dayReview: model.origin === 'user-provided' ? 'provider-account' : 'arkme-points' },
    dayReview: model.route ?? model.code,
    ...(model.catalogRoute ? { exploreRouteKey: model.catalogRoute } : {}),
  }))
}
