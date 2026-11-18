import { publishedChoiceId } from './model-execution.js'
import type { ExploreModelModule, ExploreSettings } from './explore-contract.js'
import type { ModelChoice, ModelScene } from './model-directory.js'

/** A module's owner authorizes its exact routes; names never imply cross-scene support. */
export function exploreModelChoices(module: ExploreModelModule, settings: ExploreSettings): ModelChoice[] {
  const scene: ModelScene = ({profile:'explore-profile',events:'explore-event',goals:'explore-goal',anniversaries:'explore-anniversary'} as const)[module]
  return settings.models.map(model => ({
    id: publishedChoiceId(model.binding, ['explore', module, model.key ?? model.ref]),
    name: model.label,
    origin: model.provider==='user-api'?'user-provided':'official',
    identifier: model.key ?? model.ref,
    channel: model.provider === 'managed-ai' || model.provider === 'arkme-managed' ? 'Arkme 托管'
      : model.provider === 'dashscope' ? '百炼' : model.provider || '分析模型',
    billingByScene: { [scene]: model.provider === 'user-api' ? 'provider-account' : model.binding ? 'arkme-points' : 'unknown' },
    availabilityByScene: { [scene]: { available: model.available === true, ...(model.unavailableReason ? {reason:model.unavailableReason} : {}) } },
    ...(model.binding ? {catalogRevision:model.binding.catalogReleaseId,offeringRevision:model.binding.offeringRevisionId} : {}),
    ...(model.supplierCode ? {supplierCode:model.supplierCode} : {}),
    ...(model.costDescription ? {pricing:model.costDescription} : {}),
    referencesByScene: { [scene]: model.ref },
    explore: model.ref,
    ...(model.routeKey ? { exploreRouteKey: model.routeKey } : {}),
  }))
}
