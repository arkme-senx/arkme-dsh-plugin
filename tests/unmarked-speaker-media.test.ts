import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createArkmeMediaHandler } from '../src/rich-media-routes.js'
import { MediaService } from '../src/services/media-service.js'
import { UnmarkedSpeakerService } from '../src/services/unmarked-speaker-service.js'
import type { ArkmeUnmarkedSpeakerSegment } from '../src/types.js'

const ossMock = vi.hoisted(() => ({
  calls: [] as Array<{
    config: Record<string, unknown>
    objectPath: string
    options: Record<string, unknown>
  }>,
  hostname: '',
  pathname: '',
}))

vi.mock('ali-oss', () => ({
  default: class FakeOss {
    constructor(private readonly config: Record<string, unknown>) {}

    signatureUrl(objectPath: string, options: Record<string, unknown>): string {
      ossMock.calls.push({ config: this.config, objectPath, options })
      const bucket = String(this.config.bucket)
      const hostname = ossMock.hostname || `${bucket}.oss-cn-hangzhou.aliyuncs.com`
      const pathname = ossMock.pathname || `/${objectPath.split('/').map(encodeURIComponent).join('/')}`
      return `https://${hostname}${pathname}?OSSAccessKeyId=private-key&Expires=120&Signature=private-signature`
    }
  },
}))

const baseSession = { userId: 734_921, accessToken: 'access-private', refreshToken: 'refresh-private' }
const expiresInFuture = '2099-01-01T00:00:00.000Z'

const candidate = (candidateId = 'candidate-private-1') => ({
  candidate_id: candidateId,
  status: 'cross_day',
  label: 'X6',
  speaker_display_number: 6,
  day_count: 3,
  total_speech_duration_ms: 66_000,
  segment_count: 1,
  first_seen_at: new Date(2026, 7, 20, 9, 0).getTime(),
  latest_day_end_at: new Date(2026, 7, 22, 10, 30).getTime(),
})

const segmentResponse = {
  candidate: candidate(),
  candidate_version: 'candidate-version-private-1',
  sessions: [{ session_id: 'session-private-1', title: '周会' }],
  segments: [{
    segment_id: 'segment-private-1',
    session_id: 'session-private-1',
    child_id: 'child-private-1',
    occurred_at: new Date(2025, 7, 23, 10, 0).getTime(),
    date_key: '2025-08-23',
    start_ms: 1_000,
    end_ms: 3_500,
    audio_file_name: 'private.opus',
    transcript: '需要保留的转写',
  }],
  next_cursor: '',
  has_more: false,
  total_count: 1,
}

function fixture(options: { connectMedia?: boolean; environment?: 'test' | 'prod' } = {}) {
  let currentSession = baseSession
  const remoteRequests: Array<{ url: string; range: string }> = []
  const runtime = {
    config: { environment: options.environment ?? 'test', requestTimeoutMs: 5_000 },
    requireSession: vi.fn(async () => currentSession),
    requestScope: vi.fn((userId: number) => `user:${String(userId)}`),
    invalidateKey: vi.fn(),
    authenticatedAudioPost: vi.fn(async (path: string) => {
      if (path === '/api/v1/audio/unmarked-speakers/list') {
        return {
          items: [candidate()], cross_day_count: 1, single_day_count: 0,
          next_cursor: '', has_more: false, projection_state: 'fresh',
        }
      }
      if (path === '/api/v1/audio/unmarked-speakers/segments') return segmentResponse
      if (path === '/api/v1/audio/get-sts-token') {
        return {
          access_key_id: 'private-access-key',
          access_key_secret: 'private-access-secret',
          security_token: 'private-security-token',
          expiration: expiresInFuture,
        }
      }
      throw new Error(`unexpected audio path: ${path}`)
    }),
    fetchImpl: vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      remoteRequests.push({ url: String(input), range: headers.get('range') ?? '' })
      return new Response('opus', {
        status: 206,
        headers: {
          'content-type': 'audio/ogg',
          'content-length': '4',
          'content-range': 'bytes 0-3/100',
          'accept-ranges': 'bytes',
        },
      })
    }),
  }
  const media = new MediaService(runtime as never, {} as never, {} as never, {} as never)
  const speakers = new UnmarkedSpeakerService(
    runtime as never,
    options.connectMedia === false ? undefined : media,
  )
  return {
    media,
    remoteRequests,
    runtime,
    speakers,
    setSession(session: typeof baseSession) { currentSession = session },
  }
}

