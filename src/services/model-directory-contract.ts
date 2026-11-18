import { pointsUnits } from '../ai-points.js'
import type { ModelChoice } from '../model-directory.js'
import { ArkmePluginError, objectValue } from './service.js'

const invalid = (): never => { throw new ArkmePluginError('model-directory-contract-invalid', '官方模型目录暂时无法确认，请重试', true, 502) }
function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) return invalid()
  return value
}
function price(value: unknown): string {
  if (typeof value !== 'string') return invalid()
  try { pointsUnits(value) } catch { return invalid() }
  return value
}

/** Only the authenticated, published user catalog supplies official DSH routes. */
export function publishedModelChoices(raw: Record<string, unknown>): ModelChoice[] {
  if (!Array.isArray(raw.item_ls) || raw.item_ls.length > 256) return invalid()
  const seen = new Set<string>()
  return raw.item_ls.map(value => {
    const item = objectValue(value), code = text(item.public_model_code), capability = objectValue(item.capability), reasoning = objectValue(item.reasoning)
    if (item.provider !== 'arkme-managed' || seen.has(code) || !Array.isArray(capability.input_modalities) || !capability.input_modalities.includes('text')
      || capability.input_modalities.some(mode => mode !== 'text' && mode !== 'image') || !Array.isArray(reasoning.efforts) || !reasoning.efforts.length || reasoning.efforts.length > 8
      || reasoning.efforts.some(effort => typeof effort !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(effort)) || new Set(reasoning.efforts).size !== reasoning.efforts.length
      || typeof reasoning.default_effort !== 'string' || !reasoning.efforts.includes(reasoning.default_effort)) return invalid()
    seen.add(code)
    const wire = objectValue(item.point_pricing)
    const pointPricing = { cacheMissInputPerThousand: price(wire.cache_miss_input_per_thousand), cacheHitInputPerThousand: price(wire.cache_hit_input_per_thousand), outputPerThousand: price(wire.output_per_thousand) }
    const effortNames: Record<string,string> = { off: '关闭', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高' }
    return { id: JSON.stringify(['dsh', 'arkme-managed', code]), origin: 'official', name: text(item.display_name), channel: 'Arkme 托管', identifier: code,
      supplierCode: text(item.supplier_code), catalogRevision: text(item.catalog_release_id), offeringRevision: text(item.offering_revision_id),
      billing: 'arkme-points', billingByScene: { dsh: 'arkme-points' }, pointPricing,
      pricing: `每 1,000 Token：输入 ${pointPricing.cacheMissInputPerThousand} 积分，缓存输入 ${pointPricing.cacheHitInputPerThousand} 积分，输出 ${pointPricing.outputPerThousand} 积分。`,
      images: capability.input_modalities.includes('image'),
      reasoning: { efforts: reasoning.efforts.map(id => ({ id, name: effortNames[id] ?? id })), defaultEffort: reasoning.default_effort },
      dsh: { provider: 'arkme-managed', model: code } }
  })
}
