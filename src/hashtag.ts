import type { ArkmeRecordTagItem, ArkmeTimelineItem } from './types.js'

/** Flutter-compatible tag terminators. Keep this list in sync with chat_input_rich_support.dart. */
export const ARKME_HASH_TAG_TERMINATORS = new Set(
  [...' \n#＃，。！？；：、"（）【】《》,.!?;:\'()[]<>'],
)

export interface ArkmeHashTagRange {
  /** Tag text without the leading #/＃. */
  tag: string
  /** UTF-16 offset of the leading #/＃, matching JS and Flutter string offsets. */
  startIndex: number
  /** UTF-16 length including the leading #/＃. */
  length: number
}

export interface ArkmeHashTagTrigger {
  startIndex: number
  endIndex: number
  query: string
}

function isHashTagAnchor(value: string): boolean {
  return value === '#' || value === '＃'
}

/** Normalizes either rendered tag form to the key accepted by the tag projection API. */
export function arkmeNormalizedHashTag(value: string): string {
  return value.trim().replace(/^[#＃]+/u, '').trim()
}

/** Keeps the search field aligned with Flutter while accepting either hash character. */
export function arkmeHashTagSearchQuery(value: string): string | undefined {
  const normalized = arkmeNormalizedHashTag(value)
  return normalized === '' ? undefined : `#${normalized}`
}

/** Returns an exact tag key only when the search text explicitly starts with a hash. */
export function arkmeHashTagSearchKey(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed.startsWith('#') && !trimmed.startsWith('＃')) return undefined
  const normalized = arkmeNormalizedHashTag(trimmed)
  return normalized === '' ? undefined : normalized
}

/** Finds all non-empty tags. An unterminated final tag is complete enough to send. */
export function arkmeHashTagRanges(text: string): ArkmeHashTagRange[] {
  const ranges: ArkmeHashTagRange[] = []
  let index = 0
  while (index < text.length) {
    if (!isHashTagAnchor(text[index]!)) {
      index += 1
      continue
    }
    const contentStart = index + 1
    let contentEnd = contentStart
    while (contentEnd < text.length && !ARKME_HASH_TAG_TERMINATORS.has(text[contentEnd]!)) contentEnd += 1
    if (contentEnd > contentStart) {
      ranges.push({
        tag: text.slice(contentStart, contentEnd),
        startIndex: index,
        length: contentEnd - index,
      })
    }
    index = contentEnd > index ? contentEnd : index + 1
  }
  return ranges
}

/** Resolves the active tag fragment immediately after typing either # variant. */
export function arkmeHashTagTrigger(
  text: string,
  selectionStart: number,
  selectionEnd = selectionStart,
): ArkmeHashTagTrigger | undefined {
  const start = Math.max(0, Math.min(text.length, Math.trunc(selectionStart)))
  const end = Math.max(0, Math.min(text.length, Math.trunc(selectionEnd)))
  if (start !== end) return undefined
  for (let index = start - 1; index >= 0; index -= 1) {
    const value = text[index]!
    if (isHashTagAnchor(value)) {
      return { startIndex: index, endIndex: start, query: text.slice(index + 1, start) }
    }
    if (ARKME_HASH_TAG_TERMINATORS.has(value)) return undefined
  }
  return undefined
}

export function arkmeHashTagPayload(text: string): Array<{ tag: string; start_index: number; length: number }> {
  return arkmeHashTagRanges(text).map(item => ({
    tag: item.tag,
    start_index: item.startIndex,
    length: item.length,
  }))
}

export function arkmeHashTagContentPayload(text: string): Record<string, unknown> | undefined {
  const hashTags = arkmeHashTagPayload(text)
  return hashTags.length === 0 ? undefined : {
    payload_kind: 1,
    schema_version: 1,
    text_state: 1,
    hash_tags: hashTags,
  }
}

export function arkmeHashTagMatches(tag: string, query: string): boolean {
  return query === '' || tag.toLocaleLowerCase().includes(query.toLocaleLowerCase())
}

/**
 * Rebuilds the single candidate snapshot used by the composer from the remote
 * projection and the records currently visible in the active input source.
 * This mirrors Flutter's loader: both inputs are folded before TagModeManager
 * replaces its one `_availableTags` list.
 */
export function arkmeMergeHashTagSuggestions(
  remoteItems: readonly ArkmeRecordTagItem[],
  records: readonly Pick<ArkmeTimelineItem, 'itemUid' | 'textContent' | 'sendAtMillis'>[],
): ArkmeRecordTagItem[] {
  const merged = new Map<string, ArkmeRecordTagItem>()
  const add = (item: ArkmeRecordTagItem) => {
    const tagText = item.tagText.trim().replace(/^[#＃]+/u, '').trim()
    if (tagText === '') return
    const key = tagText.toLocaleLowerCase()
    const previous = merged.get(key)
    if (previous === undefined) {
      merged.set(key, {
        ...item,
        normalizedTag: item.normalizedTag.trim() || key,
        tagText,
        recordCount: Math.max(0, Math.trunc(item.recordCount)),
        latestSendAtMillis: Math.max(0, Math.trunc(item.latestSendAtMillis)),
      })
      return
    }
    const itemIsLatest = item.latestSendAtMillis > previous.latestSendAtMillis
    merged.set(key, {
      ...previous,
      recordCount: previous.recordCount + Math.max(0, Math.trunc(item.recordCount)),
      ...(itemIsLatest ? {
        latestRecordUid: item.latestRecordUid,
        latestSendAtMillis: Math.max(0, Math.trunc(item.latestSendAtMillis)),
      } : {}),
    })
  }

  for (const item of remoteItems) add(item)
  for (const record of records) {
    for (const tag of arkmeHashTagRanges(record.textContent)) {
      add({
        normalizedTag: tag.tag.toLocaleLowerCase(),
        tagText: tag.tag,
        recordCount: 1,
        latestRecordUid: record.itemUid,
        latestSendAtMillis: record.sendAtMillis,
      })
    }
  }

  return [...merged.values()].sort((left, right) =>
    right.recordCount - left.recordCount || left.tagText.localeCompare(right.tagText),
  )
}

/**
 * Reconciles independently aggregated candidate snapshots without counting the
 * same records twice. Remote results remain authoritative when available,
 * while newer account-local entries survive projection lag and source changes.
 */
export function arkmeReconcileHashTagSuggestionSnapshots(
  ...snapshots: readonly (readonly ArkmeRecordTagItem[])[]
): ArkmeRecordTagItem[] {
  const reconciled = new Map<string, ArkmeRecordTagItem>()
  for (const snapshot of snapshots) {
    for (const item of snapshot) {
      const tagText = item.tagText.trim().replace(/^[#＃]+/u, '').trim()
      if (tagText === '') continue
      const key = tagText.toLocaleLowerCase()
      const normalized: ArkmeRecordTagItem = {
        ...item,
        normalizedTag: item.normalizedTag.trim() || key,
        tagText,
        recordCount: Math.max(0, Math.trunc(item.recordCount)),
        latestSendAtMillis: Math.max(0, Math.trunc(item.latestSendAtMillis)),
      }
      const previous = reconciled.get(key)
      if (previous === undefined) {
        reconciled.set(key, normalized)
        continue
      }
      const normalizedIsLatest = normalized.latestSendAtMillis > previous.latestSendAtMillis
      reconciled.set(key, {
        ...(normalizedIsLatest ? normalized : previous),
        recordCount: Math.max(previous.recordCount, normalized.recordCount),
      })
    }
  }
  return [...reconciled.values()].sort((left, right) =>
    right.recordCount - left.recordCount
      || right.latestSendAtMillis - left.latestSendAtMillis
      || left.tagText.localeCompare(right.tagText),
  )
}
