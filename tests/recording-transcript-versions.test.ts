import { describe, expect, it, vi } from 'vitest'
import { RecordingService, type RecordingServiceDependencies } from '../src/services/recording-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../src/services/service.js'
import { recordingOwnerResponse, recordingId, childId } from './fixtures/recording-owner.js'
import { recordingZonedWindow } from '../src/recording-time.js'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { recordingTranscriptVersionsTool } from '../src/tools/business/recordings/transcript-versions.js'
import type { ArkmeService } from '../src/arkme-service.js'
import type { RetainedTranscriptItem } from '../src/services/recording-transcript-versions.js'

const date = new Date(2026, 10, 18).getTime()
const window = recordingZonedWindow('2026-11-18', 'Asia/Shanghai')
const startAt = window.dateStamp + 3000
const lostId = '134567890123456789012345'
const sourceChild = '123456789012345678901237'
const snapshotId = 'snapshot:owner:0820'
const privateViewVersion = 'd'.repeat(64)
const historicalId = 'snapshot:owner:0715'
const queryPath = '/api/v1/audio/transcript-versions/query'
const listPath = '/api/v1/audio/transcript-versions/list'

function row(id: string, text: string, extra: Partial<RetainedTranscriptItem> = {}): RetainedTranscriptItem {
  const value: RetainedTranscriptItem = {
    id, text, session_id: lostId, child_id: sourceChild, asr_item_index: 4, transcript_source: 'primary',
    start_at: startAt, end_at: startAt + 1000, speaker: { number: 1, name: '留存说话人' }, playable: false, active_ranges_complete: true, ...extra,
  }
  return { ...value, active_ranges: [{ start_at: value.start_at, end_at: value.end_at }] }
}
function setup() {
  let viewer = 42
  let renamed = '最新说话人'
  let nextSnapshotId = snapshotId
  let nextHistoryId = historicalId
  let routeFailure: ArkmePluginError | undefined
  let matches = true
  const live = row('live-retained-id', '新转写', { session_id: recordingId, child_id: childId, asr_item_index: 7, playable: true })
  const missing = row('deleted-retained-id', '音频删除后保留', { start_at: startAt + 2000, end_at: startAt + 3000 })
  const historical = row('old-retained-id', '覆盖前转写')
  const issueRecordingPlaybackMediaRef = vi.fn(async () => 'opaque-media-ref')
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => {
    if (path === listPath) return { versions: [{ id: historicalId, created_at: startAt + 6000 }], next_cursor: '' }
    if (path === queryPath) {
      if (routeFailure) throw routeFailure
      if (body.version_id) return { snapshot_id: nextHistoryId, items: [historical], next_cursor: '' }
      return body.cursor ? { snapshot_id: nextSnapshotId, items: [missing], next_cursor: '' }
        : { snapshot_id: snapshotId, items: [live], next_cursor: 'private-owner-next' }
    }
    if (path === '/api/v1/summary/create') return { flag: 1, summary_id: 'created' }
    if (path === '/api/v1/summary/list-timeline-by-range') return { audio_summary_ls: [] }
    const owner = recordingOwnerResponse(path, body, [{
      startAt, duration: 30_000,
      items: [{ text: matches ? live.text : '已覆盖旧转写不应重新出现', start: 0, end: 1000, ordinal: 7, privateViewVersion, speaker: { label: renamed } }],
    }])
    if (owner) return owner
    throw new Error(`unexpected test route ${path}`)
  })
  const service = new RecordingService({
    subscribeAccountScope: () => () => {}, config: { environment: 'test', maxTextLength: 20_000 },
    requireSession: async () => ({ userId: viewer, accessToken: 'secret-access', refreshToken: 'secret-refresh' }),
    authenticatedAudioPost: post, stateStore: { uniqueCode: async () => 'ref-test-key' },
  } as unknown as ServiceRuntime, { media: { issueRecordingPlaybackMediaRef } } as RecordingServiceDependencies)
  return { service, post, live, historical, issueRecordingPlaybackMediaRef, changeAccount: () => { viewer = 43 },
    changeSnapshot: () => { nextSnapshotId = 'snapshot:unexpected' }, changeHistory: () => { nextHistoryId = snapshotId }, rename: () => { renamed = '更正后的说话人' },
    fail: (error: ArkmePluginError) => { routeFailure = error }, replaceLive: () => { matches = false } }
}

