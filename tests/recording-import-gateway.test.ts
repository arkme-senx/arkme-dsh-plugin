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

describe('AudioRecordingImportGateway', () => {
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
