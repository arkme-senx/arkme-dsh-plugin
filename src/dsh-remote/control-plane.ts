import { DshRemoteError, type DshRemoteErrorCode } from './errors.js'
import type { DshRemoteControlPlane } from './types.js'

const BASE = '/api/v1/dsh-remote'

export interface DshRemoteHttpRequester {
  post(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>
}

function pathRef(value: string): string {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(normalized)) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '远控资源引用无效')
  return encodeURIComponent(normalized)
}

export class DshRemoteHttpControlPlane implements DshRemoteControlPlane {
  constructor(private readonly request: DshRemoteHttpRequester) {}

  private async post(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    try { return await this.request.post(path, body, signal) }
    catch (error) { throw mapDshRemoteControlPlaneError(error) }
  }

  async registerDesktop(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return await this.post(`${BASE}/desktops/register`, input, signal)
  }

  async registerRuntime(desktopRef: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return await this.post(`${BASE}/desktops/${pathRef(desktopRef)}/runtimes/register`, input, signal)
  }

  async syncWorkspaces(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return await this.post(`${BASE}/workspaces/sync`, input, signal)
  }

  async syncSessions(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return await this.post(`${BASE}/sessions/sync`, input, signal)
  }

  async appendSessionEvents(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return await this.post(`${BASE}/session-events/append`, input, signal)
  }

  async sessionEventSyncStatuses(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return await this.post(`${BASE}/session-events/status`, input, signal)
  }

  async completeSessionEventHistory(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return await this.post(`${BASE}/session-events/complete`, input, signal)
  }

  async syncSessionTurns(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return await this.post(`${BASE}/session-turns/sync`, input, signal)
  }

  async completeSessionTurnHistory(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return await this.post(`${BASE}/session-turns/complete`, input, signal)
  }

}

export function mapDshRemoteControlPlaneError(error: unknown): DshRemoteError {
  if (error instanceof DshRemoteError) return error
  const code = error !== null && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code : ''
  const canonical = new Set<DshRemoteErrorCode>([
    'REMOTE_PROTOCOL_UNSUPPORTED', 'REMOTE_REQUEST_INVALID', 'REMOTE_INVALID_RESPONSE',
    'REMOTE_NETWORK_UNAVAILABLE', 'REMOTE_STORAGE_FAILED', 'REMOTE_TRANSPORT_FAILED',
    'REMOTE_LOGIN_REQUIRED', 'RUNTIME_OFFLINE', 'RUNTIME_LIMIT_REACHED',
    'HOST_CHANNEL_NOT_READY', 'HOST_GENERATION_STALE', 'REPLAY_GAP', 'CAPABILITY_UNSUPPORTED',
    'REMOTE_NOT_FOUND', 'REMOTE_PROJECTION_CONFLICT', 'REMOTE_REALTIME_UNAVAILABLE',
  ])
  const mappedCode = canonical.has(code as DshRemoteErrorCode) ? code as DshRemoteErrorCode : 'REMOTE_TRANSPORT_FAILED'
  return new DshRemoteError(
    mappedCode,
    error instanceof Error ? error.message : '远控控制面请求失败',
    ['REMOTE_NETWORK_UNAVAILABLE', 'REMOTE_TRANSPORT_FAILED', 'RUNTIME_OFFLINE',
      'HOST_CHANNEL_NOT_READY', 'HOST_GENERATION_STALE', 'REPLAY_GAP',
      'REMOTE_REALTIME_UNAVAILABLE'].includes(mappedCode),
    {}, { cause: error },
  )
}
