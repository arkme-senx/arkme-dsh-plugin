import { sceneReference, type ModelChoice, type ModelScene } from '../model-directory.js'

export type CatalogScene = 'all' | 'dsh' | 'arko' | 'recording' | 'analysis'
export const catalogScenes = [['all', '全部'], ['dsh', 'DSH 对话'], ['arko', 'Arko 对话'], ['recording', '录音'], ['analysis', '识别与分析']] as const
const sceneLabels: Record<ModelScene, string> = { dsh: 'DSH 对话', arko: 'Arko 对话', 'recording-summary': '录音总结', 'recording-timeline': '录音时间轴',
  'explore-profile': '个人档案', 'explore-event': '事件整理', 'explore-goal': '目标分析', 'explore-anniversary': '纪念日分析', arrangement: '安排识别', dayReview: '日历日回顾' }
export const catalogSceneLabel = (scene: ModelScene): string => sceneLabels[scene]
export function catalogModelScenes(model: ModelChoice): ModelScene[] {
  return (Object.keys(sceneLabels) as ModelScene[]).filter(scene => model.availabilityByScene?.[scene] !== undefined
    || !!model.referencesByScene?.[scene] || (!scene.startsWith('recording-') && !scene.startsWith('explore-') && !!sceneReference(model, scene)))
}
export const catalogSupplier = (model: ModelChoice): string => ({ 'aliyun-bailian': '百炼', dashscope: '百炼', deepseek: 'DeepSeek', volcengine: '火山引擎', openai: 'OpenAI' } as Record<string,string>)[model.supplierCode ?? model.channel] ?? model.supplierCode ?? model.channel
export interface CatalogModel { key: string; name: string; models: ModelChoice[]; scenes: ModelScene[] }

/** Exact owned route identities may join scenes; a similar display name never does. */
export function officialCatalogModels(models: readonly ModelChoice[]): CatalogModel[] {
  const groups = new Map<string,CatalogModel>()
  for (const model of models) {
    if (model.origin !== 'official') continue
    const managed = model.dsh?.provider === 'arkme-managed' ? model.dsh.model
      : [model.arko, model.recording, model.exploreRouteKey].find(route => route?.startsWith('managed-ai/'))?.slice('managed-ai/'.length)
    const key = model.catalogRevision && model.offeringRevision ? model.id : managed ? `managed:${managed}` : model.id
    let group = groups.get(key)
    if (!group) { group = { key, name: model.name, models: [], scenes: [] }; groups.set(key,group) }
    if (model.dsh?.provider === 'arkme-managed') group.name = model.name
    group.models.push(model)
    for (const scene of catalogModelScenes(model)) if (!group.scenes.includes(scene)) group.scenes.push(scene)
  }
  return [...groups.values()]
}
export function filterCatalogModels(models: readonly CatalogModel[], scene: CatalogScene, search: string): CatalogModel[] {
  const query = search.trim().toLocaleLowerCase()
  return models.filter(model => {
    const matchesScene = scene === 'all' || model.scenes.some(value => scene === 'analysis'
      ? value.startsWith('explore-') || value === 'arrangement' || value === 'dayReview'
      : scene === 'recording' ? value.startsWith('recording-') : value === scene)
    return matchesScene && (!query || model.models.some(value => `${value.name} ${catalogSupplier(value)}`.toLocaleLowerCase().includes(query)))
  })
}
