import { tr } from './locale.js'

/** One disclosure per menu keeps pricing available without repeating it in every row. */
export function ArkmeModelPricing({ models }: {
  models: readonly { id: string; name: string; description?: string | undefined }[]
}) {
  const pricedModels = models.filter(model => model.description)
  if (pricedModels.length === 0) return null
  return <details className="arkme-model-price">
    <summary>{tr('按用量扣积分 · 计费说明')}</summary>
    <dl>{pricedModels.map(model => <div key={model.id}>
      <dt>{model.name}</dt><dd>{model.description}</dd>
    </div>)}</dl>
  </details>
}
