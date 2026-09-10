import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { AiVideoService } from '../../src/services/ai-video-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test',
  authBaseUrl: 'https://auth.test',
  subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test',
  chatBaseUrl: 'https://chat.test',
  botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test',
  webrtcBaseUrl: 'https://webrtc.test',
  worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test',
  intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api',
  audioBaseUrl: 'https://audio.test',
  requestTimeoutMs: 5_000,
  maxTextLength: 20_000,
  geetestCaptchaId: 'captcha-test-id-1234567890',
  interwovenMomentsEnabled: true,
}

const recordingUid = '64b64c2f9b8c1a2d3e4f5678'
const childUid = '64b64c2f9b8c1a2d3e4f5680'
const utterances = [{ startOffsetMillis: 100, endOffsetMillis: 200, text: '原句' }]

function detail() {
  const rows = [{ child_id: childUid, asr_item_index: 9, transcript_source: 'system', start_at: 1100, end_at: 1200,
    start_offset_millis: 0, end_offset_millis: 100, text: '原句' }]
  return { session: { session_id: recordingUid, start_at: 1000, source: 1 }, transcript_item_ls: rows,
    doubao_transcript_item_ls: [] as typeof rows }
}

function selectionService(data = detail()) {
  const sessions: ArkmeSessionStore = {
    async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
    async write() {}, async delete() {},
  }
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    if (String(input) === 'https://intelligent.test/api/v1/ai-comic-video/preflight') {
      expect(body.selection.segments).toEqual([{ child_id: childUid, asr_item_index: 9, transcript_source: 'system' }])
      return new Response(JSON.stringify({ code: 200, data: { allowed: false, message: 'test-only preflight' } }), { status: 200 })
    }
    expect(String(input)).toBe('https://audio.test/api/v1/audio/get-session-detail-by-id')
    expect(body).toEqual({ session_id: recordingUid })
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access')
    return new Response(JSON.stringify({ code: 200, data }), { status: 200 })
  })
  return { service: new AiVideoService(new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)), fetchImpl }
}

describe('AiVideoService', () => {
  it('uses the existing detail API and sends unchanged selectors to the video owner', async () => {
    const { service, fetchImpl } = selectionService()
    const expected = [{ childId: childUid, asrItemIndex: 9, transcriptSource: 'system' as const }]
    for (let i = 0; i < 2; i++) await expect(service.aiVideoResolveSelection(recordingUid, utterances)).resolves.toEqual(expected)
    expect(fetchImpl).toHaveBeenCalledTimes(2) // no stale selection cache
    await service.aiVideoPreflight(recordingUid, expected)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('preserves the caller order and owner indexes rather than display indexes', async () => {
    const data = detail()
    data.transcript_item_ls.push({ ...data.transcript_item_ls[0]!, asr_item_index: 2, start_at: 1300, end_at: 1500, text: '另一句' })
    const { service } = selectionService(data)
    await expect(service.aiVideoResolveSelection(recordingUid, [
      { startOffsetMillis: 300, endOffsetMillis: 500, text: '另一句' }, ...utterances,
    ])).resolves.toEqual([
      { childId: childUid, asrItemIndex: 2, transcriptSource: 'system' },
      { childId: childUid, asrItemIndex: 9, transcriptSource: 'system' },
    ])
  })

  it('selects the enhanced fact only when its full text and times match', async () => {
    const data = detail()
    data.doubao_transcript_item_ls = [{ ...data.transcript_item_ls[0]!, asr_item_index: 3, transcript_source: 'doubao' }]
    const { service } = selectionService(data)
    await expect(service.aiVideoResolveSelection(recordingUid, utterances)).resolves.toEqual([
      { childId: childUid, asrItemIndex: 3, transcriptSource: 'doubao' },
    ])
    data.doubao_transcript_item_ls[0]!.text = '不同的增强文本'
    await expect(service.aiVideoResolveSelection(recordingUid, utterances)).resolves.toEqual([
      { childId: childUid, asrItemIndex: 9, transcriptSource: 'system' },
    ])
  })

  it.each([
    ['another recording', (data: ReturnType<typeof detail>) => { data.session.session_id = childUid }],
    ['unsupported source', (data: ReturnType<typeof detail>) => { data.session.source = 3 }],
    ['wrong start time', (data: ReturnType<typeof detail>) => { data.session.start_at += 1 }],
    ['rewritten text', (data: ReturnType<typeof detail>) => { data.transcript_item_ls[0]!.text = '改写原句' }],
    ['changed end time', (data: ReturnType<typeof detail>) => { data.transcript_item_ls[0]!.end_at += 1 }],
    ['missing text', (data: ReturnType<typeof detail>) => { data.transcript_item_ls = [] }],
    ['invalid locator', (data: ReturnType<typeof detail>) => { data.transcript_item_ls[0]!.child_id = 'bad' }],
    ['invalid index', (data: ReturnType<typeof detail>) => { data.transcript_item_ls[0]!.asr_item_index = -1 }],
    ['fractional index', (data: ReturnType<typeof detail>) => { data.transcript_item_ls[0]!.asr_item_index = 1.5 }],
    ['unknown source', (data: ReturnType<typeof detail>) => { data.transcript_item_ls[0]!.transcript_source = 'unknown' }],
    ['repeated source rows', (data: ReturnType<typeof detail>) => { data.transcript_item_ls.push({ ...data.transcript_item_ls[0]! }) }],
    ['ambiguous children', (data: ReturnType<typeof detail>) => { data.transcript_item_ls.push({ ...data.transcript_item_ls[0]!, child_id: '64b64c2f9b8c1a2d3e4f5681' }) }],
  ])('rejects %s without calling the video owner', async (_name, mutate) => {
    const data = detail()
    mutate(data)
    const { service, fetchImpl } = selectionService(data)
    await expect(service.aiVideoResolveSelection(recordingUid, utterances)).rejects.toMatchObject({ code: 'recording-selection-invalid' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not match a substring or a fragment as a complete utterance', async () => {
    const { service } = selectionService()
    await expect(service.aiVideoResolveSelection(recordingUid, [{ ...utterances[0]!, text: '原' }])).rejects.toThrow()
  })
  it('projects a completed video job through the intelligent owner', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {},
      async delete() {},
    }
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('https://intelligent.test/api/v1/ai-comic-video/jobs/status')
      return new Response(JSON.stringify({ code: 200, data: {
        job_id: 'job-1', status: 'succeeded', stage: 'succeeded', progress: 100,
        selection: { segments: [{}] }, video_asset_uid: 'video-1',
      } }), { status: 200 })
    }) as typeof fetch
    const service = new AiVideoService(new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl))

    await expect(service.aiVideoStatus('job-1')).resolves.toMatchObject({
      jobId: 'job-1', status: 'succeeded', progress: 100,
      selectedSegmentCount: 1, videoAssetUid: 'video-1',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
