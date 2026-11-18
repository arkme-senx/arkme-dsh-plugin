import { arkmeAuthStore } from './auth-store.js'

type VideoPreviewFrame = { poster: string; duration: number; expiresAt: number }
const frames = new Map<string, VideoPreviewFrame>()
const capacity = 32
const maxPosterLength = 128 * 1024
const lifetime = 5 * 60_000

export function videoPreviewAccountKey(): string | undefined {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' && auth.userId !== undefined ? `${auth.environment}:${auth.userId}` : undefined
}

// One renderer-lifetime subscription; no media elements, timers or network work.
let accountKey = videoPreviewAccountKey()
arkmeAuthStore.subscribe(() => {
  const next = videoPreviewAccountKey()
  if (accountKey !== next) { frames.clear(); accountKey = next }
})

export function videoPreviewFrame(scope: string | undefined, src: string): VideoPreviewFrame | undefined {
  if (scope === undefined || scope !== accountKey) return undefined
  const frame = frames.get(src)
  if (frame && frame.expiresAt <= Date.now()) { frames.delete(src); return undefined }
  return frame
}

export function forgetVideoPreviewFrame(scope: string | undefined, src: string): void {
  if (scope !== undefined && scope === accountKey) frames.delete(src)
}

export function rememberVideoPreviewFrame(scope: string | undefined, src: string, video: HTMLVideoElement): void {
  if (scope === undefined || scope !== accountKey || video.readyState < 2 || video.seeking
    || !Number.isFinite(video.duration) || video.duration <= 0 || video.videoWidth <= 0 || video.videoHeight <= 0
    || typeof document === 'undefined' || videoPreviewFrame(scope, src)) return
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight))
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
  try {
    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const poster = canvas.toDataURL('image/jpeg', 0.7)
    if (!poster.startsWith('data:image/jpeg;') || poster.length > maxPosterLength) return
    frames.set(src, { poster, duration: video.duration, expiresAt: Date.now() + lifetime })
    while (frames.size > capacity) frames.delete(frames.keys().next().value!)
  } catch {
    // Cross-origin media may forbid pixel access; keep the ordinary video preview.
  } finally {
    canvas.width = canvas.height = 0
  }
}
