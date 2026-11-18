import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

export interface RetainedTranscriptItem {
  id: string
  session_id: string
  child_id: string
  asr_item_index: number
  transcript_source: 'primary' | 'enhanced'
  start_at: number
  end_at: number
  text: string
  speaker: { number: number; name: string }
  playable: boolean
  active_ranges?: Array<{ start_at: number; end_at: number }>
  active_ranges_complete?: boolean
}

export interface RetainedTranscriptRange {
  start_at: number
  end_at: number
  tz_offset: number
}

interface RetainedTranscriptPage {
  snapshot_id: string
  items: RetainedTranscriptItem[]
  next_cursor: string
}

interface RetainedVersionPage {
  versions: Array<{ id: string; created_at: number }>
  next_cursor: string
}

function reference(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
}

function invalidResponse(): never {
  throw new ArkmePluginError('recording-transcript-history-invalid', '转写版本响应无效，请刷新后重试', true, 502)
}

export function isPartialRetainedTranscript(item: RetainedTranscriptItem): boolean {
  const ranges = item.active_ranges
  return item.active_ranges_complete !== true || ranges?.length !== 1
    || ranges[0]?.start_at !== item.start_at || ranges[0]?.end_at !== item.end_at
}

function validateActiveRanges(item: RetainedTranscriptItem): void {
  if (item.active_ranges_complete !== undefined && typeof item.active_ranges_complete !== 'boolean') invalidResponse()
  if (item.active_ranges === undefined) {
    if (item.active_ranges_complete === true) invalidResponse()
    return
  }
  if (!Array.isArray(item.active_ranges) || !item.active_ranges.length || item.active_ranges.length > 128) invalidResponse()
  let previousEnd = item.start_at
  for (const range of item.active_ranges) {
    if (!range || !Number.isSafeInteger(range.start_at) || !Number.isSafeInteger(range.end_at)
      || range.start_at < previousEnd || range.end_at <= range.start_at || range.end_at > item.end_at) invalidResponse()
    previousEnd = range.end_at
  }
}

function unavailable(error: unknown): boolean {
  return error instanceof ArkmePluginError && error.code === 'arkme-http-error'
    && (error.upstreamStatus === 404 || error.upstreamStatus === 405)
}

export class RecordingTranscriptVersions {
  constructor(private readonly runtime: ServiceRuntime) {}

  async list(range: RetainedTranscriptRange, source: 'primary' | 'enhanced', session: ArkmeSessionCredentials, cursor: string, signal?: AbortSignal) {
    const page = await this.runtime.authenticatedAudioPost<RetainedVersionPage>(
      '/api/v1/audio/transcript-versions/list', {
        ...range, transcript_source: source, limit: 50, ...(cursor ? { cursor } : {}),
      }, session, signal, { bypassCache: true, preserveAudioHttpError: true, cancelWhenUnobserved: true },
    ).catch(error => {
      if (!cursor && unavailable(error)) return undefined
      throw error
    })
    if (page === undefined) return undefined
    if (!page || !Array.isArray(page.versions) || page.versions.length > 50
      || !page.versions.every(version => version && reference(version.id) && Number.isSafeInteger(version.created_at) && version.created_at >= 0 && version.created_at <= 8.64e15)
      || new Set(page.versions.map(version => version.id)).size !== page.versions.length
      || !(page.next_cursor === '' || reference(page.next_cursor)) || (cursor && cursor === page.next_cursor)) invalidResponse()
    return page
  }

  async query(
    range: RetainedTranscriptRange, source: 'primary' | 'enhanced', session: ArkmeSessionCredentials,
    selection: { versionId?: string; cursor?: string; snapshotId?: string }, signal?: AbortSignal,
  ) {
    const page = await this.runtime.authenticatedAudioPost<RetainedTranscriptPage>(
      '/api/v1/audio/transcript-versions/query', {
        ...range, transcript_source: source, limit: 100,
        ...(selection.versionId ? { version_id: selection.versionId } : {}),
        ...(selection.cursor ? { cursor: selection.cursor } : {}),
      }, session, signal, { bypassCache: true, preserveAudioHttpError: true, cancelWhenUnobserved: true },
    ).catch(error => {
      if (!selection.cursor && !selection.versionId && unavailable(error)) return undefined
      throw error
    })
    if (page === undefined) return undefined
    if (!page || !reference(page.snapshot_id) || !Array.isArray(page.items) || page.items.length > 100
      || !(page.next_cursor === '' || reference(page.next_cursor))
      || (selection.cursor && selection.cursor === page.next_cursor)) invalidResponse()
    if ((selection.snapshotId ?? selection.versionId) && (selection.snapshotId ?? selection.versionId) !== page.snapshot_id) {
      throw new ArkmePluginError('recording-view-changed', '转写内容已更新，请刷新后重试', true, 409)
    }
    for (const item of page.items) {
      if (!item || !reference(item.id) || !/^(?!0{24}$)[a-f0-9]{24}$/.test(item.session_id)
        || !/^(?!0{24}$)[a-f0-9]{24}$/.test(item.child_id)
        || !Number.isSafeInteger(item.asr_item_index) || item.asr_item_index < 0 || item.asr_item_index > 2_147_483_647
        || item.transcript_source !== source || !Number.isSafeInteger(item.start_at)
        || !Number.isSafeInteger(item.end_at) || item.end_at <= item.start_at || typeof item.text !== 'string' || !item.text.trim()
        || !item.speaker || !Number.isSafeInteger(item.speaker.number) || typeof item.speaker.name !== 'string'
        || typeof item.playable !== 'boolean') invalidResponse()
      validateActiveRanges(item)
    }
    if (new Set(page.items.map(item => item.id)).size !== page.items.length) invalidResponse()
    return page
  }
}