describe('retained transcript Host projection', () => {
  it('uses a civil window, pins pagination, preserves deleted text and live editing, and seals all owner ids', async () => {
    const fixture = setup()
    const a = await fixture.service.recordingTranscriptPage(date, { window })
    expect(a.items[0]).toMatchObject({ text: '新转写', speakerLabel: '最新说话人', privateViewVersion, itemRef: expect.stringMatching(/^arkme-recording-item-v1\./), playable: true })
    const b = await fixture.service.recordingTranscriptPage(date, { window, cursor: a.nextCursor })
    expect(b.viewRef).toBe(a.viewRef)
    expect(b.items[0]).toMatchObject({ text: '音频删除后保留', itemRef: '', playable: false })
    expect(b.items[0]?.retainedPlaybackRef).toBeUndefined()
    expect(JSON.stringify([a, b])).not.toMatch(/private-owner-next|snapshot:owner|123456789012345678901237|secret-access|secret-refresh/)
    expect(fixture.post.mock.calls.filter(([path]) => path === queryPath).map(([, body]) => body)).toEqual([
      { start_at: window.dateStamp, end_at: window.endStamp, tz_offset: 28_800_000, transcript_source: 'primary', limit: 100 },
      { start_at: window.dateStamp, end_at: window.endStamp, tz_offset: 28_800_000, transcript_source: 'primary', limit: 100, cursor: 'private-owner-next' },
    ])
    fixture.rename()
    const renamed = await fixture.service.recordingTranscriptPage(date, { window })
    expect(renamed.items[0]?.speakerLabel).toBe('更正后的说话人')
    expect(renamed.viewRef).toBe(a.viewRef)
    expect(renamed.presentationRef).not.toBe(a.presentationRef)
    fixture.changeSnapshot()
    await expect(fixture.service.recordingTranscriptPage(date, { window, cursor: a.nextCursor })).rejects.toMatchObject({ code: 'recording-view-changed' })
    fixture.changeAccount()
    await expect(fixture.service.recordingTranscriptPage(date, { window, cursor: a.nextCursor })).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('only accepts issued version references for their original account and day and returns read-only historical rows', async () => {
    const { service, post, changeHistory } = setup()
    const versions = await service.recordingTranscriptVersions(date, { window })
    expect(versions.supported).toBe(true)
    expect(post.mock.calls[0]?.[1]).toMatchObject({ start_at: window.dateStamp, end_at: window.endStamp, tz_offset: 28_800_000, transcript_source: 'primary' })
    const versionRef = versions.versions[0]!.versionRef
    expect(versionRef).not.toContain(historicalId)
    const history = await service.recordingTranscriptPage(date, { window, versionRef })
    expect(history.items[0]).toMatchObject({ text: '覆盖前转写', itemRef: '', canBindSpeaker: false, playable: false })
    expect(history.versionRef).toBe(versionRef)
    expect(history.items[0]?.privateViewVersion).toBeUndefined()
    expect(post.mock.calls.map(([path]) => path)).toEqual([listPath, queryPath])
    changeHistory()
    await expect(service.recordingTranscriptPage(date, { window, versionRef })).rejects.toMatchObject({ code: 'recording-view-changed' })
    await expect(service.recordingTranscriptPage(date, { versionRef, window: recordingZonedWindow('2026-11-19', 'Asia/Shanghai') })).rejects.toMatchObject({ code: 'recording-cursor-invalid' })
  })

  it('represents a partially overwritten body once and disables whole-clip playback and editing', async () => {
    const fixture = setup()
    fixture.live.active_ranges = [
      { start_at: startAt, end_at: startAt + 250 },
      { start_at: startAt + 750, end_at: startAt + 1000 },
    ]
    const current = await fixture.service.recordingTranscriptPage(date, { window })
    expect(current.items).toHaveLength(1)
    expect(current.items[0]).toMatchObject({
      text: fixture.live.text, playable: false, itemRef: '', canBindSpeaker: false,
      activeRanges: [
        { startAtMillis: startAt, endAtMillis: startAt + 250 },
        { startAtMillis: startAt + 750, endAtMillis: startAt + 1000 },
      ],
    })
    expect(current.items[0]?.retainedPlaybackRef).toBeUndefined()
    expect(fixture.post.mock.calls.map(([path]) => path)).toEqual([queryPath])
    fixture.live.active_ranges_complete = false
    expect((await fixture.service.recordingTranscriptPage(date, { window })).items[0]).toMatchObject({ activeRangesComplete: false, playable: false })
    fixture.live.active_ranges[1]!.start_at = startAt + 100
    await expect(fixture.service.recordingTranscriptPage(date, { window })).rejects.toMatchObject({ code: 'recording-transcript-history-invalid' })
  })

  it('checks a long historical clip through all owner text pages before issuing playback', async () => {
    const fixture = setup()
    const text = '长句🙂'.repeat(9_000)
    fixture.live.text = text
    Object.assign(fixture.historical, { ...fixture.live, id: fixture.historical.id })
    const versionRef = (await fixture.service.recordingTranscriptVersions(date, { window })).versions[0]!.versionRef
    const history = await fixture.service.recordingTranscriptPage(date, { window, versionRef })
    const ref = history.items[0]!.retainedPlaybackRef!
    expect(ref).toMatch(/^arkme-recording-retained-playback-v1\./)
    await expect(fixture.service.recordingPlayback(ref)).resolves.toMatchObject({ playbackRef: 'opaque-media-ref', endOffsetMillis: 1000 })
    expect(fixture.post.mock.calls.some(([path, body]) => path.endsWith('/recordings/transcript/query') && typeof body.page_cursor === 'string')).toBe(true)
    fixture.replaceLive()
    await expect(fixture.service.recordingPlayback(ref)).rejects.toMatchObject({ code: 'recording-playback-unavailable' })
    expect(fixture.issueRecordingPlaybackMediaRef).toHaveBeenCalledOnce()
  })

  it('does not return overwritten legacy rows and generates both projections from all current retained pages', async () => {
    const fixture = setup()
    fixture.replaceLive()
    for (const kind of ['summary', 'timeline'] as const) {
      await fixture.service.generateRecordingProjection(date, kind, '', undefined, window)
    }
    const generated = fixture.post.mock.calls.filter(([path]) => path === '/api/v1/summary/create').map(([, body]) => String(body.transcripts))
    expect(generated).toHaveLength(2)
    for (const text of generated) {
      expect(text).toContain('新转写')
      expect(text).toContain('音频删除后保留')
      expect(text).toContain('无法验证是否为我本人发言')
      expect(text).not.toContain('其中，没有发现我自己说的话')
      expect(text).not.toMatch(/已覆盖旧转写|覆盖前转写/)
    }
  })

  it('falls back only for a missing endpoint and surfaces errors from an available owner', async () => {
    const fixture = setup()
    fixture.fail(new ArkmePluginError('arkme-http-error', 'missing route', false, 502, { upstreamStatus: 404 }))
    expect((await fixture.service.recordingTranscriptPage(date, { window })).retainedSnapshot).toBeUndefined()
    for (const error of [
      new ArkmePluginError('arkme-code-404', 'account source missing', false, 404, { upstreamStatus: 404 }),
      new ArkmePluginError('auth-http-403', 'permission', false, 403),
      new ArkmePluginError('arkme-network-error', 'network', true, 502),
    ]) {
      fixture.fail(error)
      await expect(fixture.service.recordingTranscriptPage(date, { window })).rejects.toBe(error)
    }
  })
})

it('routes public SDK and the read-only DSH tool to the same Host owner', async () => {
  const { service } = setup()
  const capabilities = { contractVersion: 1, features: { recordingTranscriptPages: true, recordingTranscriptVersions: true } }
  const host = {
    providerCapabilities: () => capabilities,
    recordingTranscriptVersions: service.recordingTranscriptVersions.bind(service),
    recordingTranscriptPage: service.recordingTranscriptPage.bind(service),
  }
  const sdk = createArkmeSdk({
    fetchImpl: async (_url, init) => {
      const { operation, params } = JSON.parse(String(init?.body))
      return Response.json({ ok: true, value: await dispatchArkmeHostOperation(host as unknown as ArkmeService, operation, params, undefined,
        undefined, undefined, undefined, init?.signal ?? undefined) })
    },
  })
  const versions = await sdk.recordingTranscriptVersions(date)
  const versionRef = versions.versions[0]!.versionRef
  const fromSDK = await sdk.recordingTranscriptPage(date, { versionRef })
  const tool = recordingTranscriptVersionsTool.create({} as never, host as never)
  const result = await tool.execute({ action: 'read', date_stamp: date, version_ref: versionRef } as never, {} as never)
  expect(fromSDK.items[0]?.text).toBe('覆盖前转写')
  expect(JSON.stringify(result)).toContain('覆盖前转写')
  expect(JSON.stringify(result)).not.toMatch(/snapshot:owner|123456789012345678901237|secret-access/)
  expect(recordingTranscriptVersionsTool.meta.effect).toBe('read')
  await expect(tool.execute({ action: 'restore', date_stamp: date } as never, {} as never)).rejects.toThrow()
})
