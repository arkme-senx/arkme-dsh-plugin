import { ArkmeSdk, type RecordingFavoriteDetail, type RecordingFavoritePage } from '@senguoyun/dsh-arkme/sdk'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
export async function verifyInstalledFavorites(fetchImpl: typeof fetch, sid: string) {
  const sdk = new ArkmeSdk({ fetchImpl })
  const status = await sdk.recordingFavorites({ action: 'status', sid })
  assert(status.saved && status.favoriteRef, 'pre-existing isolated test favorite')
  const page: RecordingFavoritePage = await sdk.recordingFavorites({ action: 'page', accountKey: status.accountKey })
  assert(page.items.some(item => item.favoriteRef === status.favoriteRef), 'stable discovery reference')
  const detail: RecordingFavoriteDetail = await sdk.recordingFavorites({ action: 'detail', accountKey: status.accountKey, favoriteRef: status.favoriteRef })
  assert(detail.available && detail.segments.length > 0 && detail.audio?.clips.length, 'authorized segments and media')
  assert(!detail.sourceRef && !detail.canRevoke, 'collector cannot acquire sharer authority')
  assert(!JSON.stringify(detail).includes('world-excerpts/'), 'private object keys excluded')
  sdk.dispose()
  let rejected = false
  try { await sdk.recordingFavorites({ action: 'page' }) } catch { rejected = true }
  assert(rejected, 'disposed SDK cannot issue requests')
  return { segmentCount: detail.segments.length, clipCount: detail.audio.clips.length, durationMillis: detail.audio.durationMillis }
}
