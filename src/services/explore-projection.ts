import type { ExploreProgress } from '../explore-contract.js'
import { ArkmePluginError } from './service.js'
export type Doc = Record<string, unknown>
export const doc = (v: unknown): Doc => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Doc : {}
export const text = (v: unknown): string => typeof v === 'string' ? v : ''
export const number = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? v : 0
export const list = (v: unknown): Doc[] => Array.isArray(v) ? v.map(doc) : []
export const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
export const first = (...values: unknown[]): string => values.map(text).find(s => s.trim()) ?? ''
export function bounded(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw new ArkmePluginError('explore-invalid', '输入内容无效，请检查后重试', false, 400)
  return value.trim()
}
// Relation owner's numeric types match Flutter RecordEntityDetailItem.typeName.
export const ENTITY_TYPES: Record<number, string> = {1:'人物',2:'组织',3:'地点',4:'宠物',5:'事件',6:'项目',7:'作品',8:'品牌',9:'其他'}
export function profileProgress(raw: Doc): ExploreProgress | undefined {
  const p = doc(raw.processing)
  if (!p.phase) return undefined
  return { label: ({ planning:'正在准备', queued:'等待整理', running:'正在整理', paused:'整理已暂停' } as Record<string,string>)[text(p.phase)] ?? '整理状态待更新',
    active: ['planning','queued','running'].includes(text(p.phase)), updatedAt: number(p.updated_at),
    ...(p.planning_complete === true && number(p.total_units) > 0 ? { completed:number(p.processed_units), total:number(p.total_units) } : {}) }
}
export function insightProgress(raw: Doc): ExploreProgress | undefined {
  if (![2,3,5].includes(number(raw.section_status))) return undefined
  return {label:first(raw.progress_message, ({2:'等待分析',3:'正在分析',5:'上次分析失败'} as Record<number,string>)[number(raw.section_status)]),active:[2,3].includes(number(raw.section_status)),updatedAt:number(raw.updated_at)}
}
