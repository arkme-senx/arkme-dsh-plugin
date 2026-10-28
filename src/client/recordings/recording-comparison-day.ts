import type { RecordingStrategy, RecordingStrategyOptions, RecordingStrategyRecordings, RecordingStrategySources } from '../../recording-strategy-contract.js'
import { callArkme } from '../api.js'
import { ArkmeClientError } from '../../sdk/index.js'

export type DayComparisonSource = RecordingStrategySources['items'][number] & {
  options?: RecordingStrategyOptions
  error?: string
  retryableRead?: boolean
  /** Unknown pre-midnight coverage remains readable, but must not enqueue an unrelated day's file. */
  dayMembershipUnknown?: boolean
}
export function comparisonDayRange(dateStamp: number) {
  const start = new Date(dateStamp); start.setHours(0, 0, 0, 0)
  const end = new Date(start); end.setDate(end.getDate() + 1)
  return { start: start.getTime(), end: end.getTime() }
}
export function comparisonError(error: unknown) { return error instanceof Error ? error.message : '读取失败，请重试' }

/** Metadata only. Follow both existing cursors, including empty owner-filtered
 * pages; transcript bodies remain bounded by each visible column's pagination. */
export async function readDayComparisonSources(dateStamp: number, signal: AbortSignal): Promise<DayComparisonSource[]> {
  const { start, end } = comparisonDayRange(dateStamp)
  const sources: DayComparisonSource[] = []
  let cursor: string | undefined
  const recordingCursors = new Set<string>()
  do {
    signal.throwIfAborted()
    const page = await callArkme<RecordingStrategyRecordings>('recordings.strategies', { action: 'recordings', startAtMillis: start, endAtMillis: end, ...(cursor ? { cursor } : {}) }, signal)
    for (const recording of page.items) {
      let sourceCursor: string | undefined
      const cursors = new Set<string>()
      do {
        signal.throwIfAborted()
        const part = await callArkme<RecordingStrategySources>('recordings.strategies', { action: 'sources', sessionRef: recording.sessionRef, ...(sourceCursor ? { cursor: sourceCursor } : {}) }, signal)
        for (const source of part.items) {
          if (source.startAtMillis >= end || source.endAtMillis !== undefined && source.endAtMillis <= start) continue
          // Unknown coverage is not proof of exclusion or permission to process
          // another day's source. Keep readback, constrain rows, disable batch admission.
          sources.push({ ...source, dayMembershipUnknown: source.startAtMillis < start && source.endAtMillis === undefined })
        }
        sourceCursor = part.nextCursor
        if (sourceCursor && cursors.has(sourceCursor)) throw new Error('音频列表分页未推进，请重试')
        if (sourceCursor) cursors.add(sourceCursor)
      } while (sourceCursor)
    }
    cursor = page.nextCursor
    if (cursor && recordingCursors.has(cursor)) throw new Error('录音列表分页未推进，请重试')
    if (cursor) recordingCursors.add(cursor)
  } while (cursor)
  signal.throwIfAborted()
  return sources.sort((a, b) => a.startAtMillis - b.startAtMillis || a.fileName.localeCompare(b.fileName))
}

/** A day's recordings can be numerous; never fan out one HEAD/options request
 * per file at once. One failed source must not hide the rest of the day. */
export async function readDayComparisonOptions(sources: DayComparisonSource[], signal: AbortSignal): Promise<DayComparisonSource[]> {
  const result = sources.slice()
  let next = 0
  await Promise.all(Array.from({ length: Math.min(3, sources.length) }, async () => {
    for (;;) {
      signal.throwIfAborted()
      const index = next++, source = sources[index]
      if (!source) return
      try {
        const options = await callArkme<RecordingStrategyOptions>('recordings.strategies', { action: 'options', sourceRef: source.sourceRef }, signal)
        signal.throwIfAborted()
        result[index] = { ...source, options, error: '', retryableRead: false }
      } catch (error) {
        signal.throwIfAborted()
        result[index] = { ...source, error: comparisonError(error), retryableRead: !(error instanceof ArkmeClientError) || error.body.retryable }
      }
    }
  }))
  return result
}

export function canStartDayComparison(source: DayComparisonSource, strategy: RecordingStrategy, now = Date.now()) {
  const options = source.options
  return !source.error && !source.dayMembershipUnknown && !!options && options.officialComplete && !options.officialFailed
    && options.officialStrategy !== strategy && !options.results.some(result => result.strategy === strategy)
    && options.canStart && options.expiresAtMillis > now
}
export function comparisonSourceState(source: DayComparisonSource, selection: RecordingStrategy | 'official') {
  const options = source.options
  const strategy = selection === 'official' ? options?.officialStrategy : selection
  const official = strategy !== undefined && strategy === options?.officialStrategy
  const result = options?.results.find(row => row.strategy === strategy)
  return { strategy, official, exists: official || !!result,
    processing: official ? !options?.officialComplete : !!result && !result.complete,
    failed: official ? options?.officialFailed === true : result?.failed === true }
}
