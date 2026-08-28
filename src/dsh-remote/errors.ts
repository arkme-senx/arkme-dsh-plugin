export type DshRemoteErrorCode =
  | 'REMOTE_LOGIN_REQUIRED'
  | 'RUNTIME_OFFLINE'
  | 'RUNTIME_LIMIT_REACHED'
  | 'HOST_CHANNEL_NOT_READY'
  | 'CAPABILITY_UNSUPPORTED'
  | 'WORKSPACE_UNAVAILABLE'
  | 'SESSION_NOT_FOUND'
  | 'COMMAND_EXPIRED'
  | 'COMMAND_OUTCOME_UNKNOWN'
  | 'INTERACTION_RESOLVED'
  | 'CONNECTION_REPLACED'
  | 'HOST_GENERATION_STALE'
  | 'SESSION_STATE_CHANGED'
  | 'REPLAY_GAP'
  | 'REMOTE_PROTOCOL_UNSUPPORTED'
  | 'REMOTE_REQUEST_INVALID'
  | 'REMOTE_INVALID_RESPONSE'
  | 'REMOTE_NOT_FOUND'
  | 'REMOTE_PROJECTION_CONFLICT'
  | 'REMOTE_REALTIME_UNAVAILABLE'
  | 'REMOTE_NETWORK_UNAVAILABLE'
  | 'REMOTE_STORAGE_FAILED'
  | 'REMOTE_TRANSPORT_FAILED'

export class DshRemoteError extends Error {
  constructor(
    readonly code: DshRemoteErrorCode,
    message: string,
    readonly retryable = false,
    readonly details: Record<string, unknown> = {},
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'DshRemoteError'
  }
}

export function asDshRemoteError(error: unknown): DshRemoteError {
  if (error instanceof DshRemoteError) return error
  return new DshRemoteError(
    'REMOTE_TRANSPORT_FAILED',
    error instanceof Error && error.message.trim() !== '' ? error.message : '远程连接暂时不可用',
    true,
    {},
    { cause: error },
  )
}
