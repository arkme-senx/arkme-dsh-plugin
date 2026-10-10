export type ArkmeSelfTopicSort = 'latest' | 'most' | 'custom'

export const DEFAULT_SELF_TOPIC_SORT: ArkmeSelfTopicSort = 'custom'

const STORAGE_KEY_PREFIX = 'dsh-arkme:self-topic-sort:v1:user:'

function preferenceStorage(storage?: Storage): Storage | undefined {
  if (storage !== undefined) return storage
  try { return typeof window === 'undefined' ? undefined : window.localStorage }
  catch { return undefined }
}

function preferenceKey(userId: number | undefined): string | undefined {
  return Number.isSafeInteger(userId) && (userId ?? 0) > 0
    ? `${STORAGE_KEY_PREFIX}${String(userId)}`
    : undefined
}

function isSelfTopicSort(value: string | null): value is ArkmeSelfTopicSort {
  return value === 'latest' || value === 'most' || value === 'custom'
}

export function readSelfTopicSortPreference(userId?: number, storage?: Storage): ArkmeSelfTopicSort {
  const key = preferenceKey(userId)
  const target = preferenceStorage(storage)
  if (key === undefined || target === undefined) return DEFAULT_SELF_TOPIC_SORT
  try {
    const value = target.getItem(key)
    return isSelfTopicSort(value) ? value : DEFAULT_SELF_TOPIC_SORT
  } catch {
    return DEFAULT_SELF_TOPIC_SORT
  }
}

export function writeSelfTopicSortPreference(
  userId: number | undefined,
  sort: ArkmeSelfTopicSort,
  storage?: Storage,
): void {
  const key = preferenceKey(userId)
  const target = preferenceStorage(storage)
  if (key === undefined || target === undefined) return
  try { target.setItem(key, sort) }
  catch { /* Browser preference storage is optional. */ }
}
