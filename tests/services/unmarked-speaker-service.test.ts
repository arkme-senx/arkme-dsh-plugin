import { afterEach, describe, expect, it, vi } from 'vitest'

import { UnmarkedSpeakerService } from '../../src/services/unmarked-speaker-service.js'

const session = { userId: 7, accessToken: 'access', refreshToken: 'refresh' }

const candidate = (overrides: Record<string, unknown> = {}) => ({
  candidate_id: 'candidate-private-1',
  status: 'cross_day',
  identity_source: 'readonly_cluster',
  label: 'X6',
  speaker_display_number: 6,
  day_count: 3,
  total_speech_duration_ms: 66_000,
  first_seen_at: new Date(2026, 7, 20, 9, 0).getTime(),
  last_seen_at: new Date(2026, 7, 22, 10, 30).getTime(),
  latest_day_start_at: new Date(2026, 7, 22, 10, 0).getTime(),
  latest_day_end_at: new Date(2026, 7, 22, 10, 30).getTime(),
  date_list: [],
  segment_count: 4,
  session_num_ref_count: 2,
  member_day_speaker_ids: ['day-private-1'],
  ...overrides,
})

function listResponse(overrides: Record<string, unknown> = {}) {
  return {
    items: [candidate()],
    cross_day_count: 1,
    single_day_count: 0,
    pending_identity_aggregation_count: 0,
    insufficient_evidence_count: 0,
    processing_session_count: 0,
    scan_truncated: false,
    next_cursor: '',
    has_more: false,
    returned_count: 1,
    cluster_version: 'cluster-private-v1',
    projection_state: 'fresh',
    published_version: 'published-private-v1',
    projection_updated_at: Date.now(),
    retry_after_ms: 0,
    cursor_stale: false,
    ...overrides,
  }
}

function optionsResponse(overrides: Record<string, unknown> = {}) {
  return {
    candidate_id: 'candidate-private-1',
    candidate_version: 'candidate-version-1',
    label: 'X6',
    conversation_title: 'private title',
    conversation_summary: 'private summary',
    speaker_inference: '可能是林林',
    conversation_summary_status: 'ready',
    speaker_inference_status: 'ready',
    speaker_inference_can_retry: false,
    day_count: 3,
    segment_count: 4,
    session_num_count: 2,
    recommendation_state: 'recommended',
    recommended_speaker_id: 'speaker-private-1',
    recommendations: [],
    speakers: [
      { speaker_id: 'speaker-private-1', nick_name: '林林', is_recommended: true, match_distance: 0.1 },
      { speaker_id: 'speaker-private-2', nick_name: '阿周', is_recommended: false },
    ],
    ...overrides,
  }
}

function segmentResponse(overrides: Record<string, unknown> = {}) {
  return {
    candidate: candidate(),
    candidate_version: 'candidate-version-1',
    date_summaries: [{ date_stamp: 1_755_820_800_000, date_key: '2025-08-23', segment_count: 1 }],
    sessions: [{ session_id: 'session-private-1', title: '周会', start_at: 1_755_820_800_000, date_stamp: 1_755_820_800_000 }],
    segments: [{
      segment_id: 'segment-private-1',
      session_id: 'session-private-1',
      child_id: 'child-private-1',
      occurred_at: new Date(2025, 7, 23, 10, 0, 0).getTime(),
      date_key: '2025-08-23',
      start_ms: 1_000,
      end_ms: 3_500,
      speaker_num: 1,
      audio_file_name: 'private.opus',
      transcript: '需要保留的转写',
      context_before: 'private before',
      context_after: 'private after',
    }],
    next_cursor: '',
    has_more: false,
    returned_count: 1,
    total_count: 1,
    ...overrides,
  }
}

