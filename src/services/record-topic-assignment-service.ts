import type { ArkmeRecordTopicAssignmentInput, ArkmeRecordTopicAssignmentResult } from '../record-topic-assignment-contract.js'
import { openRecordTopicAssignmentRef } from '../record-topic-assignment-ref.js'
import { ArkmePluginError, ServiceRuntime, objectValue } from './service.js'
import type { SourceService } from './source-service.js'

/** Record-owned membership mutation. SourceService supplies account-bound source identities. */
export class RecordTopicAssignmentService {
  constructor(private readonly runtime: ServiceRuntime, private readonly sources: SourceService) {}

  async assign(input: ArkmeRecordTopicAssignmentInput, signal?: AbortSignal): Promise<ArkmeRecordTopicAssignmentResult> {
    const invalid = () => new ArkmePluginError('record-topic-selection-invalid', '请选择 1 至 100 条当前页面内的本人快记', false, 409)
    if (!Array.isArray(input.assignmentRefs) || input.assignmentRefs.length < 1 || input.assignmentRefs.length > 100) throw invalid()
    const session = await this.runtime.requireSession()
    const source = await this.sources.openSourceRef(input.sourceRef, session.userId)
    if (!['send_to_self', 'default_category', 'topic'].includes(source.kind)) throw invalid()
    const signingKey = await this.runtime.stateStore.uniqueCode()
    const refs = input.assignmentRefs.map(value => openRecordTopicAssignmentRef(value, signingKey))
    const identities = new Set<string>()
    for (const ref of refs) {
      if (ref.userId !== session.userId || ref.sourceKind !== source.kind || ref.sourceOwnerRef !== source.ownerRef
        || identities.has(ref.recordUid) || (source.kind === 'topic' && ref.sourceTopicUid !== source.ownerRef)) throw invalid()
      identities.add(ref.recordUid)
    }
    let targetTopicUid = ''
    if (input.targetSourceRef !== undefined) {
      const target = await this.sources.openSourceRef(input.targetSourceRef, session.userId)
      if (target.kind !== 'topic') throw new ArkmePluginError('record-topic-target-invalid', '只能指定个人主题', false, 409)
      targetTopicUid = target.ownerRef
    } else if (source.kind !== 'topic') {
      throw new ArkmePluginError('record-topic-release-invalid', '请在主题内选择要移出的快记', false, 409)
    }
    const changed = refs.filter(ref => ref.sourceTopicUid !== targetTopicUid)
    if ((await this.runtime.requireSession()).userId !== session.userId) {
      throw new ArkmePluginError('account-changed', '账号已切换，请重新选择快记', false, 409)
    }
    if (signal?.aborted) throw signal.reason ?? new Error('请求已取消')
    if (changed.length === 0) return { movedRecordUids: [], projectionRefreshPending: false }
    const body = {
      ...(targetTopicUid === '' ? {} : { target_topic_uid: targetTopicUid }),
      items: changed.map(ref => ({ record_uid: ref.recordUid, ...(ref.sourceTopicUid === '' ? {} : { source_topic_uid: ref.sourceTopicUid }) })),
    }
    let result: Record<string, unknown>
    try {
      result = objectValue(await this.runtime.authenticatedPost<unknown>(
        '/api/v1/topics/records/move-batch', body, session, signal, { trackWriteOutcome: true },
      ))
    } finally {
      // Also invalidate after an unknown outcome: a later read must not reuse pre-write directory data.
      this.sources.invalidateSourceListCache(session.userId, 'send_to_self')
    }
    const items = Array.isArray(result.items) ? result.items.map(objectValue) : []
    const byUid = new Map(items.map(item => [item.record_uid, item]))
    if (typeof result.projection_refresh_pending !== 'boolean' || result.moved_count !== changed.length || items.length !== changed.length || byUid.size !== changed.length
      || changed.some(ref => {
        const item = byUid.get(ref.recordUid)
        return !item || (targetTopicUid !== '' && (item.target_status !== 1 || item.target_is_primary !== true))
          || (ref.sourceTopicUid !== '' && item.source_status !== 2)
      })) {
      throw new ArkmePluginError('record-topic-result-unknown', '归属结果暂时无法确认，请刷新核对后再操作', false, 502, { writeOutcomeUnknown: true })
    }
    return { movedRecordUids: changed.map(ref => ref.recordUid), projectionRefreshPending: result.projection_refresh_pending === true }
  }
}
