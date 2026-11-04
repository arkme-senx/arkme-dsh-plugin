import { it, expect, vi } from 'vitest'
import { MediaService } from '../src/services/media-service.js'

it('opens only the exact World sound proxy and preserves range, MIME and account isolation', async () => {
  let userId = 7
  const fetchImpl = vi.fn(async () => new Response('exact clip', { status: 206, headers: { 'content-type': 'audio/mp4', 'cache-control': 'private, no-store' } }))
  const runtime = { config: { environment: 'prod', worldBaseUrl: 'https://world.jotmo.cc' }, requireSession: async () => ({ userId }), fetchImpl }
  const media = new MediaService(runtime as never, {} as never, {} as never, {} as never)
  const uid = `world-sound-${'a'.repeat(64)}`
  const url = `https://world.jotmo.cc/api/public/v1/public-record/media?record_uid=${uid}&version=${'b'.repeat(64)}&kind=sound&index=0`
  const ref = media.issueWorldSoundMediaRef(7, url, { recordUID: uid, index: 0 })
  const controller = new AbortController()
  const result = await media.fetchMedia(ref, 'bytes=0-9', controller.signal)
  expect(result.response.status).toBe(206)
  expect(result.response.headers.get('content-type')).toBe('audio/mp4')
  expect(fetchImpl).toHaveBeenCalledWith(new URL(url), { headers: { Range: 'bytes=0-9' }, redirect: 'error', signal: controller.signal })
  for (const bad of [url.replace('world.jotmo.cc', 'evil.test'), url.replace('kind=sound', 'kind=voice'), `${url}&index=1`, url.replace('index=0', 'index=150'), url.replace('https:', 'http:')]) {
    expect(() => media.issueWorldSoundMediaRef(7, bad, { recordUID: uid, index: 0 })).toThrow()
  }
  expect(() => media.issueWorldSoundMediaRef(7, url, { recordUID: uid, index: 1 })).toThrow()
  expect(() => media.issueWorldSoundMediaRef(7, url, { recordUID: `${uid}0`, index: 0 })).toThrow()
  userId = 8
  await expect(media.fetchMedia(ref)).rejects.toMatchObject({ code: 'media-ref-invalid' })
  expect(fetchImpl).toHaveBeenCalledOnce()
  media.dispose()
})
