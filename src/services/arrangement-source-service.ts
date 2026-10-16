import type { ArkmeArrangementSourceRead, ArkmeArrangementSourceTarget } from '../types.js'
import type { ArrangementService } from './arrangement-service.js'
import type { CallHistoryService } from './call-history-service.js'
import type { ArkmePrivacyVisibilityService } from './privacy-visibility.js'
import type { RecordService } from './record-service.js'
import type { SourceService } from './source-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

/** Resolves saved arrangement evidence against the current source owner's access rules. */
export class ArrangementSourceService {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly arrangement: Pick<ArrangementService, 'sourceEvidence'>,
    private readonly privacy: Pick<ArkmePrivacyVisibilityService, 'lockedRecordUids'>,
    private readonly record: Pick<RecordService, 'personalRecordDetail'>,
    private readonly callHistory: Pick<CallHistoryService, 'arrangementCallDetail'>,
    private readonly source: Pick<SourceService, 'searchTargetSource'>,
  ) {}

  async arrangementSourceRead(arrangementRef: string, evidenceId: string, signal?: AbortSignal): Promise<ArkmeArrangementSourceRead> {
    try {
      const evidence = await this.arrangement.sourceEvidence(arrangementRef, evidenceId, signal)
      return { evidenceId, state: 'ready', text: evidence.text }
    } catch (error) {
      if (error instanceof ArkmePluginError && error.code === 'arrangement-source-unavailable') {
        return { evidenceId, state: 'unavailable', reason: error.message }
      }
      throw error
    }
  }

  async arrangementSourceOpen(arrangementRef: string, evidenceId: string, signal?: AbortSignal): Promise<ArkmeArrangementSourceTarget> {
    const session = await this.runtime.requireSession()
    const e = await this.arrangement.sourceEvidence(arrangementRef, evidenceId, signal)
    let result: ArkmeArrangementSourceTarget
    if (e.kind === 'audio_summary' && typeof e.summary_id === 'string' && typeof e.date_stamp === 'number' && typeof e.tz_offset === 'number') {
      // Re-read the owned day before opening a historical version.
      const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>('/api/v1/summary/list-timeline-by-range', { from_stamp:e.date_stamp, to_stamp:e.date_stamp+86400000, date_stamp:e.date_stamp, kind:2 }, session, signal, { lane:'interactive-read', bypassCache:true })
      if (!Array.isArray(data.audio_summary_ls) || !data.audio_summary_ls.some(s => objectValue(s).id === e.summary_id)) throw new ArkmePluginError('arrangement-source-deleted', '原录音总结已删除或当前无权查看', false, 404)
      result = { kind:'audio_summary', dateStamp:e.date_stamp, tzOffsetMillis:e.tz_offset, summaryId:e.summary_id }
    } else if (e.kind === 'call' && typeof e.room_id === 'string') {
      const detail = await this.callHistory.arrangementCallDetail(e.room_id, signal, {quote:e.text,...(typeof e.start_ms === 'number'?{startMillis:e.start_ms}:{})})
      result = { kind:'call', detail, quote:e.text, ...(typeof e.start_ms === 'number' ? {startMillis:e.start_ms>=100_000_000_000?Math.max(0,e.start_ms-detail.startedAtMillis):e.start_ms}: {}) }
    } else if (e.kind === 'agent') {
      result={kind:'document',title:'来源指令',text:e.text}
    } else if (e.kind === 'record' && typeof e.record_uid === 'string') {
      const raw = await this.runtime.authenticatedPost<Record<string,unknown>>('/api/v1/records/detail', {record_uid:e.record_uid},session,signal,{lane:'interactive-read',bypassCache:true})
      const core = objectValue(raw.record_core)
      if (core.record_uid !== e.record_uid || Number(core.content_access_state ?? raw.content_access_state) !== 1 || Number(core.status) !== 1 || (await this.privacy.lockedRecordUids(session,signal)).has(e.record_uid)) throw new ArkmePluginError('arrangement-source-restricted','原文已删除或当前无权查看',false,403)
      const origin = Number(core.origin_kind)
      if ([3,4].includes(origin)) {
        const source = await this.source.searchTargetSource(3,stringValue(core.origin_container_ref),'',signal)
        if (!source) throw new ArkmePluginError('arrangement-source-missing','当前无法打开原会话',false,404)
        result = {kind:'conversation',source,itemUid:e.record_uid,sendAtMillis:Number(core.send_at)||0}
      } else result = {kind:'record',item:await this.record.personalRecordDetail(e.record_uid,signal)}
    } else throw new ArkmePluginError('arrangement-source-unavailable','历史记录未保存可用的定位信息',false,404)
    const current=await this.runtime.requireSession()
    if(current.userId!==session.userId || current.refreshToken!==session.refreshToken) throw new ArkmePluginError('arrangement-source-account-changed','账号已变化，请重新打开',false,409)
    return result
  }
}
