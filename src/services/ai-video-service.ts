import type {
  ArkmeRecordingMaterialUtterance,
  ArkmeAiVideoJob,
  ArkmeAiVideoJobStatus,
  ArkmeAiVideoListItem,
  ArkmeAiVideoListResult,
  ArkmeAiVideoPreflightResult,
  ArkmeAiVideoSegmentSelector,
} from '../types.js'
import {
  ArkmePluginError,
  ServiceRuntime,
  clippedText,
  objectValue,
  stringValue,
} from './service.js'

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export class AiVideoService {
  constructor(private readonly runtime: ServiceRuntime) {}

  async aiVideoResolveSelection(recordingUid: string, utterances: readonly ArkmeRecordingMaterialUtterance[], signal?: AbortSignal): Promise<ArkmeAiVideoSegmentSelector[]> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/get-session-detail-by-id',
      { session_id: recordingUid },
      session, signal, { bypassCache: true },
    )
    const recording = objectValue(data.session)
    if (recording.session_id !== recordingUid || recording.source !== 1 || !Number.isSafeInteger(recording.start_at)) {
      throw new ArkmePluginError('recording-selection-invalid', '录音素材详情无效', false)
    }
    const rows = [...listValue(data.doubao_transcript_item_ls), ...listValue(data.transcript_item_ls)].map(objectValue)
    return utterances.map(utterance => {
      const matches = rows.filter(item => Number.isSafeInteger(item.start_at) && Number.isSafeInteger(item.end_at)
        // Detail offsets are child-local; public utterances are recording-relative.
        && Number(item.start_at) - Number(recording.start_at) === utterance.startOffsetMillis
        && Number(item.end_at) - Number(recording.start_at) === utterance.endOffsetMillis
        && item.text === utterance.text)
      // Equal system/enhanced facts in one child identify the same material.
      // Keep distinct children or repeated source rows ambiguous rather than guessing.
      const selected = matches.filter(item => item.transcript_source !== 'system'
        || !matches.some(other => other.child_id === item.child_id && other.transcript_source === 'doubao'))
      const item = selected[0]
      if (selected.length !== 1 || item === undefined || !/^[0-9a-f]{24}$/.test(stringValue(item.child_id))
        || !Number.isSafeInteger(item.asr_item_index) || Number(item.asr_item_index) < 0
        || (item.transcript_source !== 'system' && item.transcript_source !== 'doubao')) {
        throw new ArkmePluginError('recording-selection-invalid', '所选原句已变化或无法精确对应素材，请重新读取转写后选择', false)
      }
      return { childId: stringValue(item.child_id), asrItemIndex: Number(item.asr_item_index), transcriptSource: item.transcript_source }
    })
  }

  async aiVideoPreflight(
    sessionId: string,
    segments: readonly ArkmeAiVideoSegmentSelector[],
    signal?: AbortSignal,
  ): Promise<ArkmeAiVideoPreflightResult> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/ai-comic-video/preflight',
      this.aiVideoSelectionBody(sessionId, segments),
      session,
      signal,
    )
    return {
      allowed: booleanValue(data.allowed),
      message: stringValue(data.message).trim() || 'AI 视频内容检查已完成',
      selectedDurationMillis: Math.max(0, numberValue(data.selected_duration_millis)),
      minimumDurationMillis: Math.max(0, numberValue(data.minimum_duration_millis)),
      selectedSegmentCount: Math.max(0, numberValue(data.selected_segment_count)),
      retryable: booleanValue(data.retryable),
      ...(stringValue(data.reason_code).trim() === '' ? {} : { reasonCode: stringValue(data.reason_code).trim() }),
      ...(stringValue(data.proof).trim() === '' ? {} : { proof: stringValue(data.proof).trim() }),
    }
  }

  async aiVideoCreate(
    clientRequestId: string,
    sessionId: string,
    segments: readonly ArkmeAiVideoSegmentSelector[],
    preflightProof: string,
    signal?: AbortSignal,
  ): Promise<ArkmeAiVideoJob> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/ai-comic-video/jobs/create',
      {
        client_request_id: clientRequestId,
        ...this.aiVideoSelectionBody(sessionId, segments),
        ...(preflightProof.trim() === '' ? {} : { preflight_proof: preflightProof.trim() }),
      },
      session,
      signal,
    )
    return this.aiVideoJob(data)
  }

  async aiVideoStatus(jobId: string, signal?: AbortSignal): Promise<ArkmeAiVideoJob> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/ai-comic-video/jobs/status',
      { job_id: jobId.trim() },
      session,
      signal,
    )
    return this.aiVideoJob(data)
  }

  async aiVideoList(options: {
    limit: number
    cursor?: string
    statuses?: readonly ArkmeAiVideoJobStatus[]
    signal?: AbortSignal
  }): Promise<ArkmeAiVideoListResult> {
    const allowedStatuses = new Set<ArkmeAiVideoJobStatus>(['queued', 'running', 'succeeded', 'failed', 'canceled'])
    if (options.statuses?.some(status => !allowedStatuses.has(status)) === true) {
      throw new ArkmePluginError('ai-video-status-filter-invalid', 'AI 视频状态筛选无效', false)
    }
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/ai-comic-video/jobs/list',
      {
        limit: Math.min(50, Math.max(1, Math.trunc(options.limit))),
        ...(options.cursor?.trim() ? { cursor: options.cursor.trim() } : {}),
        ...(options.statuses === undefined || options.statuses.length === 0 ? {} : { statuses: options.statuses }),
      },
      session,
      options.signal,
    )
    return {
      items: listValue(data.items)
        .map(raw => this.aiVideoListItem(raw))
        .filter((item): item is ArkmeAiVideoListItem => item !== undefined),
      hasMore: booleanValue(data.has_more),
      ...(stringValue(data.next_cursor).trim() === '' ? {} : { nextCursor: stringValue(data.next_cursor).trim() }),
    }
  }

  async textAiVideoPreflight(
    title: string,
    texts: readonly string[],
    signal?: AbortSignal,
  ): Promise<ArkmeAiVideoPreflightResult> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/ai-video/text/preflight',
      { ...(title.trim() === '' ? {} : { title: title.trim() }), texts },
      session,
      signal,
    )
    return {
      allowed: booleanValue(data.allowed),
      message: stringValue(data.message).trim() || 'AI 视频内容检查已完成',
      selectedDurationMillis: Math.max(0, numberValue(data.selected_duration_millis)),
      minimumDurationMillis: Math.max(0, numberValue(data.minimum_duration_millis)),
      selectedSegmentCount: Math.max(0, numberValue(data.selected_segment_count)),
      selectedTextCount: Math.max(0, numberValue(data.selected_text_count)),
      retryable: booleanValue(data.retryable),
      ...(stringValue(data.reason_code).trim() === '' ? {} : { reasonCode: stringValue(data.reason_code).trim() }),
      ...(stringValue(data.proof).trim() === '' ? {} : { proof: stringValue(data.proof).trim() }),
    }
  }

  async textAiVideoCreate(
    clientRequestId: string,
    title: string,
    texts: readonly string[],
    preflightProof: string,
    signal?: AbortSignal,
  ): Promise<ArkmeAiVideoJob> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/ai-video/text/jobs/create',
      {
        client_request_id: clientRequestId,
        ...(title.trim() === '' ? {} : { title: title.trim() }),
        texts,
        ...(preflightProof.trim() === '' ? {} : { preflight_proof: preflightProof.trim() }),
      },
      session,
      signal,
    )
    return this.aiVideoJob(data)
  }

  private aiVideoSelectionBody(
    sessionId: string,
    segments: readonly ArkmeAiVideoSegmentSelector[],
  ): Record<string, unknown> {
    return {
      session_id: sessionId.trim(),
      selection: {
        kind: 'long_recording_segments',
        segments: segments.map(segment => ({
          child_id: segment.childId.trim(),
          asr_item_index: segment.asrItemIndex,
          transcript_source: segment.transcriptSource,
        })),
      },
    }
  }

  private aiVideoJob(data: Record<string, unknown>): ArkmeAiVideoJob {
    const jobId = stringValue(data.job_id).trim()
    const status = stringValue(data.status).trim()
    const allowedStatuses = new Set<ArkmeAiVideoJobStatus>([
      'queued', 'running', 'succeeded', 'failed', 'canceled',
    ])
    if (jobId === '' || !allowedStatuses.has(status as ArkmeAiVideoJobStatus)) {
      throw new ArkmePluginError('ai-video-contract-invalid', 'AI 视频服务返回了无效任务信息', true, 502)
    }
    const selection = objectValue(data.selection)
    const segmentCount = listValue(selection.segments).length
    const textCount = listValue(selection.texts).length
    return {
      jobId,
      status: status as ArkmeAiVideoJobStatus,
      stage: stringValue(data.stage).trim() || status,
      progress: Math.min(100, Math.max(0, Math.trunc(numberValue(data.progress)))),
      selectedSegmentCount: segmentCount,
      ...(textCount === 0 ? {} : { selectedTextCount: textCount }),
      retryable: booleanValue(data.retryable),
      ...(stringValue(data.video_asset_uid).trim() === '' ? {} : { videoAssetUid: stringValue(data.video_asset_uid).trim() }),
      ...(stringValue(data.cover_asset_uid).trim() === '' ? {} : { coverAssetUid: stringValue(data.cover_asset_uid).trim() }),
      ...(numberValue(data.video_duration_millis) <= 0 ? {} : { videoDurationMillis: numberValue(data.video_duration_millis) }),
      ...(stringValue(data.error_code).trim() === '' ? {} : { errorCode: stringValue(data.error_code).trim() }),
      ...(stringValue(data.error_message).trim() === '' ? {} : { errorMessage: stringValue(data.error_message).trim() }),
      ...(stringValue(data.failure_stage).trim() === '' ? {} : { failureStage: stringValue(data.failure_stage).trim() }),
    }
  }

  private aiVideoListItem(raw: unknown): ArkmeAiVideoListItem | undefined {
    const item = objectValue(raw)
    const jobId = stringValue(item.job_id).trim()
    const status = stringValue(item.status).trim() as ArkmeAiVideoJobStatus
    if (jobId === '' || !['queued', 'running', 'succeeded', 'failed', 'canceled'].includes(status)) return undefined
    const source = objectValue(item.source_recording)
    return {
      jobId,
      sessionId: stringValue(item.session_id).trim(),
      status,
      stage: stringValue(item.stage).trim() || status,
      progress: Math.min(100, Math.max(0, Math.trunc(numberValue(item.progress)))),
      title: stringValue(source.title).trim() || '长录音 AI 视频',
      sourceStartedAtMillis: numberValue(source.started_at),
      selectedDurationMillis: Math.max(0, numberValue(source.selected_duration_millis)),
      selectedSegmentCount: Math.max(0, Math.trunc(numberValue(item.selected_segment_count))),
      retryable: booleanValue(item.retryable),
      createdAtMillis: numberValue(item.created_at),
      updatedAtMillis: numberValue(item.updated_at),
      ...(stringValue(item.cover_asset_uid).trim() === '' ? {} : { coverAssetUid: stringValue(item.cover_asset_uid).trim() }),
      ...(stringValue(item.video_asset_uid).trim() === '' ? {} : { videoAssetUid: stringValue(item.video_asset_uid).trim() }),
      ...(numberValue(item.video_duration_millis) <= 0 ? {} : { videoDurationMillis: numberValue(item.video_duration_millis) }),
      ...(stringValue(item.error_code).trim() === '' ? {} : { errorCode: stringValue(item.error_code).trim() }),
      ...(stringValue(item.error_message).trim() === '' ? {} : { errorMessage: clippedText(item.error_message, 500) }),
    }
  }
}
