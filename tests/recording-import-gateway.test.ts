import { describe, expect, it, vi } from 'vitest'
import type { RecordingImportJob } from '../src/recording-import-contract.js'
import { AudioRecordingImportGateway } from '../src/services/recording-import-gateway.js'
import type { ServiceRuntime } from '../src/services/service.js'

function job(overrides: Partial<RecordingImportJob> = {}): RecordingImportJob {
  return {
    jobId: 'job-1', userId: 42, revision: 4, phase: 'uploading',
    fileName: 'meeting.m4a', mimeType: 'audio/mp4', fileSize: 1024,
    durationMillis: 60_000, sha256: 'a'.repeat(64), startAtMillis: 1_725_000_000_000,
    belongUserId: 42, sourceHandle: '/private/job-1.upload', uploadedBytes: 0,
    createdAtMillis: 1_725_000_000_100, updatedAtMillis: 1_725_000_000_100,
    ...overrides,
  }
}

function ownerRow(sessionId: string, finishedUpload = true, processingCompleted = false): Record<string, unknown> {
  return {
    id: sessionId, source: 2, orig_name: `${sessionId}.wav`, source_size: 1_024, size: 1_024,
    duration: 1_000, start_at: 1_725_000_000_000, end_at: 1_725_000_001_000,
    create_at: 1_725_000_000_000, update_at: 1_725_000_001_000, belong_usr: 42,
    has_finish_spk: finishedUpload,
    has_done_child: processingCompleted,
  }
}

function gatewayForOwnerProgress(itemLs: Array<Record<string, unknown>>): AudioRecordingImportGateway {
  const runtime = {
    async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
    async authenticatedAudioPost(path: string, body: Record<string, unknown>) {
      if (path.endsWith('/get-session-ls')) {
        const scoped = itemLs.filter(item => {
          const statuses = Array.isArray(item.child_status_ls)
            ? item.child_status_ls.map(child => Number((child as Record<string, unknown>).status))
            : []
          const completed = statuses.length > 0 && statuses.every(status => status === 5 || status === 6)
          return (body.task_scope === 'completed') === completed
        })
        return { session_ls: scoped.map(item => ownerRow(
          String(item.session_id),
          true,
          body.task_scope === 'completed',
        )) }
      }
      if (path.endsWith('/get-session-deal-status')) return { item_ls: itemLs }
      throw new Error(`unexpected owner request: ${path}`)
    },
  } as unknown as ServiceRuntime
  return new AudioRecordingImportGateway(runtime)
}

