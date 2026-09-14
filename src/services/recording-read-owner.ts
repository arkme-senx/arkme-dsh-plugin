import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { recordingPlaybackLocator, type RecordingPlaybackLocator } from '../recording-playback-ref.js'
import { ArkmePluginError, ArkmeUpstreamResponseError, type ServiceRuntime } from './service.js'

export type RecordingReadSource = 'primary' | 'enhanced'
export interface RecordingReadWindow { startAt: number; endAt: number }
export interface RecordingReadView { recording_uid: string; revision: string; source: RecordingReadSource }
export interface RecordingOwnerCoverage {
  ready_count: number; processing_count: number; failed_count: number; silent_count: number; candidate_count: number
}
export interface RecordingOwnerFact {
  recording_uid: string; start_at: number; end_at: number; duration_ms: number; owner_version: number
  capture_state: '' | 'receiving' | 'complete' | 'interrupted'
}
export interface RecordingOwnerSpeaker { reference: string; userId?: number; label: string; kind: string }
export interface RecordingOwnerFragment {
  recordingId: string
  revision: string
  locator: RecordingPlaybackLocator
  index: number
  startAt: number
  endAt: number
  text: string
  event: string
  isBackground: boolean
  textStart: number
  textEnd: number
  textTotal: number
  speaker: RecordingOwnerSpeaker
}
export interface RecordingOwnerTranscriptPage {
  recordingId: string; revision: string; startAt: number
  items: RecordingOwnerFragment[]; nextCursor: string; coverage: RecordingOwnerCoverage
}
interface RecordingDayPosition {
  fact: RecordingOwnerFact
  revision: string
  cursor: string
  skip: number
  limit: number
  done: boolean
  last?: Omit<RecordingOwnerFragment, 'text'>
}
/** Host-only continuation. Seal with the existing account-bound reference owner
 * before exposing it. It contains coordinates/revisions, never transcript text. */
export interface RecordingDayReadCursor extends RecordingReadWindow {
  source: RecordingReadSource
  positions: RecordingDayPosition[]
}
export interface RecordingOwnerDayPage {
  items: RecordingOwnerFragment[]
  views: RecordingReadView[]
  totalDurationMillis: number
  coverage: RecordingOwnerCoverage
  captureCoverage?: { receiving: number; interrupted: number }
  next?: RecordingDayReadCursor
}

