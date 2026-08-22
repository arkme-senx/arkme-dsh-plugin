export type MarketplaceSort = 'rating' | 'comments' | 'opens' | 'created_at'

export const DEFAULT_MARKETPLACE_SORT: MarketplaceSort = 'rating'

const STORAGE_KEY_PREFIX = 'dsh-arkme:marketplace-sort:v1:'

function preferenceStorage(storage?: Storage): Storage | undefined {
  if (storage !== undefined) return storage
  try { return typeof window === 'undefined' ? undefined : window.localStorage }
  catch { return undefined }
}

function preferenceKey(userId: number | undefined): string {
  return Number.isSafeInteger(userId) && (userId ?? 0) > 0
    ? `${STORAGE_KEY_PREFIX}user:${String(userId)}`
    : `${STORAGE_KEY_PREFIX}anonymous`
}

function isMarketplaceSort(value: string | null): value is MarketplaceSort {
  return value === 'rating' || value === 'comments' || value === 'opens' || value === 'created_at'
}

export function readMarketplaceSortPreference(userId?: number, storage?: Storage): MarketplaceSort {
  const target = preferenceStorage(storage)
  if (target === undefined) return DEFAULT_MARKETPLACE_SORT
  try {
    const value = target.getItem(preferenceKey(userId))
    return isMarketplaceSort(value) ? value : DEFAULT_MARKETPLACE_SORT
  } catch {
    return DEFAULT_MARKETPLACE_SORT
  }
}

export function writeMarketplaceSortPreference(
  userId: number | undefined,
  sort: MarketplaceSort,
  storage?: Storage,
): void {
  const target = preferenceStorage(storage)
  if (target === undefined) return
  try { target.setItem(preferenceKey(userId), sort) }
  catch { /* Browser preference storage is optional. */ }
}
