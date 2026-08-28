import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { MediaService } from '../../src/services/media-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('MediaService', () => {
  it('keeps previews separate from originals and classifies a stale file-marked MP3 as audio', async () => {
    const sessions: ArkmeSessionStore = { async read() { return { userId: 42, accessToken: 'fixture', refreshToken: 'fixture' } }, async write() {}, async delete() {} }
    const fetchImpl = vi.fn(async () => new Response('original'))
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const media = new MediaService(runtime, new ProfileService(runtime), {} as never, { recordUid() { return '' } })
    const origin = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/'
    const blocks = media.richContentBlocks({ media_display_items: [
      { file_asset_uid: 'image-1', file_kind: 1, file_name: 'a.png', mime_type: 'image/png', preview_url: `${origin}preview`, download_url: `${origin}original`, size: 8 },
      { file_asset_uid: 'image-2', file_kind: 1, file_name: 'b.png', mime_type: 'image/png', preview_url: `${origin}preview-only`, size: 8 },
      { file_asset_uid: 'audio-1', file_kind: 4, file_name: 'song.mp3', mime_type: 'audio/mpeg', download_url: `${origin}song`, size: 8 },
    ] }, 42)
    expect(blocks[0]!.originalRef).toBeDefined()
    expect(blocks[0]!.originalRef).not.toBe(blocks[0]!.mediaRef)
    expect(blocks[1]!.originalRef).toBeUndefined()
    expect(blocks[2]!.kind).toBe('audio')
    await expect(media.fetchMedia(blocks[0]!.mediaRef, undefined, undefined, true)).rejects.toMatchObject({ code: 'original-unavailable' })
    await media.fetchMedia(blocks[0]!.originalRef!, undefined, undefined, true)
    expect(fetchImpl).toHaveBeenCalledWith(new URL(`${origin}original`), expect.anything())
  })
  it('classifies real media formats independently from stale upstream file markers and browser support', () => {
    const sessions: ArkmeSessionStore = { async read() { return { userId: 42, accessToken: 'fixture', refreshToken: 'fixture' } }, async write() {}, async delete() {} }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, vi.fn())
    const media = new MediaService(runtime, new ProfileService(runtime), {} as never, { recordUid() { return '' } })
    const origin = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/'
    const items = [
      { file_name: 'photo.jpg', file_kind: 0 },
      { file_name: 'clip.mov', file_kind: 0 },
      { file_name: 'animated.webp', file_kind: 0 },
      { file_name: 'explicit-file.jpg', file_kind: 4 },
      { file_name: 'legacy-installer.dmg', file_kind: 1, mime_type: 'image/png' },
      { file_name: 'photo.heic', file_kind: 1, mime_type: 'image/heic' },
      { file_name: 'movie.mkv', file_kind: 3, mime_type: 'video/x-matroska' },
      { file_name: 'legacy-photo.jpg', file_kind: 3, mime_type: 'image/jpeg' },
      { file_name: 'unsafe.svg', file_kind: 0 },
      { file_name: 'unknown.bin', file_kind: 0 },
    ].map((item, index) => ({ file_asset_uid: `asset-${String(index)}`, mime_type: '', download_url: `${origin}${item.file_name}`, size: 8, ...item }))
    const blocks = media.richContentBlocks({ media_display_items: items }, 42)

    expect(blocks.map(block => [block.fileName, block.mimeType, block.kind])).toEqual([
      ['photo.jpg', 'image/jpeg', 'image'],
      ['clip.mov', 'video/quicktime', 'video'],
      ['animated.webp', 'image/webp', 'image'],
      ['explicit-file.jpg', 'image/jpeg', 'image'],
      ['legacy-installer.dmg', 'image/png', 'file'],
      ['photo.heic', 'image/heic', 'image'],
      ['movie.mkv', 'video/x-matroska', 'video'],
      ['legacy-photo.jpg', 'image/jpeg', 'image'],
      ['unsafe.svg', 'image/svg+xml', 'image'],
      ['unknown.bin', 'application/octet-stream', 'file'],
    ])
  })
  it('keeps forwarded media account-bound, rejects untrusted URLs, and preserves valid siblings', async () => {
    let userId = 42
    const sessions: ArkmeSessionStore = {
      async read() { return { userId, accessToken: 'fixture', refreshToken: 'fixture' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async () => new Response('audio', { status: 206 }))
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl as typeof fetch)
    const media = new MediaService(runtime, new ProfileService(runtime), {} as never, { recordUid() { return '' } })
    const url = 'https://jotmo-useraudio-test.oss-cn-hangzhou.aliyuncs.com/voice.wav?Signature=secret'
    const blocks = media.forwardContentBlocks([
      { type: 2, name: '语音', mime_type: 'audio/wav', download_url: url, file_asset_uid: 'internal-asset' },
      { type: 2, download_url: 'http://127.0.0.1/private' },
      { type: 2, download_url: 'https://evil.test/audio' },
      { type: 2, download_url: url.replace('https://', 'https://user:pass@') },
      { type: 2, download_url: url.replace('.com/', '.com:8443/') },
      { type: 2, download_url: url, content_file_role: 4 },
    ], 42)
    expect(blocks).toHaveLength(1)
    expect(JSON.stringify(blocks)).not.toMatch(/secret|internal-asset|https:/)
    await expect(media.fetchMedia(blocks[0]!.mediaRef, 'bytes=0-3')).resolves.toMatchObject({ response: { status: 206 } })
    expect(fetchImpl).toHaveBeenCalledWith(new URL(url), expect.objectContaining({ headers: { Range: 'bytes=0-3' }, redirect: 'error' }))
    userId = 99
    await expect(media.fetchMedia(blocks[0]!.mediaRef)).rejects.toMatchObject({ code: 'media-ref-invalid' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('projects only safe file asset URLs', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { items: [
      { file_asset_uid: 'video-1', status: 'ready', download_url: 'https://oss.example/video.mp4' },
      { file_asset_uid: 'cover-1', status: 'ready', preview_url: 'javascript:alert(1)' },
    ] } }), { status: 200 })) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const service = new MediaService(runtime, new ProfileService(runtime), {
      async openWorldImageRef() { throw new Error('unexpected world image') },
    }, { recordUid() { return '' } })

    await expect(service.queryFileAssets(['video-1', 'cover-1'])).resolves.toEqual([
      { fileAssetUid: 'video-1', status: 'ready', downloadUrl: 'https://oss.example/video.mp4' },
      { fileAssetUid: 'cover-1', status: 'ready' },
    ])
  })

  it('issues an opaque playable media ref for a search voice asset', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { items: [{
      record_uid: 'record-1',
      items: [{
        file_asset_uid: 'voice-1',
        download_url: 'https://jotmo-useraudio-test.oss-cn-hangzhou.aliyuncs.com/voice-1.m4a?x-oss-signature=test',
        mime_type: 'audio/mp4',
        file_name: 'voice-1.m4a',
        size: 128,
      }],
    }] } }), { status: 200 })) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const service = new MediaService(runtime, new ProfileService(runtime), {
      async openWorldImageRef() { throw new Error('unexpected world image') },
    }, { recordUid() { return '' } })

    const refs = await service.issueSearchAudioMediaRefs([
      { recordUid: 'record-1', fileAssetUid: 'voice-1' },
      { recordUid: 'record-1', fileAssetUid: 'missing' },
    ])

    expect(refs.get('record-1\0voice-1')).toMatch(/^arkme-media-v1\./)
    expect(refs.has('record-1\0missing')).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