function fixture(responses: Record<string, unknown> = {}) {
  let currentSession = session
  const runtime = {
    requireSession: vi.fn(async () => currentSession),
    requestScope: vi.fn((userId: number) => `user:${String(userId)}`),
    invalidateKey: vi.fn(),
    authenticatedAudioPost: vi.fn(async (path: string) => {
      if (path in responses) {
        const value = responses[path]
        return typeof value === 'function' ? await (value as () => unknown)() : value
      }
      if (path === '/api/v1/audio/unmarked-speakers/list') return listResponse()
      if (path === '/api/v1/audio/unmarked-speakers/mark-options') return optionsResponse()
      if (path === '/api/v1/audio/unmarked-speakers/speaker-inference/retry') {
        return { outcome: 'retried', speaker_inference_status: 'pending', speaker_inference_can_retry: false }
      }
      if (path === '/api/v1/audio/unmarked-speakers/segments') return segmentResponse()
      if (path === '/api/v1/audio/unmarked-speakers/mark') return { outcome: 'marked' }
      throw new Error(`unexpected audio path: ${path}`)
    }),
  }
  const service = new UnmarkedSpeakerService(runtime as never)
  return {
    service,
    runtime,
    setSession(next: typeof session) { currentSession = next },
  }
}

async function listedCandidateRef(service: UnmarkedSpeakerService): Promise<string> {
  const page = await service.list()
  const first = page.items[0]
  if (first?.kind !== 'unmarked-speaker') throw new Error('missing candidate')
  return first.candidateRef
}

afterEach(() => { vi.useRealTimers() })