const objectID = /^(?!0{24}$)[a-f0-9]{24}$/
const revisionID = /^[a-f0-9]{64}$/
const speakerID = /^speaker:[a-f0-9]{16}$/
function invalid(): never { throw new ArkmePluginError('recording-owner-response-invalid', '录音读取响应无效，请重试', true, 502) }
function stale(): never { throw new ArkmePluginError('recording-view-changed', '录音内容已更新，请刷新后重试', true, 409) }
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
function integer(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) return invalid()
  return value
}
function text(value: unknown): string { if (typeof value !== 'string') return invalid(); return value }
function id(value: unknown): string { const result = text(value); if (!objectID.test(result)) return invalid(); return result }
function revision(value: unknown): string { const result = text(value); if (!revisionID.test(result)) return invalid(); return result }
function nextCursor(row: Record<string, unknown>): string {
  if (typeof row.has_more !== 'boolean') return invalid()
  const value = row.next_page_cursor === undefined ? '' : text(row.next_page_cursor)
  if (value.length > 4_096 || row.has_more !== (value !== '')) return invalid()
  return value
}
function coverage(value: unknown): RecordingOwnerCoverage {
  const row = record(value)
  return { ready_count: integer(row.ready_count), processing_count: integer(row.processing_count), failed_count: integer(row.failed_count), silent_count: integer(row.silent_count), candidate_count: integer(row.candidate_count) }
}
function emptyCoverage(): RecordingOwnerCoverage { return { ready_count: 0, processing_count: 0, failed_count: 0, silent_count: 0, candidate_count: 0 } }
function captureState(value: unknown): RecordingOwnerFact['capture_state'] {
  if (value === undefined) return ''
  if (value === '' || value === 'receiving' || value === 'complete' || value === 'interrupted') return value
  return invalid()
}
function speaker(value: unknown): RecordingOwnerSpeaker {
  const row = record(value)
  const reference = row.reference === undefined ? '' : text(row.reference)
  const kind = text(row.kind)
  if (reference !== '' && !speakerID.test(reference) || !['unknown', 'named', 'anonymous', 'user'].includes(kind)) return invalid()
  return { reference, kind, label: text(row.label), ...(row.user_id === undefined || row.user_id === 0 ? {} : { userId: integer(row.user_id, 1) }) }
}
function sameLocation(a: RecordingOwnerFragment['locator'], b: RecordingOwnerFragment['locator']): boolean {
  return a.child_id === b.child_id && a.source === b.source && a.ordinal === b.ordinal
}
function follows(previous: Omit<RecordingOwnerFragment, 'text'>, next: RecordingOwnerFragment): void {
  if (previous.recordingId !== next.recordingId || previous.revision !== next.revision) return stale()
  if (previous.textEnd < previous.textTotal) {
    if (previous.index !== next.index || previous.textEnd !== next.textStart || previous.textTotal !== next.textTotal
      || previous.startAt !== next.startAt || previous.endAt !== next.endAt || !sameLocation(previous.locator, next.locator)
      || previous.event !== next.event || previous.isBackground !== next.isBackground
      || previous.speaker.reference !== next.speaker.reference || previous.speaker.kind !== next.speaker.kind
      || previous.speaker.userId !== next.speaker.userId || previous.speaker.label !== next.speaker.label) return invalid()
  } else if (next.index !== previous.index + 1 || next.textStart !== 0 || next.startAt < previous.startAt || sameLocation(previous.locator, next.locator)) return invalid()
}
function compare(a: RecordingOwnerFragment, b: RecordingOwnerFragment): number {
  return a.startAt - b.startAt || a.recordingId.localeCompare(b.recordingId)
    || a.locator.child_id.localeCompare(b.locator.child_id) || a.locator.ordinal - b.locator.ordinal || a.textStart - b.textStart
}
function validateWindow(window: RecordingReadWindow): void {
  integer(window.startAt); integer(window.endAt, window.startAt + 1)
}

/** Authenticated, cancellable consumption of Audio's semantic read contract.
 * No OSS path, speaker-number inference, or full-day fallback belongs here. */
export class RecordingReadOwner {
  constructor(private readonly runtime: Pick<ServiceRuntime, 'authenticatedAudioPost' | 'requireSession'>) {}

  private async read(path: string, body: Record<string, unknown>, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted()
    if ((await this.runtime.requireSession()).userId !== session.userId) return stale()
    let result: unknown
    try { result = await this.runtime.authenticatedAudioPost(path, body, session, signal, { bypassCache: true }) }
    catch (error) {
      if (error instanceof ArkmeUpstreamResponseError && typeof error.responseData === 'object' && error.responseData !== null
        && 'error_code' in error.responseData && error.responseData.error_code === 'recording_view_changed') return stale()
      throw error
    }
    signal?.throwIfAborted()
    if ((await this.runtime.requireSession()).userId !== session.userId) return stale()
    return result
  }

