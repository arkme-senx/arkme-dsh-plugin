// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { browserScreenshotUnavailable, captureBrowserScreenshot, cropScreenshot, isArkmeDesktopScreenshotRuntime, screenshotErrorMessage, screenshotPixelRect, screenshotSelection } from '../src/client/browser-screenshot.js'

const stop = vi.fn(), draw = vi.fn(), getDisplayMedia = vi.fn()
const track = { stop, readyState: 'live' }
const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
const controller = () => new AbortController()
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })
  getDisplayMedia.mockResolvedValue(stream)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1600)
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(900)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['png'], { type: 'image/png' })))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('uses the native path only for the Arkme desktop bridge, not generic Electron', () => {
  expect(isArkmeDesktopScreenshotRuntime()).toBe(false)
  vi.stubGlobal('arkmeDesktop', { appVersion: '1' })
  expect(isArkmeDesktopScreenshotRuntime()).toBe(true)
})
it('requires secure context and display media with an actionable fallback', () => {
  expect(browserScreenshotUnavailable()).toBeUndefined()
  vi.stubGlobal('isSecureContext', false)
  expect(browserScreenshotUnavailable()).toContain('HTTPS')
  vi.stubGlobal('isSecureContext', true); vi.stubGlobal('navigator', {})
  expect(browserScreenshotUnavailable()).toContain('系统截屏后粘贴')
})
it('opens the chooser synchronously on the click stack and stops all sharing before PNG encoding', async () => {
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => {
    expect(stop).toHaveBeenCalled()
    callback(new Blob(['png'], { type: 'image/png' }))
  })
  const pending = captureBrowserScreenshot(controller().signal)
  expect(getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: false })
  const frame = await pending
  expect(frame).toMatchObject({ width: 1600, height: 900, blob: { size: 3, type: 'image/png' } })
  expect(draw).toHaveBeenCalledOnce()
  expect((draw.mock.calls[0]![0] as HTMLVideoElement).srcObject).toBeNull()
})
it('bounds large desktop images to a safe canvas size', async () => {
  vi.mocked(Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoWidth')!.get!).mockReturnValue(24000)
  vi.mocked(Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoHeight')!.get!).mockReturnValue(12000)
  const frame = await captureBrowserScreenshot(controller().signal)
  expect(frame.width).toBeLessThanOrEqual(8192)
  expect(frame.width * frame.height).toBeLessThanOrEqual(32_010_000)
  expect(frame.width / frame.height).toBeCloseTo(2, 2)
})
it('aborts an unanswered chooser promptly and stops any stream granted later', async () => {
  let grant!: (stream: MediaStream) => void
  getDisplayMedia.mockReturnValue(new Promise<MediaStream>(resolve => { grant = resolve }))
  const abort = controller(), pending = captureBrowserScreenshot(abort.signal)
  abort.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(stop).not.toHaveBeenCalled()
  grant(stream); await Promise.resolve()
  expect(stop).toHaveBeenCalled()
  expect(draw).not.toHaveBeenCalled()
})
it('does not open a chooser for an already cancelled operation', async () => {
  const abort = controller(); abort.abort()
  await expect(captureBrowserScreenshot(abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(getDisplayMedia).not.toHaveBeenCalled()
})
it.each(['playback', 'canvas', 'encode', 'empty-frame'])('releases tracks after %s failure', async kind => {
  if (kind === 'playback') vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new Error('playback'))
  if (kind === 'canvas') vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
  if (kind === 'encode') vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => callback(null))
  if (kind === 'empty-frame') vi.mocked(Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoWidth')!.get!).mockReturnValue(0)
  await expect(captureBrowserScreenshot(controller().signal)).rejects.toHaveProperty('message')
  expect(stop).toHaveBeenCalled()
})
it('stops tracks when frame readiness times out', async () => {
  vi.useFakeTimers()
  vi.mocked(HTMLMediaElement.prototype.play).mockReturnValue(new Promise(() => {}))
  const result = expect(captureBrowserScreenshot(controller().signal)).rejects.toThrow('读取屏幕超时')
  await vi.advanceTimersByTimeAsync(10_000)
  await result; expect(stop).toHaveBeenCalled()
})
it('stops tracks promptly if cancelled during video readiness', async () => {
  vi.mocked(HTMLMediaElement.prototype.play).mockReturnValue(new Promise(() => {}))
  const abort = controller(), pending = captureBrowserScreenshot(abort.signal)
  await Promise.resolve(); abort.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(stop).toHaveBeenCalled()
})
it('normalizes reverse selection, clamps outside drags and maps scaled display to original pixels', async () => {
  const selection = screenshotSelection({ x: .75, y: .8 }, { x: .25, y: .2 })
  expect(screenshotPixelRect(selection, 1600, 900)).toEqual({ x: 400, y: 180, width: 800, height: 540 })
  expect(screenshotSelection({ x: 2, y: 2 }, { x: -1, y: -1 })).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  const image = document.createElement('img')
  await cropScreenshot(image, { blob: new Blob(), width: 1600, height: 900 }, selection)
  expect(draw).toHaveBeenCalledWith(image, 400, 180, 800, 540, 0, 0, 800, 540)
})
it.each([['NotAllowedError', '未获得屏幕共享授权'], ['NotReadableError', '系统屏幕录制权限'], ['InvalidStateError', '重新点击截屏'], ['NotFoundError', '没有可截取的屏幕'], ['NotSupportedError', 'Chrome 或 Edge']])('gives a user-facing explanation for %s', (name, message) => {
  expect(screenshotErrorMessage(new DOMException('', name))).toContain(message)
})
