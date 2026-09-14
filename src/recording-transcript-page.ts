import type { ArkmeRecordingDay, ArkmeRecordingTranscriptPage, ArkmeRecordingWorkbenchItem } from './types.js'

export function recordingDayNeedsRefresh(day: ArkmeRecordingDay | undefined): boolean {
  return day?.summary.state === 'processing' || day?.timeline.state === 'processing'
    || (day?.transcript.processingCount ?? 0) > 0
    || (day?.transcript.captureCoverage?.receiving ?? 0) > 0
}

export function recordingCaptureNotice(page: ArkmeRecordingTranscriptPage | undefined): string {
  if ((page?.captureCoverage?.interrupted ?? 0) === 0) return ''
  return (page?.processingCount ?? 0) > 0
    ? '当天有录音未收齐，已收到的内容仍在整理中。'
    : '当天有录音未收齐，已收到的内容仍可查看。'
}

function invalid(message = '录音内容已变化，请刷新后重试'): never { throw new Error(message) }
export class RecordingViewChanged extends Error {
  constructor() { super('录音内容正在更新'); this.name = 'RecordingViewChanged' }
}
export function isRecordingViewChanged(error: unknown): boolean {
  return error instanceof RecordingViewChanged || (typeof error === 'object' && error !== null
    && 'body' in error && typeof error.body === 'object' && error.body !== null
    && 'code' in error.body && error.body.code === 'recording-view-changed')
}
function validText(item: ArkmeRecordingWorkbenchItem): void {
  if (![item.textStartOffset, item.textEndOffset, item.textTotalLength].every(Number.isSafeInteger)
    || item.textStartOffset < 0 || item.textEndOffset <= item.textStartOffset || item.textTotalLength < item.textEndOffset
    || Array.from(item.text).length !== item.textEndOffset - item.textStartOffset) invalid('录音正文片段不完整')
}
function sameUtterance(a: ArkmeRecordingWorkbenchItem, b: ArkmeRecordingWorkbenchItem): boolean {
  return a.itemId === b.itemId && a.sessionKey === b.sessionKey && a.transcriptSource === b.transcriptSource
    && a.startAtMillis === b.startAtMillis && a.endAtMillis === b.endAtMillis
    && a.speakerKey === b.speakerKey && a.speakerLabel === b.speakerLabel && a.isBackground === b.isBackground
    && a.textTotalLength === b.textTotalLength
}

/** Appends only to the same owner snapshot. Text offsets count Unicode code
 * points, not JS UTF-16 units; an oversized utterance stays a single UI item. */
export function appendRecordingTranscriptPage(current: ArkmeRecordingTranscriptPage, next: ArkmeRecordingTranscriptPage): ArkmeRecordingTranscriptPage {
  if (current.viewRef === '' || current.dateStamp !== next.dateStamp || current.transcriptSource !== next.transcriptSource) invalid()
  if (current.viewRef !== next.viewRef) throw new RecordingViewChanged()
  if (current.nextCursor === '' || next.state === 'error'
    || next.nextCursor === current.nextCursor || next.items.length === 0 && next.nextCursor !== '') invalid()
  const items = [...current.items], seen = new Set(items.map(item => item.itemId))
  for (const item of next.items) {
    validText(item)
    const previous = items.at(-1)
    if (previous !== undefined && previous.itemId === item.itemId) {
      if (!sameUtterance(previous, item) || previous.textEndOffset !== item.textStartOffset) invalid()
      items[items.length - 1] = { ...previous, itemRef: item.itemRef, text: previous.text + item.text, textEndOffset: item.textEndOffset }
    } else {
      if (item.textStartOffset !== 0 || seen.has(item.itemId)
        || previous !== undefined && (previous.textEndOffset !== previous.textTotalLength || previous.startAtMillis > item.startAtMillis)) invalid()
      items.push(item); seen.add(item.itemId)
    }
  }
  if (next.nextCursor === '' && items.some(item => item.textEndOffset !== item.textTotalLength)) invalid('录音正文尚未读取完整')
  return { ...next, state: items.length > 0 ? 'ready' : next.state, items, message: items.length > 0 ? '' : next.message }
}

/** A refresh with the same snapshot may update progress without throwing away
 * already loaded text. A changed revision starts at the new first page. */
export function refreshRecordingTranscriptPage(current: ArkmeRecordingTranscriptPage, first: ArkmeRecordingTranscriptPage): ArkmeRecordingTranscriptPage {
  if (current.viewRef === '' || current.viewRef !== first.viewRef || current.dateStamp !== first.dateStamp || current.transcriptSource !== first.transcriptSource) return first
  return { ...first, items: current.items, nextCursor: current.nextCursor }
}

/** Restore the already-read time range before publishing a new revision. This
 * is a read operation: speaker edits and selected forwarding commands keep
 * their original references and must not use this recovery as a write retry. */
export async function restoreRecordingTranscriptPrefix(previous: ArkmeRecordingTranscriptPage, first: ArkmeRecordingTranscriptPage,
  read: (cursor: string) => Promise<ArkmeRecordingTranscriptPage>, signal: AbortSignal): Promise<ArkmeRecordingTranscriptPage> {
  if (previous.dateStamp !== first.dateStamp || previous.transcriptSource !== first.transcriptSource) invalid()
  let restored = refreshRecordingTranscriptPage(previous, first)
  if (restored.viewRef === previous.viewRef) return restored
  const boundary = previous.items.at(-1)?.startAtMillis
  const cursors = new Set<string>()
  while (boundary !== undefined && restored.nextCursor !== '' && (restored.items.at(-1)?.startAtMillis ?? -Infinity) <= boundary) {
    signal.throwIfAborted()
    if (cursors.has(restored.nextCursor)) invalid('录音分页未前进')
    cursors.add(restored.nextCursor)
    restored = appendRecordingTranscriptPage(restored, await read(restored.nextCursor))
  }
  signal.throwIfAborted()
  return restored
}

export async function readCompleteRecordingTranscript(first: ArkmeRecordingTranscriptPage, read: (cursor: string, signal?: AbortSignal) => Promise<ArkmeRecordingTranscriptPage>, signal?: AbortSignal): Promise<ArkmeRecordingTranscriptPage> {
  let page = first
  const cursors = new Set<string>()
  for (const item of page.items) validText(item)
  while (page.nextCursor !== '') {
    signal?.throwIfAborted()
    if (cursors.has(page.nextCursor)) invalid('录音分页未前进')
    cursors.add(page.nextCursor)
    page = appendRecordingTranscriptPage(page, await read(page.nextCursor, signal))
  }
  signal?.throwIfAborted()
  if (page.state === 'error' || page.items.some(item => item.textStartOffset !== 0 || item.textEndOffset !== item.textTotalLength)) invalid('录音正文尚未读取完整')
  return page
}
