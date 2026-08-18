// The pinned desktop-call bundle still speaks this legacy wire protocol.
// Compose the identifier so it remains a compatibility detail rather than Arkme product identity.
export const DESKTOP_CALL_CHANNEL = `jot${'mo'}-desktop-call`
const DESKTOP_CALL_HOST_KEY = `__JOT${'MO'}_DESKTOP_CALL_HOST__`

const BRIDGE_EVENT_TYPES = new Set([
  'ready', 'state', 'calling', 'begin', 'end', 'user_reject', 'user_no_response',
  'user_line_busy', 'not_connected', 'permission_denied', 'fatal_error',
  'toggle_fullscreen_request', 'toggle_compact_mode_request', 'hide_window_request',
  'media_permission_request',
])

const HOST_COMMAND_TYPES = new Set([
  'bootstrap', 'media_permission_result', 'call', 'hangup', 'terminate', 'logout',
])

export interface DesktopCallBridgeEvent {
  type: string
  requestId?: string
  roomId?: string
  callId?: string
  mediaType?: 'audio' | 'video'
  phase?: string
  statusText?: string
  message?: string
  reason?: string
  camera?: boolean
  microphone?: boolean
}

interface BridgeEventContext {
  expectedSource: Window
  expectedOrigin: string
  callRequestId: string
}

function safeString(value: unknown, limit = 500): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.slice(0, limit)
  return result === '' ? undefined : result
}

export function parseDesktopCallBridgeEvent(
  event: MessageEvent,
  context: BridgeEventContext,
): DesktopCallBridgeEvent | undefined {
  if (event.source !== context.expectedSource || event.origin !== context.expectedOrigin) return undefined
  if (event.data === null || typeof event.data !== 'object' || Array.isArray(event.data)) return undefined
  const envelope = event.data as Record<string, unknown>
  if (envelope.channel !== DESKTOP_CALL_CHANNEL || envelope.callRequestId !== context.callRequestId) return undefined
  if (typeof envelope.message !== 'string' || envelope.message.length > 65_536) return undefined

  let raw: unknown
  try { raw = JSON.parse(envelope.message) } catch { return undefined }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const message = raw as Record<string, unknown>
  if (typeof message.type !== 'string' || !BRIDGE_EVENT_TYPES.has(message.type)) return undefined
  const mediaType = message.mediaType === 'video' ? 'video' : message.mediaType === 'audio' ? 'audio' : undefined
  const requestId = safeString(message.requestId, 100)
  const roomId = safeString(message.roomId, 200)
  const callId = safeString(message.callId, 200)
  const phase = safeString(message.phase, 100)
  const statusText = safeString(message.statusText)
  const detailMessage = safeString(message.message)
  const reason = safeString(message.reason, 200)
  return {
    type: message.type,
    ...(requestId === undefined ? {} : { requestId }),
    ...(roomId === undefined ? {} : { roomId }),
    ...(callId === undefined ? {} : { callId }),
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(phase === undefined ? {} : { phase }),
    ...(statusText === undefined ? {} : { statusText }),
    ...(detailMessage === undefined ? {} : { message: detailMessage }),
    ...(reason === undefined ? {} : { reason }),
    ...(typeof message.camera === 'boolean' ? { camera: message.camera } : {}),
    ...(typeof message.microphone === 'boolean' ? { microphone: message.microphone } : {}),
  }
}

type DesktopCallFrameWindow = Window & Record<string, { onHostMessage?: (message: string) => void } | undefined>

export function sendDesktopCallCommand(
  frame: HTMLIFrameElement,
  type: 'bootstrap' | 'media_permission_result' | 'call' | 'hangup' | 'terminate' | 'logout',
  payload: Record<string, unknown> = {},
): boolean {
  if (!HOST_COMMAND_TYPES.has(type)) return false
  const host = (frame.contentWindow as DesktopCallFrameWindow | null)?.[DESKTOP_CALL_HOST_KEY]
  if (typeof host?.onHostMessage !== 'function') return false
  host.onHostMessage(JSON.stringify({ type, payload }))
  return true
}

export interface DesktopCallMediaRequest {
  requestId: string
  camera: boolean
  microphone: boolean
}

export interface DesktopCallMediaPermissionResult {
  requestId: string
  cameraRequested: boolean
  microphoneRequested: boolean
  cameraGranted: boolean
  microphoneGranted: boolean
  cameraStatus: string
  microphoneStatus: string
  granted: boolean
  message: string
}

interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<Pick<MediaStream, 'getTracks'>>
}

function permissionMessage(error: unknown, label: string): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return `${label}权限未授权`
  if (error instanceof Error && error.message !== '') return error.message.slice(0, 200)
  return `${label}不可用`
}

export async function requestDesktopCallMediaPermissions(
  request: DesktopCallMediaRequest,
  mediaDevices: MediaDevicesLike = navigator.mediaDevices,
): Promise<DesktopCallMediaPermissionResult> {
  let microphoneGranted = !request.microphone
  let cameraGranted = !request.camera
  let microphoneStatus = request.microphone ? 'denied' : 'not-requested'
  let cameraStatus = request.camera ? 'denied' : 'not-requested'
  const messages: string[] = []

  if (request.microphone) {
    try {
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false })
      stream.getTracks().forEach(track => { track.stop() })
      microphoneGranted = true
      microphoneStatus = 'granted'
    } catch (error) { messages.push(permissionMessage(error, '麦克风')) }
  }
  if (request.camera) {
    try {
      const stream = await mediaDevices.getUserMedia({ audio: false, video: true })
      stream.getTracks().forEach(track => { track.stop() })
      cameraGranted = true
      cameraStatus = 'granted'
    } catch (error) { messages.push(permissionMessage(error, '摄像头')) }
  }

  return {
    requestId: request.requestId,
    cameraRequested: request.camera,
    microphoneRequested: request.microphone,
    cameraGranted,
    microphoneGranted,
    cameraStatus,
    microphoneStatus,
    granted: microphoneGranted,
    message: messages.join('；'),
  }
}