  async recordings(window: RecordingReadWindow, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<RecordingOwnerFact[]> {
    validateWindow(window)
    const facts: RecordingOwnerFact[] = []
    const seen = new Set<string>(), cursors = new Set<string>()
    let cursor = ''
    do {
      const row = record(await this.read('/api/v1/audio/recordings/query', {
        start_at: window.startAt, end_at: window.endAt, order: 'asc', limit: 50, ...(cursor === '' ? {} : { page_cursor: cursor }),
      }, session, signal))
      if (!Array.isArray(row.items) || row.items.length > 50) return invalid()
      for (const value of row.items) {
        const item = record(value)
        if (item.status !== 'available') return invalid()
        const fact = { recording_uid: id(item.recording_uid), start_at: integer(item.start_at), end_at: integer(item.end_at ?? 0), duration_ms: integer(item.duration_ms ?? 0), owner_version: integer(item.owner_version, 1), capture_state: captureState(item.capture_state) }
        if (seen.has(fact.recording_uid)) return invalid()
        seen.add(fact.recording_uid); facts.push(fact)
      }
      cursor = nextCursor(row)
      // Bounded owner scans may filter every candidate in a page. A changing
      // cursor still makes progress; only a repeated cursor is invalid.
      if (cursor !== '' && cursors.has(cursor)) return invalid()
      cursors.add(cursor)
    } while (cursor !== '')
    return facts
  }

  async transcript(recordingId: string, source: RecordingReadSource, window: RecordingReadWindow, session: ArkmeSessionCredentials, options: { cursor?: string; limit?: number; revision?: string } = {}, signal?: AbortSignal): Promise<RecordingOwnerTranscriptPage> {
    validateWindow(window); id(recordingId)
    const limit = options.limit ?? 100
    if (!['primary', 'enhanced'].includes(source) || integer(limit, 1) > 200) return invalid()
    const row = record(await this.read('/api/v1/audio/recordings/transcript/query', {
      recording_uid: recordingId, source, text_mode: 'full', start_at: window.startAt, end_at: window.endAt, limit,
      ...(options.cursor === undefined || options.cursor === '' ? {} : { page_cursor: options.cursor }),
    }, session, signal))
    if (row.status === 'unavailable') return stale()
    if (row.status !== 'available' || id(row.recording_uid) !== recordingId) return invalid()
    const version = revision(row.revision)
    if (options.revision !== undefined && options.revision !== '' && version !== options.revision) return stale()
    const startAt = integer(row.start_at)
    if (!Array.isArray(row.speakers) || !Array.isArray(row.utterances) || row.utterances.length > limit || row.speakers.length > limit) return invalid()
    const speakers = row.speakers.map(speaker)
    const items: RecordingOwnerFragment[] = row.utterances.map(value => {
      const item = record(value)
      let locator: RecordingPlaybackLocator | undefined
      try { locator = recordingPlaybackLocator(item.clip_locator) } catch { return invalid() }
      if (locator === undefined || locator.source !== source) return invalid()
      const identity = speakers[integer(item.speaker_index)]
      if (identity === undefined) return invalid()
      const start = integer(startAt + integer(item.start_offset_ms)), end = integer(startAt + integer(item.end_offset_ms), start + 1)
      const body = text(item.text), begin = integer(item.text_start_offset), finish = integer(item.text_end_offset, begin + 1), total = integer(item.text_total_length, finish)
      if (item.text_truncated !== undefined && typeof item.text_truncated !== 'boolean') return invalid()
      if (Array.from(body).length !== finish - begin || finish - begin > 4_000 || (item.text_truncated === true) !== (begin > 0 || finish < total)
        || start >= window.endAt || end <= window.startAt) return invalid()
      if (item.is_background !== undefined && typeof item.is_background !== 'boolean') return invalid()
      return { recordingId, revision: version, locator, index: integer(item.utterance_index), startAt: start, endAt: end, text: body, event: item.event === undefined ? '' : text(item.event), isBackground: item.is_background === true, textStart: begin, textEnd: finish, textTotal: total, speaker: identity }
    })
    if (items.reduce((sum, item) => sum + item.textEnd - item.textStart, 0) > 20_000) return invalid()
    for (let index = 1; index < items.length; index++) follows(items[index - 1]!, items[index]!)
    const cursor = nextCursor(row)
    if (cursor !== '' && (items.length === 0 || cursor === options.cursor) || cursor === '' && items.length > 0 && items.at(-1)!.textEnd !== items.at(-1)!.textTotal) return invalid()
    return { recordingId, revision: version, startAt, items, nextCursor: cursor, coverage: coverage(row.coverage) }
  }

  async dayPage(window: RecordingReadWindow, source: RecordingReadSource, session: ArkmeSessionCredentials, continuation?: RecordingDayReadCursor, signal?: AbortSignal): Promise<RecordingOwnerDayPage> {
    validateWindow(window)
    if (continuation !== undefined && (continuation.startAt !== window.startAt || continuation.endAt !== window.endAt || continuation.source !== source)) return stale()
    const state: RecordingDayReadCursor = continuation === undefined
      ? { ...window, source, positions: (await this.recordings(window, session, signal)).map(fact => ({ fact, revision: '', cursor: '', skip: 0, limit: 1, done: false })) }
      : structuredClone(continuation)
    const pages = new Map<string, RecordingOwnerTranscriptPage>()
    const total = emptyCoverage()
    // Two independent read lanes keep first-page work bounded on the current
    // small deployment. Only one lookahead per recording is fetched initially.
    let next = 0
    const readController = new AbortController()
    const readSignal = signal === undefined ? readController.signal : AbortSignal.any([signal, readController.signal])
    const lanes = Array.from({ length: Math.min(2, state.positions.length) }, async () => {
      for (;;) {
        const position = state.positions[next++]
        if (position === undefined) return
        const page = await this.transcript(position.fact.recording_uid, source, window, session, {
          cursor: position.done ? '' : position.cursor, limit: position.done ? 1 : position.limit, revision: position.revision,
        }, readSignal)
        position.revision = page.revision
        for (const key of Object.keys(total) as Array<keyof RecordingOwnerCoverage>) total[key] += page.coverage[key]
        if (!position.done) {
          if (integer(position.skip) > page.items.length) return invalid()
          pages.set(position.fact.recording_uid, page)
        }
      }
    })
    try { await Promise.all(lanes) }
    catch (reason) {
      readController.abort()
      await Promise.allSettled(lanes)
      throw reason
    }
    const items: RecordingOwnerFragment[] = []
    let characters = 0
    while (items.length < 100 && characters < 20_000) {
      let selected: RecordingDayPosition | undefined, fragment: RecordingOwnerFragment | undefined
      for (const position of state.positions) {
        if (position.done) continue
        let page = pages.get(position.fact.recording_uid)!
        if (position.skip === page.items.length) {
          if (page.nextCursor === '') { position.done = true; continue }
          position.cursor = page.nextCursor; position.skip = 0; position.limit = 100
          page = await this.transcript(position.fact.recording_uid, source, window, session, { cursor: position.cursor, limit: position.limit, revision: position.revision }, signal)
          pages.set(position.fact.recording_uid, page)
        }
        const candidate = page.items[position.skip]
        if (candidate === undefined) return invalid()
        if (position.last !== undefined) follows(position.last, candidate)
        if (fragment === undefined || compare(candidate, fragment) < 0) { selected = position; fragment = candidate }
      }
      if (selected === undefined || fragment === undefined) break
      const length = fragment.textEnd - fragment.textStart
      if (characters + length > 20_000) break
      items.push(fragment); characters += length
      const { text: _text, ...last } = fragment
      selected.last = last; selected.skip++
    }
    for (const position of state.positions) {
      const page = pages.get(position.fact.recording_uid)
      if (page !== undefined && position.skip === page.items.length && page.nextCursor === '') position.done = true
    }
    const captures = state.positions.filter(position => position.fact.capture_state !== '')
    return {
      items, coverage: total,
      ...(captures.length === 0 ? {} : { captureCoverage: {
        receiving: captures.filter(position => position.fact.capture_state === 'receiving').length,
        interrupted: captures.filter(position => position.fact.capture_state === 'interrupted').length,
      } }),
      views: state.positions.map(position => ({ recording_uid: position.fact.recording_uid, revision: position.revision, source })),
      totalDurationMillis: state.positions.reduce((sum, position) => sum + Math.max(0, Math.min(window.endAt, position.fact.end_at) - Math.max(window.startAt, position.fact.start_at)), 0),
      ...(state.positions.every(position => position.done) ? {} : { next: state }),
    }
  }

  /** Explicit full-content consumer. No caller can mistake an initial page for
   * a full transcript when generating, searching or exporting a day. */
  async completeDay(window: RecordingReadWindow, source: RecordingReadSource, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<RecordingOwnerDayPage> {
    const items: RecordingOwnerFragment[] = []
    let cursor: RecordingDayReadCursor | undefined
    let page: RecordingOwnerDayPage
    do {
      page = await this.dayPage(window, source, session, cursor, signal)
      for (const fragment of page.items) {
        const last = items.at(-1)
        if (last !== undefined && last.recordingId === fragment.recordingId && last.index === fragment.index) {
          follows(last, fragment)
          last.text += fragment.text; last.textEnd = fragment.textEnd
        } else {
          if (fragment.textStart !== 0) return invalid()
          items.push({ ...fragment })
        }
      }
      cursor = page.next
    } while (cursor !== undefined)
    if (items.some(item => item.textStart !== 0 || item.textEnd !== item.textTotal)) return invalid()
    return { ...page, items }
  }
}