describe('AudioRecordingImportGateway', () => {
  it('keeps Audio duplicate lookup batching behind the owner gateway', async () => {
    const posts: Array<{ path: string; body: Record<string, unknown> }> = []
    const runtime = {
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string, body: Record<string, unknown>) {
        posts.push({ path, body })
        const names = body.orig_names as string[]
        return { exist_names: names.filter((_name, index) => index === 0) }
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)
    const names = Array.from({ length: 205 }, (_, index) => `recording-${String(index)}.wav`)

    await expect(gateway.findExistingFileNames({ viewerUserId: 42, fileNames: names })).resolves.toEqual([
      'recording-0.wav', 'recording-100.wav', 'recording-200.wav',
    ])
    expect(posts).toEqual([
      { path: '/api/v1/audio/check-exist-same-orig', body: { orig_names: names.slice(0, 100) } },
      { path: '/api/v1/audio/check-exist-same-orig', body: { orig_names: names.slice(100, 200) } },
      { path: '/api/v1/audio/check-exist-same-orig', body: { orig_names: names.slice(200) } },
    ])
  })

  it('rejects owner reads when the active account changes after business scope capture', async () => {
    const authenticatedAudioPost = vi.fn(async () => ({ session_ls: [ownerRow('wrong-account')] }))
    const runtime = {
      async requireSession() { return { userId: 77, accessToken: 'access', refreshToken: 'refresh' } },
      authenticatedAudioPost,
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.listOwnerTasks({
      viewerUserId: 42,
      scope: 'active', toMillis: 1_725_100_000_000, limit: 20, offset: 0,
    }))
      .rejects.toMatchObject({ code: 'recording-import-account-mismatch', retryable: true })
    expect(authenticatedAudioPost).not.toHaveBeenCalled()
  })

  it('rechecks the active account before every batched duplicate lookup', async () => {
    let currentUserId = 42
    const authenticatedAudioPost = vi.fn(async () => {
      currentUserId = 77
      return { exist_names: [] }
    })
    const runtime = {
      async requireSession() { return { userId: currentUserId, accessToken: 'access', refreshToken: 'refresh' } },
      authenticatedAudioPost,
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.findExistingFileNames({
      viewerUserId: 42,
      fileNames: Array.from({ length: 101 }, (_, index) => `recording-${String(index)}.wav`),
    })).rejects.toMatchObject({ code: 'recording-import-account-mismatch', retryable: true })
    expect(authenticatedAudioPost).toHaveBeenCalledOnce()
  })

  it('rechecks the active account before every owner page', async () => {
    let currentUserId = 42
    const authenticatedAudioPost = vi.fn(async () => {
      currentUserId = 77
      return {
        session_ls: Array.from({ length: 100 }, (_, index) => ownerRow(`session-${String(index)}`, false)),
      }
    })
    const runtime = {
      async requireSession() { return { userId: currentUserId, accessToken: 'access', refreshToken: 'refresh' } },
      authenticatedAudioPost,
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.listOwnerTasks({
      viewerUserId: 42,
      scope: 'active', toMillis: 1_725_100_000_000, limit: 101, offset: 0,
    })).rejects.toMatchObject({ code: 'recording-import-account-mismatch', retryable: true })
    expect(authenticatedAudioPost).toHaveBeenCalledOnce()
  })

  it('does not downgrade an account switch into optional owner-progress unavailability', async () => {
    let currentUserId = 42
    const authenticatedAudioPost = vi.fn(async (path: string) => {
      if (path.endsWith('/get-session-ls')) {
        currentUserId = 77
        return { session_ls: [ownerRow('session-1')] }
      }
      return { item_ls: [] }
    })
    const runtime = {
      async requireSession() { return { userId: currentUserId, accessToken: 'access', refreshToken: 'refresh' } },
      authenticatedAudioPost,
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.listOwnerTasks({
      viewerUserId: 42,
      scope: 'active', toMillis: 1_725_100_000_000, limit: 20, offset: 0,
    })).rejects.toMatchObject({ code: 'recording-import-account-mismatch', retryable: true })
    expect(authenticatedAudioPost).toHaveBeenCalledOnce()
  })

  it('does not substitute terminal child statuses for the Audio owner processing-completion fact', async () => {
    const runtime = {
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string, body: Record<string, unknown>) {
        if (path.endsWith('/get-session-ls')) return { session_ls: body.task_scope === 'completed' ? [] : [{
          ...ownerRow('sealed-but-aggregating'),
          has_done_child: false,
        }] }
        if (path.endsWith('/get-session-deal-status')) return { item_ls: [{
          session_id: 'sealed-but-aggregating',
          timing_state: 'processing',
          child_status_ls: [{ status: 5 }],
        }] }
        throw new Error(`unexpected owner request: ${path}`)
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    const active = await gateway.listOwnerTasks({
      viewerUserId: 42,
      scope: 'active', toMillis: 1_725_100_000_000, limit: 20, offset: 0,
    })
    const completed = await gateway.listOwnerTasks({
      viewerUserId: 42,
      scope: 'completed', toMillis: 1_725_100_000_000, limit: 20, offset: 0,
    })

    expect(active.tasks.map(item => item.session.sessionId)).toEqual(['sealed-but-aggregating'])
    expect(completed.tasks).toEqual([])
  })

  it('partitions only PC-upload sessions by processing terminality instead of upload sealing', async () => {
    const owner = (id: string, source: number, finishedUpload: boolean, processingCompleted: boolean) => ({
      id, source, orig_name: `${id}.wav`, source_size: 1_024, size: 1_024,
      duration: 1_000, start_at: 1_725_000_000_000, end_at: 1_725_000_001_000,
      create_at: 1_725_000_000_000, update_at: 1_725_000_001_000, belong_usr: 42,
      has_finish_spk: finishedUpload,
      has_done_child: processingCompleted,
    })
    const runtime = {
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string, body: Record<string, unknown>) {
        if (path.endsWith('/get-session-ls')) return { session_ls: [
          owner('uploading', 2, false, false),
          owner('processing', 2, true, false),
          owner('completed', 2, true, true),
          owner('failed', 2, true, true),
          owner('long-recording', 1, false, false),
          owner('voiceprint', 3, true, true),
        ].filter(item => (body.task_scope === 'completed') === item.has_done_child) }
        if (path.endsWith('/get-session-deal-status')) return { item_ls: [
          { session_id: 'processing', timing_state: 'processing', child_status_ls: [{ status: 4 }] },
          { session_id: 'completed', timing_state: 'completed', child_status_ls: [{ status: 5 }] },
          { session_id: 'failed', timing_state: 'completed', child_status_ls: [{ status: 6 }] },
        ] }
        throw new Error(`unexpected owner request: ${path}`)
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    const active = await gateway.listOwnerTasks({
      viewerUserId: 42,
      scope: 'active', toMillis: 1_725_100_000_000, limit: 20, offset: 0,
    })
    const completed = await gateway.listOwnerTasks({
      viewerUserId: 42,
      scope: 'completed', toMillis: 1_725_100_000_000, limit: 20, offset: 0,
    })

    expect(active.tasks.map(item => item.session.sessionId)).toEqual(['uploading', 'processing'])
    expect(completed.tasks.map(item => item.session.sessionId)).toEqual(['completed', 'failed'])
  })

  it('filters active/completed rows from the real desktop Audio session contract and projects real timing rows', async () => {
    const posts: Array<{ path: string; body: Record<string, unknown> }> = []
    const runtime = {
      config: { environment: 'test' },
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string, body: Record<string, unknown>) {
        posts.push({ path, body })
        if (path.endsWith('get-session-ls')) return { session_ls: body.task_scope === 'completed' ? [{
          id: 'session-1', source: 2, orig_name: 'meeting.m4a', source_size: 1_024, size: 512,
          duration: 60_000, start_at: 1_725_000_000_000, end_at: 1_725_000_060_000,
          create_at: 1_725_000_000_100, update_at: 1_725_000_018_100, belong_usr: 42,
          has_finish_spk: true, has_done_child: true,
        }] : [{
          id: 'session-active', source: 2, orig_name: 'active.wav', source_size: 2_048, size: 1_024,
          duration: 30_000, start_at: 1_725_000_100_000, end_at: 1_725_000_130_000,
          create_at: 1_725_000_100_100, update_at: 1_725_000_101_100, belong_usr: 0,
          has_finish_spk: false, has_done_child: false,
        }] }
        if (path.endsWith('get-session-deal-status')) return { item_ls: [{
          session_id: 'session-1', timing_state: 'completed', child_status_ls: [{ status: 5 }],
          processing_timing_ls: [{
            stage: 'vad', outcome: 'success', started_at_ms: 1_725_000_004_100,
            ended_at_ms: 1_725_000_012_100, duration_ms: 8_000, provider: 'sensevoice',
            model: 'silero-vad', model_version: 'v1',
          }, {
            stage: 'asr', outcome: 'success', started_at_ms: 1_725_000_004_100,
            ended_at_ms: 1_725_000_017_100, duration_ms: 13_000, provider: 'sensevoice',
            model: 'sensevoice', model_version: 'v1',
          }],
        }] }
        throw new Error(`unexpected owner request: ${path}`)
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.listOwnerTasks({
      viewerUserId: 42,
      scope: 'completed', toMillis: 1_725_100_000_000, limit: 50, offset: 0,
    })).resolves.toEqual({
      total: 1,
      hasMore: false,
      tasks: [{
        processingCompleted: true,
        session: expect.objectContaining({
          sessionId: 'session-1', fileName: 'meeting.m4a', fileSize: 1_024, parsedSize: 512,
          startAtMillis: 1_725_000_000_000, endAtMillis: 1_725_000_060_000,
          hasFinishedUpload: true, ownership: 'self',
        }),
        progress: expect.objectContaining({
          displayStatus: 'completed', timingState: 'completed',
          processingTiming: expect.objectContaining({
            timingState: 'completed', totalDurationMillis: 21_000,
            rows: [
              expect.objectContaining({ stage: 'vad', outcome: 'success', durationMillis: 8_000 }),
              expect.objectContaining({ stage: 'asr', outcome: 'success', durationMillis: 13_000 }),
            ],
          }),
        }),
      }],
    })
    await expect(gateway.listOwnerTasks({
      viewerUserId: 42,
      scope: 'active', toMillis: 1_725_100_000_000, limit: 50, offset: 0,
    })).resolves.toEqual({
      total: 1,
      hasMore: false,
      tasks: [{ processingCompleted: false, session: expect.objectContaining({
        sessionId: 'session-active', fileName: 'active.wav', hasFinishedUpload: false, ownership: 'other',
      }) }],
    })
    expect(posts).toEqual([
      { path: '/api/v1/audio/get-session-ls', body: { to_stamp: 1_725_100_000_000, limit: 100, offset: 0, query_new: false, task_scope: 'completed' } },
      { path: '/api/v1/audio/get-session-deal-status', body: { session_ids: ['session-1'] } },
      { path: '/api/v1/audio/get-session-ls', body: { to_stamp: 1_725_100_000_000, limit: 100, offset: 0, query_new: false, task_scope: 'active' } },
    ])
  })

  it('pages through mixed owner rows to fill the completed fold without a fixed archive ceiling', async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const owner = (id: string, source: number) => ({
      id, source, orig_name: `${id}.wav`, source_size: 1_024, size: 1_024,
      duration: 1_000, start_at: 1_725_000_000_000, end_at: 1_725_000_001_000,
      create_at: 1_725_000_000_000, update_at: 1_725_000_001_000, belong_usr: 42,
      has_finish_spk: true, has_done_child: true,
    })
    const runtime = {
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string, body: Record<string, unknown>) {
        requests.push({ path, body })
        if (path.endsWith('/get-session-deal-status')) {
          return { item_ls: (body.session_ids as string[]).map(sessionId => ({
            session_id: sessionId, timing_state: 'completed', child_status_ls: [{ status: 5 }],
          })) }
        }
        return body.offset === 0
          ? { session_ls: Array.from({ length: 100 }, (_, index) => owner(`long-recording-${String(index)}`, 1)) }
          : { session_ls: [owner('completed-1', 2), owner('completed-2', 2), owner('completed-3', 2)] }
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.listOwnerTasks({
      viewerUserId: 42,
      scope: 'completed', toMillis: 1_725_100_000_000, limit: 2, offset: 0,
    })).resolves.toEqual({
      tasks: [
        expect.objectContaining({ session: expect.objectContaining({ sessionId: 'completed-1' }) }),
        expect.objectContaining({ session: expect.objectContaining({ sessionId: 'completed-2' }) }),
      ],
      total: 3,
      hasMore: true,
    })
    expect(requests).toEqual([
      { path: '/api/v1/audio/get-session-ls', body: { to_stamp: 1_725_100_000_000, limit: 100, offset: 0, query_new: false, task_scope: 'completed' } },
      { path: '/api/v1/audio/get-session-ls', body: { to_stamp: 1_725_100_000_000, limit: 100, offset: 100, query_new: false, task_scope: 'completed' } },
      { path: '/api/v1/audio/get-session-deal-status', body: { session_ids: ['completed-1', 'completed-2', 'completed-3'] } },
    ])
  })

  it('bounds current owner reads once the visible active rows are filled', async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const runtime = {
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string, body: Record<string, unknown>) {
        requests.push({ path, body })
        if (path.endsWith('/get-session-deal-status')) return { item_ls: [] }
        return { session_ls: Array.from({ length: 100 }, (_, index) => ({
          id: `session-${String(index)}`, source: 2, orig_name: `recording-${String(index)}.wav`,
          source_size: 1_024, size: 1_024, duration: 1_000,
          start_at: 1_725_000_000_000 - index, end_at: 1_725_000_001_000 - index,
          create_at: 1_725_000_000_000 - index, update_at: 1_725_000_001_000 - index,
          belong_usr: 42, has_finish_spk: index >= 20, has_done_child: false,
        })) }
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    const page = await gateway.listOwnerTasks({
      viewerUserId: 42,
      scope: 'active', toMillis: 1_725_100_000_000, limit: 20, offset: 0,
    })

    expect(page.tasks).toHaveLength(20)
    expect(page).not.toHaveProperty('total')
    expect(requests).toHaveLength(2)
  })

  it('keeps completed-task edits and deletion behind the Audio owner gateway', async () => {
    const posts: Array<{ path: string; body: Record<string, unknown> }> = []
    const runtime = {
      config: { environment: 'test' },
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string, body: Record<string, unknown>) {
        posts.push({ path, body }); return {}
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await gateway.updateOwnerSessionStart({
      viewerUserId: 42, sessionId: 'session-1', startAtMillis: 1_725_000_000_000,
    })
    await gateway.updateOwnerSessionOwnership({
      viewerUserId: 42, sessionId: 'session-1', belongUserId: 0,
    })
    await gateway.deleteOwnerSession({ viewerUserId: 42, sessionId: 'session-1' })

    expect(posts).toEqual([
      { path: '/api/v1/audio/modify-session-start', body: expect.objectContaining({ session_id: 'session-1', start_at: 1_725_000_000_000 }) },
      { path: '/api/v1/audio/modify-session-belong-usr', body: { session_id: 'session-1', belong_usr: 0 } },
      { path: '/api/v1/audio/del-session', body: { session_id: 'session-1' } },
    ])
  })

  it('loads the current Audio owner fact before validating a start-time mutation', async () => {
    const runtime = {
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string, body: Record<string, unknown>) {
        expect(path).toBe('/api/v1/audio/get-session-by-id')
        expect(body).toEqual({ session_id: 'session-1' })
        return {
          id: 'session-1', source: 2, orig_name: 'meeting.m4a', source_size: 1_024, size: 1_024,
          duration: 60_000, start_at: 1_725_000_000_000, end_at: 1_725_000_060_000,
          create_at: 1_725_000_000_100, update_at: 1_725_000_060_100,
          belong_usr: 42, has_finish_spk: true,
        }
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.loadOwnerSession({ viewerUserId: 42, sessionId: 'session-1' })).resolves.toMatchObject({
      sessionId: 'session-1', durationMillis: 60_000, ownership: 'self', hasFinishedUpload: true,
    })
  })

  it('rejects owner media intervals that cannot be represented as safe timestamps', async () => {
    const runtime = {
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost() {
        return {
          id: 'session-unsafe', source: 2, orig_name: 'unsafe.wav',
          duration: Number.MAX_SAFE_INTEGER, start_at: 1_725_000_000_000,
          belong_usr: 42, has_finish_spk: true,
        }
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.loadOwnerSession({ viewerUserId: 42, sessionId: 'session-unsafe' })).rejects.toMatchObject({
      code: 'recording-import-session-invalid', retryable: true,
    })
  })

  it('preserves owner timing state when processing rows are temporarily empty', async () => {
    const gateway = gatewayForOwnerProgress([{
      session_id: 'session-1', timing_state: 'processing', child_status_ls: [{ status: 4 }],
      processing_timing_ls: [],
    }])

    const page = await gateway.listOwnerTasks({
      viewerUserId: 42,
      scope: 'active', toMillis: 1_725_100_000_000, limit: 20, offset: 0,
    })
    expect(page.tasks[0]?.progress).toEqual({
      displayStatus: 'transcribing',
      timingState: 'processing',
      processingTiming: {
        timingState: 'processing', totalDurationMillis: 0, rows: [],
      },
    })
  })

  it('does not downgrade request cancellation into optional owner-progress unavailability', async () => {
    const controller = new AbortController()
    const cancelled = new Error('owner progress request cancelled')
    const runtime = {
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string) {
        if (path.endsWith('/get-session-ls')) return { session_ls: [ownerRow('session-1')] }
        controller.abort(cancelled)
        throw cancelled
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.listOwnerTasks({
      viewerUserId: 42,
      scope: 'active', toMillis: 1_725_100_000_000, limit: 20, offset: 0,
      signal: controller.signal,
    })).rejects.toBe(cancelled)
  })

  it('fails malformed child statuses closed and rejects invalid timing facts instead of normalizing them', async () => {
    const gateway = gatewayForOwnerProgress([{
      session_id: 'session-1', timing_state: 'completed',
      child_status_ls: [{ status: 5 }, { status: 7 }],
      processing_timing_ls: [{
        stage: 'asr', outcome: 'success', started_at_ms: 1_725_000_004_100,
        ended_at_ms: 1_725_000_017_100, duration_ms: -1, provider: 'sensevoice',
        model: 'sensevoice', model_version: 'v1',
      }],
    }])

    const page = await gateway.listOwnerTasks({
      viewerUserId: 42,
      scope: 'active', toMillis: 1_725_100_000_000, limit: 20, offset: 0,
    })
    expect(page.tasks[0]?.progress).toEqual({
      displayStatus: 'unavailable',
      timingState: 'completed',
      processingTiming: { timingState: 'unavailable', totalDurationMillis: 0, rows: [] },
    })
  })

  it('does not publish a partial processing total when one owner timing row is malformed', async () => {
    const gateway = gatewayForOwnerProgress([{
      session_id: 'session-1', timing_state: 'completed', child_status_ls: [{ status: 5 }],
      processing_timing_ls: [{
        stage: 'vad', outcome: 'success', started_at_ms: 1_725_000_004_100,
        ended_at_ms: 1_725_000_012_100, duration_ms: 8_000, provider: 'sensevoice', model: 'silero-vad',
      }, {
        stage: 'asr', outcome: 'success', started_at_ms: 1_725_000_012_100,
        ended_at_ms: 1_725_000_017_100, duration_ms: -1, provider: 'sensevoice', model: 'sensevoice',
      }],
    }])

    const page = await gateway.listOwnerTasks({
      viewerUserId: 42,
      scope: 'completed', toMillis: 1_725_100_000_000, limit: 20, offset: 0,
    })
    expect(page.tasks[0]?.progress).toEqual({
      displayStatus: 'completed',
      timingState: 'completed',
      processingTiming: { timingState: 'unavailable', totalDurationMillis: 0, rows: [] },
    })
  })

  it('keeps Audio child terminal outcomes distinct instead of treating status 5 and 6 as processing', async () => {
    const gateway = gatewayForOwnerProgress([
      { session_id: 'done', timing_state: 'completed', child_status_ls: [{ status: 5 }] },
      { session_id: 'failed', timing_state: 'completed', child_status_ls: [{ status: 6 }] },
      { session_id: 'partial', timing_state: 'completed', child_status_ls: [{ status: 5 }, { status: 6 }] },
    ])

    const page = await gateway.listOwnerTasks({
      viewerUserId: 42,
      scope: 'completed', toMillis: 1_725_100_000_000, limit: 20, offset: 0,
    })
    expect(page.tasks.map(task => task.progress?.displayStatus)).toEqual(['completed', 'failed', 'partial'])
  })

  it('uses the desktop Audio owner contract and keeps STS inside the Host', async () => {
    const posts: Array<{ path: string; body: Record<string, unknown> }> = []
    const runtime = {
      config: { environment: 'test' },
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string, body: Record<string, unknown>) {
        posts.push({ path, body })
        if (path.endsWith('get-session-by-id')) return {
          id: 'session-1', source: 2, start_at: 1_725_000_000_000,
          orig_name: 'meeting.m4a', belong_usr: 42, has_finish_spk: false,
        }
        if (path.endsWith('check-exist-same-orig')) return { exist_names: [] }
        if (path.endsWith('new-session')) return { session_id: 'session-1' }
        if (path.endsWith('new-child')) return { child_id: 'child-1', err_flag: 0 }
        if (path.endsWith('get-sts-token')) return {
          access_key_id: 'key', access_key_secret: 'secret', security_token: 'token',
          expiration: '2099-01-01T00:00:00.000Z',
        }
        return { err_flag: 0 }
      },
    } as unknown as ServiceRuntime
    const cancel = vi.fn()
    const multipartUpload = vi.fn(async (_path: string, _file: string, options: { progress: Function }) => {
      await options.progress(0.5, { uploadId: 'upload-1' })
      await options.progress(1, { uploadId: 'upload-1' })
    })
    const gateway = new AudioRecordingImportGateway(runtime, () => ({ multipartUpload, cancel }))
    const current = job({ sessionId: 'session-1', childId: 'child-1' })

    await expect(gateway.ensureSession(current)).resolves.toBe('session-1')
    await expect(gateway.createChild(current)).resolves.toBe('child-1')
    const progress = vi.fn(async () => undefined)
    await gateway.upload(current, progress)
    await gateway.finishChild(current)
    await gateway.finishSession(current)

    expect(posts.map(item => item.path)).toEqual([
      '/api/v1/audio/get-session-by-id',
      '/api/v1/audio/new-child',
      '/api/v1/audio/get-sts-token',
      '/api/v1/audio/child-upload-finish',
      '/api/v1/audio/finish-session',
    ])
    expect(posts[1]?.body).toMatchObject({
      session_id: 'session-1', start_at: 0, duration: 60_000,
      file_name: 'arkme_job-1_0.m4a', source_size: 1024,
    })
    expect(multipartUpload).toHaveBeenCalledWith(
      'pc_upload/42/session-1/arkme_job-1_0.m4a',
      '/private/job-1.upload',
      expect.objectContaining({ parallel: 1, checkpoint: undefined, mime: 'audio/mp4' }),
    )
    expect(progress).toHaveBeenLastCalledWith(1024, { uploadId: 'upload-1' })
    expect(JSON.stringify(posts)).not.toContain('access_key_secret')
  })

  it('closes the final owner duplicate race with the same case-insensitive file-name identity', async () => {
    const runtime = {
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string) {
        if (path.endsWith('/get-session-ls')) return { session_ls: [] }
        if (path.endsWith('/check-exist-same-orig')) return { exist_names: ['Meeting.M4A'] }
        throw new Error(`must not create a duplicate owner session: ${path}`)
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.ensureSession(job())).rejects.toMatchObject({
      code: 'recording-import-duplicate',
      retryable: false,
    })
  })

  it('recovers its exact session checkpoint before duplicate-name rejection', async () => {
    const posts: string[] = []
    const runtime = {
      config: { environment: 'test' },
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string) {
        posts.push(path)
        if (path.endsWith('get-session-ls')) return { session_ls: [{
          id: 'recovered-session', source: 2, operate_at: 1_725_000_000_100,
          start_at: 1_725_000_000_000, orig_name: 'meeting.m4a', belong_usr: 42,
        }] }
        throw new Error('must not create a duplicate')
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.ensureSession(job())).resolves.toBe('recovered-session')
    expect(posts).toEqual(['/api/v1/audio/get-session-ls'])
  })

  it('moves an imported recording to other ownership through the owner mutation contract', async () => {
    const posts: Array<{ path: string; body: Record<string, unknown> }> = []
    const runtime = {
      config: { environment: 'test' },
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string, body: Record<string, unknown>) {
        posts.push({ path, body })
        if (path.endsWith('get-session-ls')) return { session_ls: [] }
        if (path.endsWith('check-exist-same-orig')) return { exist_names: [] }
        if (path.endsWith('new-session')) return { session_id: 'session-other' }
        if (path.endsWith('modify-session-belong-usr')) return {}
        throw new Error(`unexpected owner request: ${path}`)
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.ensureSession(job({ belongUserId: 0 }))).resolves.toBe('session-other')
    expect(posts).toEqual([
      {
        path: '/api/v1/audio/get-session-ls',
        body: { to_stamp: 1_725_000_000_001, limit: 500, offset: 0, query_new: false },
      },
      { path: '/api/v1/audio/check-exist-same-orig', body: { orig_names: ['meeting.m4a'] } },
      {
        path: '/api/v1/audio/new-session',
        body: expect.not.objectContaining({ belong_usr: expect.anything() }),
      },
      {
        path: '/api/v1/audio/modify-session-belong-usr',
        body: { session_id: 'session-other', belong_usr: 0 },
      },
    ])
  })

  it('recovers a response-lost other import before ownership mutation and does not create again', async () => {
    const posts: Array<{ path: string; body: Record<string, unknown> }> = []
    const runtime = {
      config: { environment: 'test' },
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string, body: Record<string, unknown>) {
        posts.push({ path, body })
        if (path.endsWith('get-session-ls')) return { session_ls: [{
          id: 'recovered-other', source: 2, operate_at: 1_725_000_000_100,
          start_at: 1_725_000_000_000, orig_name: 'meeting.m4a', belong_usr: 42,
        }] }
        if (path.endsWith('modify-session-belong-usr')) return {}
        throw new Error('response-loss recovery must not create another session')
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.ensureSession(job({ belongUserId: 0 }))).resolves.toBe('recovered-other')
    expect(posts).toEqual([
      {
        path: '/api/v1/audio/get-session-ls',
        body: { to_stamp: 1_725_000_000_001, limit: 500, offset: 0, query_new: false },
      },
      {
        path: '/api/v1/audio/modify-session-belong-usr',
        body: { session_id: 'recovered-other', belong_usr: 0 },
      },
    ])
  })

  it('does not mutate ownership while compensating a response-lost cancelled import', async () => {
    const posts: Array<{ path: string; body: Record<string, unknown> }> = []
    const runtime = {
      config: { environment: 'test' },
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string, body: Record<string, unknown>) {
        posts.push({ path, body })
        if (path.endsWith('get-session-ls')) return { session_ls: [{
          id: 'recovered-other', source: 2, operate_at: 1_725_000_000_100,
          start_at: 1_725_000_000_000, orig_name: 'meeting.m4a', belong_usr: 42,
        }] }
        if (path.endsWith('del-session')) return {}
        throw new Error(`unexpected owner request: ${path}`)
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await gateway.deleteSession(job({ belongUserId: 0, phase: 'failed', failedFromPhase: 'prepared' }))
    expect(posts.map(item => item.path)).toEqual([
      '/api/v1/audio/get-session-ls',
      '/api/v1/audio/del-session',
    ])
  })

  it('rejects an account switch at the actual owner request boundary', async () => {
    const runtime = {
      config: { environment: 'test' },
      async requireSession() { return { userId: 77, accessToken: 'access', refreshToken: 'refresh' } },
      authenticatedAudioPost: vi.fn(),
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.ensureSession(job())).rejects.toMatchObject({
      code: 'recording-import-account-mismatch',
      retryable: true,
    })
    expect(runtime.authenticatedAudioPost).not.toHaveBeenCalled()
  })

  it('recovers beyond the legacy fifty-item window without unstable same-timestamp pagination', async () => {
    const requests: Array<Record<string, unknown>> = []
    const runtime = {
      config: { environment: 'test' },
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string, body: Record<string, unknown>) {
        if (!path.endsWith('get-session-ls')) throw new Error('must not create a duplicate session')
        requests.push(body)
        return { session_ls: [
          ...Array.from({ length: 100 }, (_, index) => ({
            id: `other-${String(index)}`, source: 2, operate_at: index,
            start_at: 1_725_000_000_000, orig_name: `other-${String(index)}.m4a`, belong_usr: 42,
          })),
          {
            id: 'recovered-session', source: 2, operate_at: 1_725_000_000_100,
            start_at: 1_725_000_000_000, orig_name: 'meeting.m4a', belong_usr: 42,
          },
        ] }
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.ensureSession(job())).resolves.toBe('recovered-session')
    expect(requests).toEqual([{
      to_stamp: 1_725_000_000_001, limit: 500, offset: 0, query_new: false,
    }])
  })

  it('recovers and deletes a session whose create response was lost', async () => {
    const posts: string[] = []
    const runtime = {
      config: { environment: 'test' },
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string) {
        posts.push(path)
        if (path.endsWith('get-session-ls')) return { session_ls: [{
          id: 'recovered-session', source: 2, operate_at: 1_725_000_000_100,
          start_at: 1_725_000_000_000, orig_name: 'meeting.m4a', belong_usr: 42,
        }] }
        return {}
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await gateway.deleteSession(job({ phase: 'failed', failedFromPhase: 'prepared', sessionId: undefined }))
    expect(posts).toEqual(['/api/v1/audio/get-session-ls', '/api/v1/audio/del-session'])
  })

  it('refuses cancellation when Audio has already sealed the recovered session', async () => {
    const posts: string[] = []
    const runtime = {
      config: { environment: 'test' },
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string) {
        posts.push(path)
        if (path.endsWith('get-session-by-id')) return {
          id: 'session-1', source: 2, start_at: 1_725_000_000_000,
          orig_name: 'meeting.m4a', belong_usr: 42, has_finish_spk: true,
        }
        throw new Error('sealed owner data must not be deleted')
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.deleteSession(job({ phase: 'failed', failedFromPhase: 'finalizing', sessionId: 'session-1' })))
      .rejects.toMatchObject({ code: 'recording-import-already-accepted' })
    expect(posts).toEqual(['/api/v1/audio/get-session-by-id'])
  })

  it('fails closed when a stored session checkpoint resolves to different owner data', async () => {
    const posts: string[] = []
    const runtime = {
      config: { environment: 'test' },
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string) {
        posts.push(path)
        if (path.endsWith('get-session-by-id')) return {
          id: 'session-1', source: 2, start_at: 1_725_000_000_000,
          orig_name: 'different.m4a', belong_usr: 42, has_finish_spk: false,
        }
        throw new Error('conflicting owner data must not be deleted')
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.deleteSession(job({ sessionId: 'session-1' })))
      .rejects.toMatchObject({ code: 'recording-import-session-conflict' })
    expect(posts).toEqual(['/api/v1/audio/get-session-by-id'])
  })

  it('fails closed when response-loss recovery finds more than one exact session', async () => {
    const runtime = {
      config: { environment: 'test' },
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string) {
        if (path.endsWith('get-session-ls')) return { session_ls: ['a', 'b'].map(id => ({
          id, source: 2, operate_at: 1_725_000_000_100,
          start_at: 1_725_000_000_000, orig_name: 'meeting.m4a', belong_usr: 42,
        })) }
        throw new Error('ambiguous recovery must not create a new session')
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.ensureSession(job()))
      .rejects.toMatchObject({ code: 'recording-import-session-ambiguous' })
  })

  it('fails closed when the bounded same-timestamp recovery window is exhausted', async () => {
    const runtime = {
      config: { environment: 'test' },
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string) {
        if (path.endsWith('get-session-ls')) return { session_ls: Array.from({ length: 500 }, (_, index) => ({
          id: `other-${String(index)}`, source: 2, operate_at: index,
          start_at: 1_725_000_000_000, orig_name: `other-${String(index)}.m4a`, belong_usr: 42,
        })) }
        throw new Error('incomplete recovery must not create a new session')
      },
    } as unknown as ServiceRuntime
    const gateway = new AudioRecordingImportGateway(runtime)

    await expect(gateway.ensureSession(job())).rejects.toMatchObject({
      code: 'recording-import-session-recovery-incomplete', retryable: true,
    })
  })

  it('cancels the OSS multipart operation immediately when the job is aborted', async () => {
    const runtime = {
      config: { environment: 'test' },
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedAudioPost(path: string) {
        if (path.endsWith('get-sts-token')) return {
          access_key_id: 'key', access_key_secret: 'secret', security_token: 'token',
          expiration: '2099-01-01T00:00:00.000Z',
        }
        return {}
      },
    } as unknown as ServiceRuntime
    const cancel = vi.fn()
    const multipartUpload = vi.fn(async () => await new Promise<never>(() => undefined))
    const gateway = new AudioRecordingImportGateway(runtime, () => ({ multipartUpload, cancel }))
    const controller = new AbortController()
    const uploading = gateway.upload(job({ sessionId: 'session-1', childId: 'child-1' }), async () => undefined, controller.signal)

    controller.abort()
    await expect(uploading).rejects.toMatchObject({ code: 'recording-import-cancelled' })
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
