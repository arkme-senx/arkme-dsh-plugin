import { describe, expect, it, vi } from 'vitest'
import { DshRemoteHttpControlPlane, mapDshRemoteControlPlaneError } from '../src/dsh-remote/control-plane.js'

describe('Backend login-only DSH remote control plane', () => {
  it('uses only desktop, Runtime, canonical history, and completed Turn endpoints', async () => {
    const post = vi.fn(async (path: string, body: Record<string, unknown>) => ({ path, ...body }))
    const plane = new DshRemoteHttpControlPlane({ post })
    await plane.registerDesktop({ display_name: 'Work Mac', platform: 'darwin' })
    await plane.registerRuntime('desktop-01', { profile_ref: 'web' })
    await plane.syncWorkspaces({ runtime_ref: 'runtime-01', items: [] })
    await plane.syncSessions({ runtime_ref: 'runtime-01', items: [] })
    await plane.completeProjectionSnapshot({ runtime_ref: 'runtime-01', snapshot_ref: 'snapshot-1' })
    await plane.appendSessionEvents({ runtime_ref: 'runtime-01', entries: [] })
    await plane.sessionEventSyncStatuses({ runtime_ref: 'runtime-01', session_refs: ['session-01'] })
    await plane.completeSessionEventHistory({
      runtime_ref: 'runtime-01', host_generation: 7, session_ref: 'session-01', through_seq: 8,
    })
    await plane.syncSessionTurns({ runtime_ref: 'runtime-01', session_ref: 'session-01', turns: [] })
    await plane.completeSessionTurnHistory({
      runtime_ref: 'runtime-01', host_generation: 7, session_ref: 'session-01', through_seq: 8,
    })
    await plane.turnObjectUploadCapabilities()
    await plane.knownHistorySessions({ session_refs: ['session-01'] })
    await plane.prepareSessionTurnUpload({ runtime_ref: 'runtime-01', session_ref: 'session-01' })
    await plane.commitSessionTurnUpload({ upload_id: 'upload-01', content_sha256: 'abc' })
    await plane.completeSessionTurnObjectHistory({
      runtime_ref: 'runtime-01', host_generation: 7, session_ref: 'session-01', through_seq: 8,
      committed_turn_count: 1, last_committed_turn_ref: 'turn-1', last_committed_end_seq: 8,
    })
    expect(post.mock.calls.map(call => call[0])).toEqual([
      '/api/v1/dsh-remote/desktops/register',
      '/api/v1/dsh-remote/desktops/desktop-01/runtimes/register',
      '/api/v1/dsh-remote/workspaces/sync',
      '/api/v1/dsh-remote/sessions/sync',
      '/api/v1/dsh-remote/projections/complete',
      '/api/v1/dsh-remote/session-events/append',
      '/api/v1/dsh-remote/session-events/status',
      '/api/v1/dsh-remote/session-events/complete',
      '/api/v1/dsh-remote/session-turns/sync',
      '/api/v1/dsh-remote/session-turns/complete',
      '/api/v1/dsh-remote/session-turn-objects/capabilities',
      '/api/v1/dsh-remote/session-turn-objects/known-sessions',
      '/api/v1/dsh-remote/session-turns/prepare-upload',
      '/api/v1/dsh-remote/session-turns/commit-upload',
      '/api/v1/dsh-remote/session-turn-objects/complete',
    ])
    expect(JSON.stringify(post.mock.calls)).not.toMatch(/pairing|binding|credential|grant/)
  })

  it('preserves canonical login, Runtime, projection, and replay errors', () => {
    for (const code of [
      'REMOTE_LOGIN_REQUIRED', 'RUNTIME_OFFLINE', 'HOST_GENERATION_STALE',
      'REMOTE_NOT_FOUND', 'REMOTE_PROJECTION_CONFLICT',
      'REMOTE_REALTIME_UNAVAILABLE', 'REPLAY_GAP',
    ] as const) {
      expect(mapDshRemoteControlPlaneError(Object.assign(new Error(code), { code }))).toMatchObject({ code })
    }
    expect(mapDshRemoteControlPlaneError(new Error('unknown'))).toMatchObject({
      code: 'REMOTE_TRANSPORT_FAILED', retryable: true,
    })
    expect(mapDshRemoteControlPlaneError(Object.assign(new Error('temporary head failure'), {
      code: 'REMOTE_STORAGE_FAILED',
    }))).toMatchObject({ code: 'REMOTE_STORAGE_FAILED', retryable: true })
    expect(mapDshRemoteControlPlaneError(Object.assign(new Error('hash mismatch'), {
      code: 'REMOTE_PROJECTION_CONFLICT',
    }))).toMatchObject({ code: 'REMOTE_PROJECTION_CONFLICT', retryable: false })
  })
})
