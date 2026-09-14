import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { ArkmeRecordDeletionItem, ArkmeRecordDeletionResult } from '../record-deletion-contract.js'
import { openRecordDeletionRef } from '../record-deletion-ref.js'
import { ArkmePluginError, ArkmeUpstreamResponseError, ServiceRuntime, objectValue } from './service.js'
import type { SourceService } from './source-service.js'

/** User Record owner operation. No Agent authorization, Chat withdrawal or permanent-delete fallback. */
export interface RecordDeletionPort {
  deleteBatch(items: readonly ArkmeRecordDeletionItem[], session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<ArkmeRecordDeletionResult>
}
export class RecordDeletionHttpPort implements RecordDeletionPort {
  constructor(private readonly runtime: ServiceRuntime) {}
  async deleteBatch(items: readonly ArkmeRecordDeletionItem[], session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<ArkmeRecordDeletionResult> {
    const results: ArkmeRecordDeletionResult['items'] = []
    let stopped = false
    for (const item of items) {
      if (stopped || signal?.aborted) {
        results.push({ ...item, result: 'not_attempted' })
        continue
      }
      // Keep the captured account and observed version for every write in this selection.
      let sameAccount = false
      try { sameAccount = (await this.runtime.requireSession()).userId === session.userId } catch { /* Session ended before this write. */ }
      if (!sameAccount || signal?.aborted) {
        stopped = true
        results.push({ ...item, result: 'not_attempted' })
        continue
      }
      try {
        const raw = objectValue(await this.runtime.authenticatedPost<unknown>('/api/v1/records/delete', {
          record_uid: item.recordUid, version: item.version,
        }, session, signal, { trackWriteOutcome: true }))
        const record = objectValue(raw.record_core)
        if (record.record_uid !== item.recordUid || record.owner_user_id !== session.userId
          || record.status !== 2 || !Number.isSafeInteger(record.version) || Number(record.version) <= item.version) {
          throw new Error('删除结果无法确认')
        }
        results.push({ recordUid: item.recordUid, version: Number(record.version), result: 'deleted' })
      } catch (error) {
        // The existing delete endpoint maps pre-write validation/ownership/version refusal to 40001.
        // Internal errors and lost responses cannot establish whether the write happened.
        const rejected = error instanceof ArkmePluginError && error.writeOutcomeUnknown !== true
          && ((error instanceof ArkmeUpstreamResponseError && error.code === 'arkme-code-40001')
            || ['auth-http-401', 'auth-http-403'].includes(error.code))
        results.push(rejected
          ? { ...item, result: 'rejected', message: error.message }
          : { ...item, result: 'unknown' })
        stopped = true
      }
    }
    return { items: results }
  }
}
export class RecordDeletionService {
  constructor(private readonly runtime: ServiceRuntime, private readonly sources: SourceService, private readonly port: RecordDeletionPort = new RecordDeletionHttpPort(runtime)) {}
  async delete(sourceRef: string, deletionRefs: readonly string[], signal?: AbortSignal): Promise<ArkmeRecordDeletionResult> {
    const invalid = () => new ArkmePluginError('record-delete-selection-invalid', '请选择 1 至 100 条当前页面内可删除的本人快记', false, 409)
    if (!Array.isArray(deletionRefs) || deletionRefs.length < 1 || deletionRefs.length > 100) throw invalid()
    const session = await this.runtime.requireSession()
    const source = await this.sources.openSourceRef(sourceRef, session.userId)
    const key = await this.runtime.stateStore.uniqueCode()
    const refs = deletionRefs.map(ref => openRecordDeletionRef(ref, key))
    const seen = new Set<string>()
    for (const ref of refs) {
      if (ref.userId !== session.userId || ref.sourceKind !== source.kind || ref.sourceOwnerRef !== source.ownerRef || seen.has(ref.recordUid)) throw invalid()
      seen.add(ref.recordUid)
    }
    if ((await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('account-changed', '账号已切换，请重新选择', false, 409)
    if (signal?.aborted) throw signal.reason ?? new Error('请求已取消')
    try { return await this.port.deleteBatch(refs.map(ref => ({ recordUid: ref.recordUid, version: ref.recordVersion })), session, signal) }
    finally {
      this.sources.invalidateSourceListCache(session.userId)
      this.runtime.invalidateKey(this.runtime.requestScope(session.userId), 'calendar:')
    }
  }
}
