import { dshModelChoices, arkoModelChoices, recordingModelChoices, mergeModelChoices, type UnifiedModelCatalog } from '../model-directory.js'
import type { ArkmeArkoModelCatalog, ArkmeRecordingSummaryModelConfig } from '../types.js'
import type { DshRemoteModelCatalog } from '../dsh-remote/types.js'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'

export interface ModelDirectoryReaders {
  dsh?: (() => Promise<DshRemoteModelCatalog>) | undefined
  arko(signal?: AbortSignal): Promise<ArkmeArkoModelCatalog>
  recording(signal?: AbortSignal): Promise<ArkmeRecordingSummaryModelConfig>
  explore?: ((signal?: AbortSignal) => Promise<{models: UnifiedModelCatalog['models']; failures: UnifiedModelCatalog['failures']}>) | undefined
}
/** Read-only aggregation, never model activation or paid generation. */
export class ModelDirectoryService {
  constructor(private readonly runtime: ServiceRuntime, private readonly readers: ModelDirectoryReaders) {}
  async read(expectedScope: string, signal?: AbortSignal): Promise<UnifiedModelCatalog> {
    const session = await this.runtime.requireSession(), scope = `${this.runtime.config.environment}:${session.userId}`
    if (!expectedScope || expectedScope !== scope) throw new ArkmePluginError('model-directory-account-changed', '账号已切换，请重新读取模型', false, 409)
    const details = typeof this.runtime.authenticatedIntelligentPost === 'function'
      ? this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/managed-ai/models/query', {}, session, signal)
        .then(value => ({ value }), () => ({ value: undefined })) : Promise.resolve({ value: undefined })
    const result = await Promise.allSettled([
      this.readers.dsh ? this.readers.dsh().then(value => ({ models: dshModelChoices(value), failures: [
        ...value.failedProviders.map(provider => ({ source: provider.providerName, message: '该渠道目录暂时无法读取' })),
        ...(value.truncated ? [{ source: 'DSH', message: '模型目录未完整返回' }] : []),
      ] })) : Promise.reject(new Error('模型目录正在连接，请稍后刷新')),
      this.readers.arko(signal).then(value => ({ models: arkoModelChoices(value), failures: [] })),
      this.readers.recording(signal).then(value => ({ models: recordingModelChoices(value), failures: [] })),
      ...(this.readers.explore ? [this.readers.explore(signal)] : []),
    ])
    signal?.throwIfAborted()
    const current = await this.runtime.requireSession()
    if (`${this.runtime.config.environment}:${current.userId}` !== scope) throw new ArkmePluginError('model-directory-account-changed', '账号已切换，请重新读取模型', false, 409)
    const sources = ['DSH', 'Arko', '录音', '探索'], models = [], failures = []
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
    return { accountScope: scope, observedAt: Date.now(), models: mergeModelChoices(...models).map(model => {
      const item = model.dsh?.provider === 'arkme-managed' ? byCode.get(model.dsh.model) : undefined
      return { ...model, ...(safe(item?.catalog_release_id) ? { catalogRevision: safe(item?.catalog_release_id) } : {}),
        ...(safe(item?.offering_revision_id) ? { offeringRevision: safe(item?.offering_revision_id) } : {}),
        ...(safe(item?.supplier_code) ? { supplierCode: safe(item?.supplier_code) } : {}) }
    }), failures }
  }
}
