import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { forgetVideoPreviewFrame, rememberVideoPreviewFrame, videoPreviewFrame } from '../src/client/video-preview-frame.js'

const scope = 'test:42'
const video = { readyState: 2, seeking: false, duration: 12, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement
function canvasFixture(poster = 'data:image/jpeg;base64,frame') {
  const drawImage = vi.fn()
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL: vi.fn(() => poster) }
  vi.stubGlobal('document', { createElement: () => canvas })
  return { canvas, drawImage }
}
beforeEach(() => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 }) })
afterEach(() => { arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' }); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('bounded video thumbnails', () => {
  it('stores a 320px still, releases the canvas and skips repeat pixel work', () => {
    const { canvas, drawImage } = canvasFixture()
    rememberVideoPreviewFrame(scope, 'media-one', video)
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 320, 180)
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
    expect(videoPreviewFrame(scope, 'media-one')).toMatchObject({ poster: 'data:image/jpeg;base64,frame', duration: 12 })
    rememberVideoPreviewFrame(scope, 'media-one', video)
    expect(drawImage).toHaveBeenCalledOnce()
  })

  it('evicts at 32 frames and expires after five minutes without a timer', () => {
    vi.useFakeTimers()
    canvasFixture()
    for (let index = 0; index <= 32; index++) rememberVideoPreviewFrame(scope, `media-${index}`, video)
    expect(videoPreviewFrame(scope, 'media-0')).toBeUndefined()
    expect(videoPreviewFrame(scope, 'media-1')).toBeDefined()
    expect(videoPreviewFrame(scope, 'media-32')).toBeDefined()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(5 * 60_000)
    expect(videoPreviewFrame(scope, 'media-32')).toBeUndefined()
  })

  it('clears on logout, account and environment changes and ignores stale capture callbacks', () => {
    canvasFixture()
    rememberVideoPreviewFrame(scope, 'media-one', video)
    for (const auth of [
      { status: 'authenticated' as const, environment: 'test' as const, userId: 99 },
      { status: 'authenticated' as const, environment: 'prod' as const, userId: 42 },
      { status: 'logged-out' as const, environment: 'test' as const },
    ]) {
      arkmeAuthStore.setAuth(auth)
      rememberVideoPreviewFrame(scope, 'late-event', video)
      expect(videoPreviewFrame(scope, 'media-one')).toBeUndefined()
      arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
      expect(videoPreviewFrame(scope, 'media-one')).toBeUndefined()
      expect(videoPreviewFrame(scope, 'late-event')).toBeUndefined()
      rememberVideoPreviewFrame(scope, 'media-one', video)
    }
    forgetVideoPreviewFrame(scope, 'media-one')
    expect(videoPreviewFrame(scope, 'media-one')).toBeUndefined()
  })

  it('does not capture unfinished, anonymous or oversized frames', () => {
    const { canvas } = canvasFixture()
    rememberVideoPreviewFrame(undefined, 'anonymous', video)
    rememberVideoPreviewFrame(scope, 'seeking', { ...video, seeking: true })
    rememberVideoPreviewFrame(scope, 'metadata-only', { ...video, readyState: 1 })
    expect(canvas.toDataURL).not.toHaveBeenCalled()
    canvas.toDataURL.mockReturnValue(`data:image/jpeg;base64,${'a'.repeat(128 * 1024)}`)
    rememberVideoPreviewFrame(scope, 'large', video)
    expect(videoPreviewFrame(scope, 'large')).toBeUndefined()
  })

  it('falls back cleanly when canvas access is denied', () => {
    const { canvas } = canvasFixture()
    canvas.toDataURL.mockImplementation(() => { throw new DOMException('Tainted canvas', 'SecurityError') })
    expect(() => rememberVideoPreviewFrame(scope, 'cross-origin', video)).not.toThrow()
    expect(videoPreviewFrame(scope, 'cross-origin')).toBeUndefined()
    expect(canvas.width).toBe(0)
  })
})
