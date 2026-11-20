import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { favoriteToolDetail, recordingFavoriteTools } from '../src/tools/business/recordings/favorites.js'
import type { RecordingFavoriteDetail } from '../src/recording-favorite-contract.js'
const success = (value: unknown) => new Response(JSON.stringify({ ok: true, value }), { headers: { 'Content-Type': 'application/json' } })
it('routes reads and fenced writes through the same Host and aborts disposed SDK requests', async () => {
  const calls: unknown[] = []
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); calls.push(body)
    return success(body.operation === 'provider.capabilities' ? { contractVersion: 1, features: { recordingFavoritesV1: true } } : { accountKey: 'test:42' })
  } })
  await sdk.recordingFavorites({ action: 'page' })
  await sdk.recordingFavorites({ action: 'remove', accountKey: 'test:42', favoriteRef: 'opaque', expectedVersion: 3 })
  expect(calls).toContainEqual({ operation: 'recordings.favorites', params: { action: 'page' } })
  expect(calls).toContainEqual({ operation: 'recordings.favorites', params: { action: 'remove', accountKey: 'test:42', favoriteRef: 'opaque', expectedVersion: 3 } })
  const count = calls.length
  sdk.dispose()
  await expect(sdk.recordingFavorites({ action: 'page' })).rejects.toThrow()
  expect(calls).toHaveLength(count)
})
it('blocks incompatible providers without issuing writes', async () => {
  const fetchImpl = vi.fn(async () => success({ contractVersion: 1, features: {} }))
  await expect(createArkmeSdk({ fetchImpl }).recordingFavorites({ action: 'save', sid: 'AbCdEf0123456789', accountKey: 'test:42', expectedVersion: 0 })).rejects.toThrow('不支持')
  expect(fetchImpl).toHaveBeenCalledOnce()
})
it('bounds model transcript output and supports lossless continuation inside a long segment', () => {
  const detail = { segments: [{ textContent: '甲'.repeat(18000) }, { textContent: '末尾' }] } as RecordingFavoriteDetail
  const one = favoriteToolDetail(detail), two = favoriteToolDetail(detail, one.nextSegmentOffset, one.nextTextOffset), three = favoriteToolDetail(detail, two.nextSegmentOffset, two.nextTextOffset)
  expect(one.segments[0]?.textContent.length).toBe(8000)
  expect([one, two, three].flatMap(page => page.segments).map(row => row.textContent).join('')).toBe('甲'.repeat(18000) + '末尾')
  expect(three.nextSegmentOffset).toBeUndefined()
  expect(() => favoriteToolDetail(detail, -1)).toThrow()
  expect(recordingFavoriteTools.map(module => module.meta)).toMatchObject([{ effect: 'read' }, { effect: 'write', grant: 'explicit-user-write' }])
})
