import { accountModelSupportsDsh, accountModelSceneIssues, type AccountModel, type AccountModelSettings } from '../account-models.js'
import { publishedChoiceId } from '../model-execution.js'
import { dshModelChoices, arkoModelChoices, recordingModelChoices, mergeModelChoices, type UnifiedModelCatalog, type ModelChoice, type ModelScene } from '../model-directory.js'
import type { ArkmeArkoModelCatalog, ArkmeRecordingSummaryModelConfig } from '../types.js'
import type { DshRemoteModelCatalog } from '../dsh-remote/types.js'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'
import { publishedModelChoices } from './model-directory-contract.js'

export interface ModelDirectoryReaders {
  account?: ((signal?: AbortSignal)=>Promise<import('../account-models.js').AccountModelSettings>) | undefined
  dsh?: (() => Promise<DshRemoteModelCatalog>) | undefined
  arko(signal?: AbortSignal): Promise<ArkmeArkoModelCatalog>
  recording(signal?: AbortSignal, kind?: 'summary' | 'timeline'): Promise<ArkmeRecordingSummaryModelConfig>
  explore?: ((signal?: AbortSignal) => Promise<{models: UnifiedModelCatalog['models']; failures: UnifiedModelCatalog['failures']}>) | undefined
}
/** Read-only aggregation, never model activation or paid generation. */
export class ModelDirectoryService {
  constructor(private readonly runtime: ServiceRuntime, private readonly readers: ModelDirectoryReaders) {}
  async read(expectedScope: string, signal?: AbortSignal, officialOnly = false): Promise<UnifiedModelCatalog> {
    const session = await this.runtime.requireSession(), scope = `${this.runtime.config.environment}:${session.userId}`
    if (!expectedScope || expectedScope !== scope) throw new ArkmePluginError('model-directory-account-changed', '账号已切换，请重新读取模型', false, 409)
    const details = typeof this.runtime.authenticatedIntelligentPost === 'function'
      ? this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/managed-ai/models/query', {}, session, signal)
        .then(value => ({ value }), () => ({ value: undefined })) : Promise.resolve({ value: undefined })
    const result = await Promise.allSettled([
      officialOnly ? details.then(value => { if (!value.value) throw new Error('官方模型暂时无法读取'); return { models: publishedModelChoices(value.value), failures: [] } })
        : this.readers.dsh ? this.readers.dsh().then(value => ({ models: dshModelChoices(value), failures: [
        ...value.failedProviders.map(provider => ({ source: provider.providerName, message: '该渠道目录暂时无法读取' })),
        ...(value.truncated ? [{ source: 'DSH', message: '模型目录未完整返回' }] : []),
      ] })) : Promise.reject(new Error('模型目录正在连接，请稍后刷新')),
      this.readers.arko(signal).then(value => ({ models: arkoModelChoices(value), failures: [] })),
      Promise.all([this.readers.recording(signal,'summary'),this.readers.recording(signal,'timeline')]).then(([summary,timeline]) => ({models:mergeModelChoices(recordingModelChoices(summary,'summary'),recordingModelChoices(timeline,'timeline')),failures:[]})),
      ...(!officialOnly && this.readers.account ? [this.readers.account(signal).then(value=>({models:value.models.filter(model=>!model.disabled).map(model=>({id:JSON.stringify(['account',model.uid]),origin:'user-provided' as const,name:model.name,identifier:model.route,channel:model.execution==='cloud'?'账号绑定 API':'本机连接器',billing:'provider-account' as const,exploreRouteKey:model.route,images:model.capabilities.images,capabilityIssuesByScene:accountCapabilityIssues(model,value.scenes),
        ...(accountModelSupportsDsh(model)?{dsh:model.execution==='cloud'?{provider:'arkme-user-api',model:model.route}:{provider:model.host_provider!,model:model.model_key}}:{}),...(model.capabilities.tools?{arko:model.route}:{}),recording:model.route})),failures:[]}))] : []),
      ...(this.readers.explore ? [this.readers.explore(signal)] : []),
    ])
    signal?.throwIfAborted()
    const current = await this.runtime.requireSession()
    if (`${this.runtime.config.environment}:${current.userId}` !== scope) throw new ArkmePluginError('model-directory-account-changed', '账号已切换，请重新读取模型', false, 409)
    const sources = [officialOnly ? 'DSH 对话' : 'DSH', 'Arko', '录音', ...(!officialOnly && this.readers.account ? ['账号模型'] : []), officialOnly ? '识别与分析' : '探索'], models = [], failures = []
    for (const [index, item] of result.entries()) {
      if (item.status === 'fulfilled') { models.push(item.value.models); failures.push(...item.value.failures) }
      else failures.push({ source: sources[index]!, message: item.reason instanceof Error ? item.reason.message : '目录读取失败，请重试' })
    }
    const metadata = await details
    signal?.throwIfAborted()
    const finalSession = await this.runtime.requireSession()
    if (`${this.runtime.config.environment}:${finalSession.userId}` !== scope) throw new ArkmePluginError('model-directory-account-changed', '账号已切换，请重新读取模型', false, 409)
    const byCode = new Map((Array.isArray(metadata.value?.item_ls) ? metadata.value.item_ls : []).map(value => { const item = objectValue(value); return [item.public_model_code, item] as const }))
    const safe = (value: unknown) => typeof value === 'string' && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value) ? value : ''
    const published = mergeModelChoices(mergeModelChoices(...models).filter(model => !officialOnly || model.origin === 'official').map(model => {
      const item = model.dsh?.provider === 'arkme-managed' ? byCode.get(model.dsh.model) : undefined
      const release=safe(item?.catalog_release_id),revision=safe(item?.offering_revision_id)
      const id = item && /^[1-9][0-9]*$/.test(release) && /^[1-9][0-9]*$/.test(revision) && typeof item.public_model_code==='string'
        ? publishedChoiceId({catalogReleaseId:release,offeringRevisionId:revision,publicModelCode:item.public_model_code},[]) : model.id
      return { ...model, id, ...(safe(item?.catalog_release_id) ? { catalogRevision: safe(item?.catalog_release_id) } : {}),
        ...(safe(item?.offering_revision_id) ? { offeringRevision: safe(item?.offering_revision_id) } : {}),
        ...(safe(item?.supplier_code) ? { supplierCode: safe(item?.supplier_code) } : {}) }
    }))
    const revisions=new Set(published.filter(model=>model.origin==='official'&&model.catalogRevision).map(model=>model.catalogRevision))
    if(revisions.size>1)failures.push({source:'官方模型',message:'发布目录已变化，请刷新后确认模型'})
    return {accountScope:scope,observedAt:Date.now(),models:published,failures}
  }
}

// UI scene aliases refer to the same business keys used by their existing
// profile/event/goal/anniversary/calendar endpoints. Requirements stay owned
// by the account registry; unknown scene metadata grants no availability.
const accountSceneKeys: Record<ModelScene, string> = {
  dsh: 'dsh', arko: 'arko', arrangement: 'arrangement',
  'recording-summary': 'recording-summary', 'recording-timeline': 'recording-timeline',
  'explore-profile': 'profile', 'explore-event': 'intelligent.event.subscription.final',
  'explore-goal': 'goals', 'explore-anniversary': 'insight.anniversary.verify.final',
  dayReview: 'intelligent.calendar.day-review',
}
function accountCapabilityIssues(model: AccountModel, scenes: AccountModelSettings['scenes']): NonNullable<ModelChoice['capabilityIssuesByScene']> {
  const issues: NonNullable<ModelChoice['capabilityIssuesByScene']> = {}
  for (const [alias, key] of Object.entries(accountSceneKeys)) {
    const scene = scenes.find(item => item.key === key)
    if (scene) issues[alias as ModelScene] = accountModelSceneIssues(model, scene)
  }
  return issues
}
