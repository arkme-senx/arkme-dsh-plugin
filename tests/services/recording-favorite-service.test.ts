import { expect, it, vi } from 'vitest'
import { RecordingFavoriteService } from '../../src/services/recording-favorite-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../../src/services/service.js'
import { projectRecordingShare } from '../../src/services/recording-share.js'

const uid = 'a'.repeat(64), sid = 'AbCdEf0123456789', base = `/api/v1/chats/recording-favorites/${uid}/audio`
const content = () => ({ structured_kind: 1, long_recording_segments: [
  { speaker_number: 1, speaker_label: '甲', text: '第一段', start_millis: 500, end_millis: 1500, occurred_at: 1730000000500 },
  { speaker_number: 2, speaker_label: '乙', text: '第二段', start_millis: 3500, end_millis: 5500, occurred_at: 1730000003500 },
], recording_audio: { duration_millis: 3000, url: base, clips: [{ url: `${base}/0`, duration_millis: 1000 }, { url: `${base}/1`, duration_millis: 2000 }] } })
const row = () => ({ favorite_uid: uid, saved: true, version: 1, available: true, created_at: 1730000000000, saved_at: 1730000000000, read_at: 0,
  recording_started_at: 1730000000500, segment_count: 2, duration_millis: 3000, preview: '片段摘要', sharer_display_name: '甲', collector_display_name: '乙',
  items: [{ send_at: 1730000000000, structured_content: content() }], can_revoke: true,
  source_context: { session_id: 'secret-session', child_id: 'secret-child', asr_item_index: 4, occurred_at: 1730000000500, start_millis: 500 } })
