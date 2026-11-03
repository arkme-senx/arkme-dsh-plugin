import type { ExploreModelModule, ExploreSettings } from './explore-contract.js'
import type { ModelChoice } from './model-directory.js'

/** A module's owner authorizes its exact routes; names never imply cross-scene support. */
export function exploreModelChoices(module: ExploreModelModule, settings: ExploreSettings): ModelChoice[] {
  return settings.models.map(model => ({
    id: JSON.stringify(['explore', module, model.key ?? model.ref]),
    name: model.label,
    identifier: model.key ?? model.ref,
    channel: model.provider === 'managed-ai' || model.provider === 'arkme-managed' ? 'Arkme 托管'
      : model.provider === 'dashscope' ? '百炼' : model.provider || '分析模型',
    ...(model.provider === 'managed-ai' || model.provider === 'arkme-managed' ? { billing: 'arkme-points' as const } : {}),
    explore: model.ref,
    ...(model.routeKey ? { exploreRouteKey: model.routeKey } : {}),
  }))
}