describe('UnmarkedSpeakerService', () => {
  it('uses the upstream count-only contract without projecting candidate rows', async () => {
    const { service, runtime } = fixture({
      '/api/v1/audio/unmarked-speakers/list': listResponse({ cross_day_count: 8, single_day_count: 3 }),
    })

    await expect(service.list({ countOnly: true })).resolves.toEqual({
      section: 'unmarked-speakers', items: [], total: 11, hasMore: false,
    })
    expect(runtime.authenticatedAudioPost).toHaveBeenCalledWith(
      '/api/v1/audio/unmarked-speakers/list', { limit: 0, cursor: '', status: '' }, session, undefined,
      expect.objectContaining({ lane: 'interactive-read' }),
    )
  })

  it.each(['fresh', 'stale', 'building', 'failed'] as const)(
    'strictly projects the %s candidate list state without leaking upstream identifiers',
    async projectionState => {
      const { service, runtime } = fixture({
        '/api/v1/audio/unmarked-speakers/list': listResponse({
          projection_state: projectionState,
          retry_after_ms: 2_500,
          cursor_stale: true,
          has_more: true,
          next_cursor: 'upstream-private-cursor',
          items: [
            candidate(),
            candidate({ candidate_id: 'candidate-private-2', status: 'single_day', label: '12', speaker_display_number: undefined }),
            candidate({ candidate_id: 'candidate-private-invalid-status', status: 'insufficient_evidence' }),
            candidate({ candidate_id: '', status: 'cross_day' }),
          ],
          cross_day_count: 1,
          single_day_count: 1,
        }),
      })

      const page = await service.list({ limit: 500, cursor: ' ' })

      expect(page).toMatchObject({
        section: 'unmarked-speakers', total: 2, hasMore: true,
        projectionState, retryAfterMillis: 2_500, cursorStale: true,
      })
      expect(page.nextCursor).toMatch(/^arkme-unmarked-candidate-cursor-v1\./)
      expect(page.items).toEqual([
        expect.objectContaining({ kind: 'unmarked-speaker', candidateRef: expect.stringMatching(/^arkme-unmarked-candidate-v1\./), displayName: '说话人 6', subtitle: expect.stringContaining('出现 3 天') }),
        expect.objectContaining({ kind: 'unmarked-speaker', candidateRef: expect.stringMatching(/^arkme-unmarked-candidate-v1\./), displayName: '2026-08-22 · 当天说话人 12' }),
      ])
      const serialized = JSON.stringify(page)
      for (const secret of ['candidate-private', 'day-private', 'cluster-private', 'published-private', 'upstream-private']) {
        expect(serialized).not.toContain(secret)
      }
      expect(runtime.authenticatedAudioPost).toHaveBeenCalledWith(
        '/api/v1/audio/unmarked-speakers/list', { limit: 50, cursor: '', status: '' }, session, undefined,
        expect.objectContaining({ lane: 'interactive-read' }),
      )
    },
  )

  it('omits an absent projection state and rejects a malformed provided projection state', async () => {
    const withoutProjection = listResponse()
    delete withoutProjection.projection_state
    const { service, runtime } = fixture({
      '/api/v1/audio/unmarked-speakers/list': withoutProjection,
    })

    const page = await service.list()
    expect(page).not.toHaveProperty('projectionState')

    runtime.authenticatedAudioPost.mockResolvedValueOnce(listResponse({ projection_state: 'invented' }))
    await expect(service.list()).rejects.toMatchObject({ code: 'unmarked-list-contract-invalid' })
  })

  it.each([
    ['pending', true],
    ['failed', true],
    ['unavailable', false],
  ] as const)('normalizes %s inference and filters invalid speaker recommendations', async (inferenceState, retryable) => {
    const { service } = fixture({
      '/api/v1/audio/unmarked-speakers/mark-options': optionsResponse({
        speaker_inference_status: inferenceState,
        speaker_inference_can_retry: retryable,
        recommended_speaker_id: 'speaker-private-1',
        speakers: [
          { speaker_id: 'speaker-private-1', nick_name: ' 林林 ', is_recommended: true },
          { speaker_id: 'speaker-private-placeholder', nick_name: '未命名说话人', is_recommended: true },
          { speaker_id: '', nick_name: '损坏项', is_recommended: false },
        ],
        recommendations: [
          { speaker_id: 'speaker-private-1', nick_name: '林林', confidence: 90, confidence_level: 'high', summary: 'ok', evidence: [] },
          { speaker_id: 'speaker-private-unknown', nick_name: '陌生人', confidence: 99, confidence_level: 'high', summary: 'bad', evidence: [] },
        ],
      }),
    })
    const candidateRef = await listedCandidateRef(service)

    const options = await service.markOptions(candidateRef)

    expect(options).toEqual({
      candidateRef,
      candidateVersion: 'candidate-version-1',
      speakerToken: '6',
      appearanceDays: 3,
      validAudioDurationMillis: 66_000,
      segmentCount: 4,
      latestAtMillis: new Date(2026, 7, 22, 10, 30).getTime(),
      conversationSummaryState: 'ready',
      conversationSummary: 'private summary',
      inference: {
        state: inferenceState,
        recommendedSpeakerRef: expect.stringMatching(/^arkme-unmarked-speaker-choice-v1\./),
        recommendedDisplayName: '可能是林林',
        retryable,
      },
      speakerChoices: [{
        speakerRef: expect.stringMatching(/^arkme-unmarked-speaker-choice-v1\./),
        displayName: '林林', source: 'recommended',
      }],
    })
    expect(JSON.stringify(options)).not.toContain('speaker-private')
  })

  it.each([
    ['pending', 'pending', '旧推测'],
    ['ready', 'ready', '兼容推测'],
    ['unavailable', 'unavailable', ''],
  ] as const)(
    'derives missing inference status as %s only through the Web compatibility rules',
    async (expectedState, summaryState, inferenceText) => {
      const response = optionsResponse({
        conversation_summary_status: summaryState,
        speaker_inference: inferenceText,
      })
      delete response.speaker_inference_status
      const { service } = fixture({ '/api/v1/audio/unmarked-speakers/mark-options': response })
      const candidateRef = await listedCandidateRef(service)

      await expect(service.markOptions(candidateRef)).resolves.toMatchObject({
        inference: { state: expectedState },
      })
    },
  )

  it.each([
    optionsResponse({ speaker_inference_status: 'invented' }),
    (() => {
      const response = optionsResponse({ conversation_summary_status: 'invented' })
      delete response.speaker_inference_status
      return response
    })(),
  ])('rejects malformed provided inference enums', async response => {
    const { service } = fixture({ '/api/v1/audio/unmarked-speakers/mark-options': response })
    const candidateRef = await listedCandidateRef(service)
    await expect(service.markOptions(candidateRef)).rejects.toMatchObject({ code: 'unmarked-options-contract-invalid' })
  })

  it('retries inference with the currently stored candidate version and normalizes only documented outcomes', async () => {
    const { service, runtime } = fixture()
    const candidateRef = await listedCandidateRef(service)
    await expect(service.retryInference(candidateRef)).rejects.toMatchObject({ code: 'unmarked-candidate-version-required' })
    await service.markOptions(candidateRef)

    await expect(service.retryInference(candidateRef)).resolves.toEqual({
      candidateRef,
      inference: { state: 'pending', retryable: false },
    })
    expect(runtime.authenticatedAudioPost).toHaveBeenLastCalledWith(
      '/api/v1/audio/unmarked-speakers/speaker-inference/retry',
      { candidate_id: 'candidate-private-1', candidate_version: 'candidate-version-1' },
      session, undefined, expect.objectContaining({ lane: 'write', bypassCache: true }),
    )

    runtime.authenticatedAudioPost.mockResolvedValueOnce({ outcome: 'invented', speaker_inference_status: 'invented' })
    await expect(service.retryInference(candidateRef)).rejects.toMatchObject({ code: 'unmarked-inference-contract-invalid' })
  })

  it('projects paginated segments while retaining the private media tuple only behind segment refs', async () => {
    const { service, runtime } = fixture({
      '/api/v1/audio/unmarked-speakers/segments': segmentResponse({
        next_cursor: 'segment-upstream-private-cursor', has_more: true, total_count: 3, cursor_stale: true,
        segments: [
          segmentResponse().segments[0],
          { ...segmentResponse().segments[0], segment_id: '', transcript: 'invalid' },
          { ...segmentResponse().segments[0], segment_id: 'segment-private-bad', audio_file_name: '' },
        ],
      }),
    })
    const candidateRef = await listedCandidateRef(service)

    const page = await service.segments(candidateRef, { limit: 500 })

    expect(page).toEqual({
      items: [{
        segmentRef: expect.stringMatching(/^arkme-unmarked-segment-v1\./),
        date: '2025-08-23', sessionLabel: '周会', timeRange: '10:00:00–10:00:02',
        durationMillis: 2_500, transcript: '需要保留的转写',
      }],
      total: 3, hasMore: true,
      nextCursor: expect.stringMatching(/^arkme-unmarked-segment-cursor-v1\./),
      cursorStale: true,
    })
    const serialized = JSON.stringify(page)
    for (const secret of ['segment-private', 'session-private', 'child-private', 'private.opus', 'private before', 'upstream-private']) {
      expect(serialized).not.toContain(secret)
    }
    expect(runtime.authenticatedAudioPost).toHaveBeenLastCalledWith(
      '/api/v1/audio/unmarked-speakers/segments',
      { candidate_id: 'candidate-private-1', cursor: '', limit: 50, date_stamp: 0 },
      session, undefined, expect.objectContaining({ lane: 'interactive-read' }),
    )
  })

  it('sends exact existing- and new-speaker mark payloads and rejects absent or mismatched versions', async () => {
    const { service, runtime } = fixture()
    const candidateRef = await listedCandidateRef(service)
    const options = await service.markOptions(candidateRef)
    const speakerRef = options.speakerChoices[0]!.speakerRef

    await expect(service.mark({ candidateRef, candidateVersion: '', speakerRef }))
      .rejects.toMatchObject({ code: 'unmarked-candidate-version-required' })
    await expect(service.mark({ candidateRef, candidateVersion: 'candidate-version-old', speakerRef }))
      .rejects.toMatchObject({ code: 'unmarked-candidate-version-stale' })
    expect(runtime.authenticatedAudioPost).toHaveBeenCalledTimes(2)

    await service.mark({ candidateRef, candidateVersion: 'candidate-version-1', speakerRef })
    expect(runtime.authenticatedAudioPost).toHaveBeenLastCalledWith(
      '/api/v1/audio/unmarked-speakers/mark',
      { candidate_id: 'candidate-private-1', candidate_version: 'candidate-version-1', speaker_id: 'speaker-private-1', new_nick_name: '' },
      session, undefined, expect.objectContaining({ lane: 'write', bypassCache: true }),
    )

    await service.markOptions(candidateRef)
    await service.mark({ candidateRef, candidateVersion: 'candidate-version-1', newSpeakerName: '  新同事  ' })
    expect(runtime.authenticatedAudioPost).toHaveBeenLastCalledWith(
      '/api/v1/audio/unmarked-speakers/mark',
      { candidate_id: 'candidate-private-1', candidate_version: 'candidate-version-1', speaker_id: '', new_nick_name: '新同事' },
      session, undefined, expect.objectContaining({ lane: 'write', bypassCache: true }),
    )
    await service.markOptions(candidateRef)
    await expect(service.mark({ candidateRef, candidateVersion: 'candidate-version-1', speakerRef, newSpeakerName: 'both' }))
      .rejects.toMatchObject({ code: 'unmarked-mark-target-invalid' })
  })

  it.each(['marked', 'stale', 'conflict', 'speaker_not_found'] as const)(
    'normalizes %s and preserves the candidate ref while invalidating the required reads',
    async outcome => {
      const { service, runtime } = fixture({ '/api/v1/audio/unmarked-speakers/mark': { outcome } })
      const candidateRef = await listedCandidateRef(service)
      const options = await service.markOptions(candidateRef)
      const segmentPage = await service.segments(candidateRef)
      const speakerRef = options.speakerChoices[0]!.speakerRef
      const segmentRef = segmentPage.items[0]!.segmentRef

      await expect(service.mark({
        candidateRef, candidateVersion: 'candidate-version-1', speakerRef,
      })).resolves.toEqual({ outcome })
      const writeCount = runtime.authenticatedAudioPost.mock.calls.filter(call =>
        call[0] === '/api/v1/audio/unmarked-speakers/mark').length
      if (outcome === 'marked' || outcome === 'stale' || outcome === 'conflict') {
        await expect(service.mark({ candidateRef, candidateVersion: 'candidate-version-1', newSpeakerName: '重复写入' }))
          .rejects.toMatchObject({ code: 'unmarked-candidate-version-stale' })
        expect(runtime.authenticatedAudioPost.mock.calls.filter(call =>
          call[0] === '/api/v1/audio/unmarked-speakers/mark')).toHaveLength(writeCount)
      } else {
        await expect(service.mark({ candidateRef, candidateVersion: 'candidate-version-1', speakerRef }))
          .rejects.toMatchObject({ code: 'unmarked-speaker-ref-expired' })
      }
      if (outcome === 'stale' || outcome === 'conflict') {
        await expect(service.resolveSegmentForMedia(segmentRef, candidateRef))
          .rejects.toMatchObject({ code: 'unmarked-segment-ref-expired' })
      } else {
        await expect(service.resolveSegmentForMedia(segmentRef, candidateRef)).resolves.toMatchObject({
          candidateId: 'candidate-private-1', segmentId: 'segment-private-1',
        })
      }
      await expect(service.markOptions(candidateRef)).resolves.toMatchObject({ candidateRef })

      const invalidated = runtime.invalidateKey.mock.calls.map(call => String(call[1]))
      if (outcome === 'marked') {
        expect(invalidated).toContain('unmarked-speakers:list')
        expect(invalidated).toContain('unmarked-speakers:options:candidate-private-1')
      } else if (outcome === 'stale') {
        expect(invalidated).toContain('unmarked-speakers:options:candidate-private-1')
        expect(invalidated).toContain('unmarked-speakers:segments:candidate-private-1')
      } else if (outcome === 'conflict') {
        expect(invalidated).toContain('unmarked-speakers:list')
        expect(invalidated).toContain('unmarked-speakers:options:candidate-private-1')
        expect(invalidated).toContain('unmarked-speakers:segments:candidate-private-1')
      } else {
        expect(invalidated).toContain('unmarked-speakers:options:candidate-private-1')
      }
    },
  )

  it('deletes only candidate_not_found refs and rejects unknown mark outcomes', async () => {
    const { service, runtime } = fixture({ '/api/v1/audio/unmarked-speakers/mark': { outcome: 'candidate_not_found' } })
    const candidateRef = await listedCandidateRef(service)
    await service.markOptions(candidateRef)
    await expect(service.mark({ candidateRef, candidateVersion: 'candidate-version-1', newSpeakerName: '新同事' }))
      .resolves.toEqual({ outcome: 'candidate_not_found' })
    await expect(service.markOptions(candidateRef)).rejects.toMatchObject({ code: 'unmarked-candidate-ref-expired' })
    expect(runtime.invalidateKey).toHaveBeenCalledWith('user:7', 'unmarked-speakers:list')

    const secondRef = await listedCandidateRef(service)
    await service.markOptions(secondRef)
    runtime.authenticatedAudioPost.mockResolvedValueOnce({ outcome: 'invented' })
    await expect(service.mark({ candidateRef: secondRef, candidateVersion: 'candidate-version-1', newSpeakerName: '新同事' }))
      .rejects.toMatchObject({ code: 'unmarked-mark-contract-invalid' })
  })

  it.each([
    ['/api/v1/audio/unmarked-speakers/mark-options', async (service: UnmarkedSpeakerService, candidateRef: string) =>
      await service.markOptions(candidateRef)],
    ['/api/v1/audio/unmarked-speakers/segments', async (service: UnmarkedSpeakerService, candidateRef: string) =>
      await service.segments(candidateRef)],
  ] as const)('invalidates the candidate list when %s returns candidate_not_found', async (path, read) => {
    const { service, runtime } = fixture({ [path]: { outcome: 'candidate_not_found' } })
    const candidateRef = await listedCandidateRef(service)

    await expect(read(service, candidateRef)).rejects.toMatchObject({ code: 'unmarked-candidate-not-found' })
    expect(runtime.invalidateKey).toHaveBeenCalledWith('user:7', 'unmarked-speakers:list')
    await expect(service.markOptions(candidateRef)).rejects.toMatchObject({ code: 'unmarked-candidate-ref-expired' })
  })

  it('rejects tampered, expired, cross-account, and type-confused candidate/speaker/segment refs', async () => {
    vi.useFakeTimers()
    const { service, setSession } = fixture()
    const candidateRef = await listedCandidateRef(service)
    const options = await service.markOptions(candidateRef)
    const speakerRef = options.speakerChoices[0]!.speakerRef
    const segments = await service.segments(candidateRef)
    const segmentRef = segments.items[0]!.segmentRef

    const tampered = `${candidateRef.slice(0, -1)}${candidateRef.endsWith('0') ? '1' : '0'}`
    await expect(service.markOptions(tampered)).rejects.toMatchObject({ code: 'unmarked-candidate-ref-expired' })
    await expect(service.markOptions(speakerRef)).rejects.toMatchObject({ code: 'unmarked-candidate-ref-invalid' })
    await expect(service.markOptions(segmentRef)).rejects.toMatchObject({ code: 'unmarked-candidate-ref-invalid' })
    await expect(service.mark({ candidateRef, candidateVersion: 'candidate-version-1', speakerRef: segmentRef }))
      .rejects.toMatchObject({ code: 'unmarked-speaker-ref-invalid' })
    const tamperedSegmentRef = `${segmentRef.slice(0, -1)}${segmentRef.endsWith('0') ? '1' : '0'}`
    await expect(service.resolveSegmentForMedia(tamperedSegmentRef, candidateRef))
      .rejects.toMatchObject({ code: 'unmarked-segment-ref-expired' })

    setSession({ ...session, userId: 8 })
    await expect(service.markOptions(candidateRef)).rejects.toMatchObject({ code: 'unmarked-candidate-ref-account-mismatch' })
    await expect(service.resolveSegmentForMedia(segmentRef, candidateRef))
      .rejects.toMatchObject({ code: 'unmarked-segment-ref-account-mismatch' })
    const otherCandidateRef = await listedCandidateRef(service)
    await service.markOptions(otherCandidateRef)
    await expect(service.mark({ candidateRef: otherCandidateRef, candidateVersion: 'candidate-version-1', speakerRef }))
      .rejects.toMatchObject({ code: 'unmarked-speaker-ref-account-mismatch' })
    setSession(session)
    vi.advanceTimersByTime(29 * 60_000)
    await service.list()
    vi.advanceTimersByTime(2 * 60_000)
    await expect(service.mark({ candidateRef, candidateVersion: 'candidate-version-1', speakerRef }))
      .rejects.toMatchObject({ code: 'unmarked-speaker-ref-expired' })
    await expect(service.resolveSegmentForMedia(segmentRef, candidateRef))
      .rejects.toMatchObject({ code: 'unmarked-segment-ref-expired' })
    vi.advanceTimersByTime(29 * 60_000 + 1)
    await expect(service.markOptions(candidateRef)).rejects.toMatchObject({ code: 'unmarked-candidate-ref-expired' })
  })

  it('keeps the validated media tuple Provider-private behind its account-bound segment ref', async () => {
    const { service } = fixture()
    const candidateRef = await listedCandidateRef(service)
    const page = await service.segments(candidateRef)

    await expect(service.resolveSegmentForMedia(page.items[0]!.segmentRef, candidateRef)).resolves.toEqual({
      viewerUserId: 7,
      candidateId: 'candidate-private-1',
      segmentId: 'segment-private-1',
      sessionId: 'session-private-1',
      childId: 'child-private-1',
      audioFileName: 'private.opus',
    })
  })

  it('caps candidates, speaker choices, and segments to provider-owned limits', async () => {
    const { service } = fixture({
      '/api/v1/audio/unmarked-speakers/list': listResponse({
        items: Array.from({ length: 80 }, (_, index) => candidate({ candidate_id: `candidate-private-${String(index + 1)}`, label: String(index + 1) })),
        cross_day_count: 80,
      }),
      '/api/v1/audio/unmarked-speakers/mark-options': optionsResponse({
        speakers: Array.from({ length: 140 }, (_, index) => ({
          speaker_id: `speaker-private-${String(index + 1)}`, nick_name: `说话人${String(index + 1)}`, is_recommended: false,
        })),
        recommendation_state: 'none', recommended_speaker_id: '',
      }),
      '/api/v1/audio/unmarked-speakers/segments': segmentResponse({
        segments: Array.from({ length: 80 }, (_, index) => ({
          ...segmentResponse().segments[0], segment_id: `segment-private-${String(index + 1)}`,
        })),
        total_count: 80,
      }),
    })
    const page = await service.list()
    expect(page.items).toHaveLength(50)
    const candidateRef = page.items[0]!.kind === 'unmarked-speaker' ? page.items[0]!.candidateRef : ''
    await expect(service.markOptions(candidateRef)).resolves.toMatchObject({ speakerChoices: expect.any(Array) })
    expect((await service.markOptions(candidateRef)).speakerChoices).toHaveLength(100)
    expect((await service.segments(candidateRef)).items).toHaveLength(50)
  })
})