function fixture() {
  let userId = 42
  const post = vi.fn(), media = { issueChatRecordingMediaRef: vi.fn((_user: number, path: string) => `opaque-media-${path.endsWith('/1') ? 1 : 0}`) }
  const runtime = { config: { environment: 'test' }, stateStore: { uniqueCode: async () => 'test-profile' },
    requireSession: async () => ({ userId, refreshToken: 'refresh' }), accountScopedSession: async () => ({ userId, refreshToken: 'refresh' }), authenticatedChatPost: post } as unknown as ServiceRuntime
  return { service: new RecordingFavoriteService(runtime, media), media, post, switchAccount: () => { userId = 99 } }
}
it('projects bounded pages without transcript, internal identities or acknowledgement', async () => {
  const f = fixture(); f.post.mockResolvedValue({ items: [row()], next_cursor: null, server_at: 1730000009000 })
  const p = await f.service.request({ action: 'notifications' })
  expect(p.items[0]).toMatchObject({ audience: 'sharer', collector: { name: '乙' }, segmentCount: 2 })
  expect(JSON.stringify(p)).not.toMatch(/secret-session|secret-child|favorite_uid|第一段|a{64}/)
  expect(f.post.mock.calls[0]![0]).toMatch(/notifications\/page$/)
  expect(f.post).toHaveBeenCalledOnce()
  expect(f.media.issueChatRecordingMediaRef).not.toHaveBeenCalled()
  const again = await f.service.request({ action: 'notifications' }); expect(again.items[0]!.favoriteRef).toBe(p.items[0]!.favoriteRef)
})
it('plays selected clips through opaque refs and separates sharer from collector permissions', async () => {
  const f = fixture(); f.post.mockResolvedValueOnce({ items: [row()], next_cursor: null, server_at: 1730000009000 }).mockResolvedValue(row())
  const page = await f.service.request({ action: 'notifications' }), ref = page.items[0]!.favoriteRef
  const d = await f.service.request({ action: 'detail', favoriteRef: ref })
  expect(d.audio?.clips).toHaveLength(2); expect(d.sourceRef).toBeTruthy(); expect(d.canRevoke).toBe(true)
  expect(JSON.stringify(d)).not.toMatch(/secret-session|secret-child|favorite_uid|https:/)
  const source = await f.service.request({ action: 'source', sourceRef: d.sourceRef! })
  expect(source.atMillis).toBe(1730000000500); expect(source.identityHash).toMatch(/^[a-f0-9]{64}$/)
  await expect(f.service.request({ action: 'remove', favoriteRef: ref, accountKey: page.accountKey, expectedVersion: 1 })).rejects.toThrow()
  const collector = await f.service.request({ action: 'save', accountKey: page.accountKey, sid, expectedVersion: 0 })
  expect(collector.sourceRef).toBeUndefined(); expect(collector.canRevoke).toBe(false)
  await expect(f.service.request({ action: 'revoke', accountKey: page.accountKey, favoriteRef: collector.favoriteRef })).rejects.toThrow()
})
it('rejects stale scopes before writes and late reads after switching accounts', async () => {
  const f = fixture()
  await expect(f.service.request({ action: 'save', sid, expectedVersion: 0, accountKey: 'test:99' })).rejects.toThrow('账号已变化')
  expect(f.post).not.toHaveBeenCalled()
  f.post.mockImplementation(async () => { f.switchAccount(); return row() })
  await expect(f.service.request({ action: 'status', sid })).rejects.toThrow('账号已变化')
})
it('binds references and observed read watermarks to account, profile and purpose', async () => {
  const f = fixture(); f.post.mockResolvedValue({ items: [row()], next_cursor: null, server_at: 1730000009000 })
  const p = await f.service.request({ action: 'notifications' })
  f.post.mockResolvedValue({})
  await f.service.request({ action: 'read', accountKey: p.accountKey, readThrough: p.readThrough })
  expect(f.post.mock.lastCall?.[1]).toEqual({ through: 1730000009000 })
  await expect(f.service.request({ action: 'read', accountKey: p.accountKey, readThrough: p.items[0]!.favoriteRef })).rejects.toThrow()
  f.switchAccount()
  await expect(f.service.request({ action: 'detail', favoriteRef: p.items[0]!.favoriteRef })).rejects.toThrow()
})
it('does not replay conflicting or uncertain mutations', async () => {
  const f = fixture(); f.post.mockRejectedValueOnce(new ArkmePluginError('arkme-code-2002', 'conflict', false, 502))
  await expect(f.service.request({ action: 'save', accountKey: 'test:42', sid, expectedVersion: 0 })).rejects.toMatchObject({ code: 'recording-favorite-conflict' })
  expect(f.post).toHaveBeenCalledOnce()
  f.post.mockRejectedValueOnce(new Error('connection lost'))
  await expect(f.service.request({ action: 'save', accountKey: 'test:42', sid, expectedVersion: 0 })).rejects.toThrow('connection lost')
  expect(f.post).toHaveBeenCalledTimes(2)
})
it('removes unavailable content and rejects malformed or looping pages', async () => {
  const f = fixture(); f.post.mockResolvedValue({ ...row(), available: false })
  const detail = await f.service.request({ action: 'save', accountKey: 'test:42', sid, expectedVersion: 0 })
  expect(detail.segments).toEqual([]); expect(detail.audio).toBeUndefined(); expect(detail.sourceRef).toBeUndefined()
  f.post.mockResolvedValue({ items: Array.from({ length: 21 }, row), next_cursor: null, server_at: 1 })
  await expect(f.service.request({ action: 'page' })).rejects.toThrow()
})
it.each(['foreign-url', 'private-source', 'duration', 'order', 'missing-clip'])('rejects unsafe manifest: %s before media issuance', mode => {
  const c = content(), media = { issueChatRecordingMediaRef: vi.fn(() => 'opaque') }
  if (mode === 'foreign-url') c.recording_audio.clips[0]!.url = 'https://outside.test/audio'
  if (mode === 'private-source') c.recording_audio.url = '/api/v1/audio/private'
  if (mode === 'duration') c.recording_audio.clips[1]!.duration_millis++
  if (mode === 'order') c.recording_audio.clips.reverse()
  if (mode === 'missing-clip') c.recording_audio.clips.pop()
  expect(() => projectRecordingShare(c, 1730000000000, base, 42, media)).toThrow()
  expect(media.issueChatRecordingMediaRef).not.toHaveBeenCalled()
})
it('keeps legacy single-file playback and absolute occurrence times', () => {
  const c = content(); delete (c.recording_audio as { clips?: unknown }).clips
  const result = projectRecordingShare(c, 1730000000000, base, 42, { issueChatRecordingMediaRef: () => 'legacy' })
  expect(result.audio.clips).toEqual([{ mediaRef: 'legacy', durationMillis: 3000 }])
  expect(result.segments[0]!.occurredAtMillis).toBe(1730000000500)
})

it('accepts a zero snapshot send time when each frozen segment supplies its absolute occurrence time', async () => {
  const f = fixture(), value = row(); value.items[0]!.send_at = 0
  f.post.mockResolvedValueOnce({ items: [value], server_at: 1730000006000 }).mockResolvedValueOnce(value)
  const page = await f.service.request({ action: 'page' })
  const detail = await f.service.request({ action: 'detail', favoriteRef: page.items[0]!.favoriteRef })
  expect(detail.segments[0]?.occurredAtMillis).toBe(1730000000500)
  expect(detail.audio?.clips).toHaveLength(2)
})
