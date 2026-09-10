/** Shared Browser/Host diagnostics. Never log raw refs, URLs, error messages or credentials. */
export interface ArkmeAvatarDiagnosticContext {
  environment?: 'prod' | 'test'
  viewerUserId?: number
  targetUserId?: number
  targetUserIds?: readonly number[]
  referenceKind?: 'profile' | 'media' | 'other'
  referenceViewerUserId?: number
  referenceTargetUserId?: number
  trigger?: 'load' | 'revalidate'
  hasCachedImage?: boolean
  durationMillis?: number
}

type AvatarDiagnosticEvent = 'image_load_failed' | 'image_read_failed'
  | 'profile_fetch_failed' | 'profile_avatar_rejected' | 'profile_missing' | 'private_avatar_seal_failed'

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function positiveId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/** Decoded IDs are diagnostic hints only, never authentication or authorization inputs. */
export function avatarReferenceDiagnostic(imageRef: string): ArkmeAvatarDiagnosticContext {
  const ref = imageRef.trim()
  if (!ref.startsWith('arkme-profile-image-v1.')) {
    return { referenceKind: ref.startsWith('arkme-media-v1.') ? 'media' : 'other' }
  }
  const context: ArkmeAvatarDiagnosticContext = { referenceKind: 'profile' }
  try {
    const parts = ref.split('.')
    const encoded = parts[1] ?? ''
    if (parts.length !== 3 || encoded.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return context
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const payload = record(JSON.parse(globalThis.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))))
    if (payload.version !== 1) return context
    const viewer = positiveId(payload.viewerUserId)
    const target = positiveId(payload.targetUserId)
    if (viewer !== undefined) context.referenceViewerUserId = viewer
    if (target !== undefined) context.referenceTargetUserId = target
  } catch { /* Malformed references must not break the original failure path. */ }
  return context
}

export function avatarScopeDiagnostic(scopeKey: string | undefined): ArkmeAvatarDiagnosticContext {
  const match = /^(prod|test):([1-9][0-9]*)$/.exec(scopeKey ?? '')
  const viewerUserId = positiveId(Number(match?.[2]))
  return match === null || viewerUserId === undefined ? {} : {
    environment: match[1] as 'prod' | 'test', viewerUserId,
  }
}

function safeErrorCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^(?:(?:arkme|image|auth-http|local|profile)-[A-Za-z0-9_-]{1,80}|UND_ERR_[A-Z_]{1,64}|E[A-Z_]{1,64})$/.test(value)
    ? value : undefined
}

function httpStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined
}

function imageDownloadStatus(error: Record<string, unknown>): number | undefined {
  // The image downloader currently puts its upstream status only in this fixed message.
  // Extract the number without logging free-form text or changing error/retry semantics.
  if (error.name !== 'ArkmePluginError' || error.code !== 'image-download-failed' || typeof error.message !== 'string') return undefined
  const match = /^Arkme 图片读取返回 HTTP ([1-5][0-9]{2})$/.exec(error.message)
  return match === null ? undefined : httpStatus(Number(match[1]))
}

export function logArkmeAvatarDiagnostic(
  event: AvatarDiagnosticEvent,
  context: ArkmeAvatarDiagnosticContext,
  error?: unknown,
): void {
  try {
    const source = record(error)
    const body = record(source.body)
    const detail = source.name === 'ArkmeClientError' ? body : source
    const errorName = ['Error', 'TypeError', 'AbortError', 'TimeoutError', 'ArkmePluginError', 'ArkmeClientError']
      .includes(String(source.name)) ? String(source.name) : 'unknown'
    // Serialize first: the desktop bridge otherwise records objects as [object Object].
    console.warn(`[ArkmeAvatarDiag] ${JSON.stringify({
      timestamp: new Date().toISOString(), event, ...context,
      ...(error === undefined ? {} : { error: {
        name: errorName,
        code: safeErrorCode(detail.code),
        retryable: typeof detail.retryable === 'boolean' ? detail.retryable : undefined,
        httpStatus: httpStatus(source.httpStatus),
        upstreamStatus: httpStatus(source.upstreamStatus) ?? imageDownloadStatus(source),
        causeCode: safeErrorCode(record(source.cause).code),
      } }),
    })}`)
  } catch { /* Diagnostics must never replace the original result or error. */ }
}