async function refs(speakers: UnmarkedSpeakerService): Promise<{
  candidateRef: string
  segmentRef: string
  mediaRef?: string
  segment: ArkmeUnmarkedSpeakerSegment
}> {
  const listed = await speakers.list()
  const item = listed.items[0]
  if (item?.kind !== 'unmarked-speaker') throw new Error('missing candidate fixture')
  const page = await speakers.segments(item.candidateRef)
  const segment = page.items[0]
  if (segment === undefined) throw new Error('missing segment fixture')
  return { candidateRef: item.candidateRef, segmentRef: segment.segmentRef, mediaRef: segment.mediaRef, segment }
}

function projectedKeysAndValues(value: unknown): { keys: string[]; values: unknown[] } {
  const keys: string[] = []
  const values: unknown[] = []
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) { current.forEach(visit); return }
    if (current !== null && typeof current === 'object') {
      for (const [key, child] of Object.entries(current)) {
        keys.push(key)
        visit(child)
      }
      return
    }
    values.push(current)
  }
  visit(value)
  return { keys, values }
}

afterEach(() => {
  vi.useRealTimers()
  ossMock.calls.length = 0
  ossMock.hostname = ''
  ossMock.pathname = ''
})

describe('controlled unmarked-speaker media', () => {
  it.each([
    ['test', 'jotmo-useraudio-test'],
    ['prod', 'jotmo-useraudio'],
  ] as const)('returns only an opaque media ref after signing the validated %s tuple', async (environment, bucket) => {
    const { speakers, runtime } = fixture({ environment })

    const result = await refs(speakers)
    const objectPath = 'f1fc8fb6873205324471c199ccc758ba/734921/audio_output/session-private-1/child-private-1/private.opus'
    const signedUrl = `https://${bucket}.oss-cn-hangzhou.aliyuncs.com/${objectPath}?OSSAccessKeyId=private-key&Expires=120&Signature=private-signature`

    expect(result.segment).toEqual({
      segmentRef: expect.stringMatching(/^arkme-unmarked-segment-v1\./),
      date: '2025-08-23',
      sessionLabel: '周会',
      timeRange: '10:00:00–10:00:02',
      durationMillis: 2_500,
      transcript: '需要保留的转写',
      mediaRef: expect.stringMatching(/^arkme-media-v1\./),
    })
    expect(ossMock.calls).toEqual([{
      config: expect.objectContaining({ bucket, secure: true }),
      objectPath,
      options: { method: 'GET', expires: 120 },
    }])
    expect(runtime.authenticatedAudioPost).toHaveBeenCalledWith(
      '/api/v1/audio/get-sts-token', {}, baseSession, undefined,
      expect.objectContaining({ lane: 'interactive-read' }),
    )
    const projected = projectedKeysAndValues(result.segment)
    const forbiddenKeys = [
      'user_id', 'userId', 'candidate_id', 'candidateId', 'segment_id', 'segmentId',
      'session_id', 'sessionId', 'child_id', 'childId', 'audio_file_name', 'audioFileName',
      'object_key', 'objectKey', 'access_key_id', 'accessKeyId', 'access_key_secret',
      'accessKeySecret', 'security_token', 'securityToken', 'stsToken', 'signed_url',
      'signedUrl', 'remote_url', 'remoteUrl', 'expiration',
    ]
    for (const forbiddenKey of forbiddenKeys) {
      expect(projected.keys, `projected segment exposed forbidden key ${forbiddenKey}`).not.toContain(forbiddenKey)
    }
    const forbiddenRawValues = [
      734_921,
      'candidate-private-1',
      'segment-private-1',
      'session-private-1',
      'child-private-1',
      'private.opus',
      objectPath,
      'private-access-key',
      'private-access-secret',
      'private-security-token',
      expiresInFuture,
      signedUrl,
    ]
    const projectedStrings = projected.values.filter((value): value is string => typeof value === 'string')
    for (const forbiddenValue of forbiddenRawValues) {
      expect(projected.values, `projected segment exposed forbidden raw value ${String(forbiddenValue)}`)
        .not.toContain(forbiddenValue)
      for (const projectedString of projectedStrings) {
        expect(projectedString, `projected string contained forbidden raw value ${String(forbiddenValue)}`)
          .not.toContain(String(forbiddenValue))
      }
    }
  })

  it('rejects forged, unknown, cross-account, and expired segment refs before requesting STS', async () => {
    vi.useFakeTimers()
    const { media, runtime, speakers, setSession } = fixture({ connectMedia: false })
    const { candidateRef, segmentRef } = await refs(speakers)
    const stsCalls = () => runtime.authenticatedAudioPost.mock.calls
      .filter(call => call[0] === '/api/v1/audio/get-sts-token').length

    await expect(media.issueUnmarkedSpeakerMediaRef(speakers, candidateRef, 'forged'))
      .rejects.toMatchObject({ code: 'unmarked-segment-ref-invalid' })
    await expect(media.issueUnmarkedSpeakerMediaRef(
      speakers, candidateRef, 'arkme-unmarked-segment-v1.00000000-0000-4000-8000-000000000000',
    )).rejects.toMatchObject({ code: 'unmarked-segment-ref-expired' })
    await expect(media.issueUnmarkedSpeakerMediaRef(
      speakers, 'arkme-unmarked-candidate-v1.00000000-0000-4000-8000-000000000000', segmentRef,
    )).rejects.toMatchObject({ code: 'unmarked-segment-ref-candidate-mismatch' })
    expect(stsCalls()).toBe(0)

    setSession({ ...baseSession, userId: 8 })
    await expect(media.issueUnmarkedSpeakerMediaRef(speakers, candidateRef, segmentRef))
      .rejects.toMatchObject({ code: 'unmarked-segment-ref-account-mismatch' })
    expect(stsCalls()).toBe(0)

    setSession(baseSession)
    vi.advanceTimersByTime(30 * 60_000 + 1)
    await expect(media.issueUnmarkedSpeakerMediaRef(speakers, candidateRef, segmentRef))
      .rejects.toMatchObject({ code: 'unmarked-segment-ref-expired' })
    expect(stsCalls()).toBe(0)
  })

  it.each([
    ['an untrusted host', { hostname: 'attacker.example', pathname: '' }],
    ['a mismatched object path', { hostname: '', pathname: '/other/private.opus' }],
  ])('rejects %s before any media fetch', async (_label, signedTarget) => {
    const { media, remoteRequests, speakers } = fixture({ connectMedia: false })
    const { candidateRef, segmentRef } = await refs(speakers)
    ossMock.hostname = signedTarget.hostname
    ossMock.pathname = signedTarget.pathname

    await expect(media.issueUnmarkedSpeakerMediaRef(speakers, candidateRef, segmentRef))
      .rejects.toMatchObject({ code: 'unmarked-audio-sign-target-rejected' })
    expect(remoteRequests).toEqual([])
  })

  it('keeps media refs account-bound and short-lived before proxy fetch', async () => {
    vi.useFakeTimers()
    const { media, remoteRequests, speakers, setSession } = fixture()
    const { mediaRef = '' } = await refs(speakers)

    await expect(media.fetchMedia('arkme-media-v1.00000000-0000-4000-8000-000000000000'))
      .rejects.toMatchObject({ code: 'media-ref-invalid' })
    setSession({ ...baseSession, userId: 8 })
    await expect(media.fetchMedia(mediaRef)).rejects.toMatchObject({ code: 'media-ref-invalid' })
    setSession(baseSession)
    expect(remoteRequests).toEqual([])

    vi.advanceTimersByTime(2 * 60_000 + 1)
    await expect(media.fetchMedia(mediaRef)).rejects.toMatchObject({ code: 'media-ref-invalid' })
    expect(remoteRequests).toEqual([])
  })

  it('forwards Range through the existing media route and propagates 206 audio headers', async () => {
    const { media, remoteRequests, speakers } = fixture()
    const { mediaRef = '' } = await refs(speakers)
    const server = createServer(createArkmeMediaHandler({
      fetchMedia: async (ref: string, range?: string) => await media.fetchMedia(ref, range),
    } as never, {
      expectedPort: 0,
      allowNonLoopback: false,
      temporaryDirectory: '/tmp/unused-arkme-media-test',
      maxUploadBytes: 1,
    }))
    await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
    try {
      const port = (server.address() as AddressInfo).port
      const response = await fetch(`http://127.0.0.1:${String(port)}/media?ref=${encodeURIComponent(mediaRef)}`, {
        headers: { Range: 'bytes=0-3' },
      })

      expect(response.status).toBe(206)
      expect(response.headers.get('content-type')).toBe('audio/ogg')
      expect(response.headers.get('content-range')).toBe('bytes 0-3/100')
      expect(response.headers.get('accept-ranges')).toBe('bytes')
      expect(response.headers.get('content-disposition')).not.toContain('private.opus')
      await expect(response.text()).resolves.toBe('opus')
      expect(remoteRequests).toHaveLength(1)
      expect(remoteRequests[0]?.range).toBe('bytes=0-3')
      expect(remoteRequests[0]?.url).toContain('jotmo-useraudio-test.oss-cn-hangzhou.aliyuncs.com')
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
    }
  })
})
