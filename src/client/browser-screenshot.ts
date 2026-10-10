export interface ScreenshotFrame { blob: Blob; width: number; height: number }
export interface ScreenshotRect { x: number; y: number; width: number; height: number }

export function isArkmeDesktopScreenshotRuntime(): boolean {
  const desktop = (globalThis as { arkmeDesktop?: { appVersion?: string; harnessVersion?: string } }).arkmeDesktop
  return !!(desktop?.appVersion || desktop?.harnessVersion)
}

export function browserScreenshotUnavailable(): string | undefined {
  if (!globalThis.isSecureContext) return '当前页面不支持安全截屏，请使用 HTTPS 或本地预览地址。也可以系统截屏后粘贴。'
  if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') return '当前浏览器不支持选屏截屏，请在 Chrome 或 Edge 中打开，或使用系统截屏后粘贴。'
  return undefined
}

export function screenshotErrorMessage(error: unknown): string {
  const exception = error instanceof Error || error instanceof DOMException ? error : undefined
  const name = exception?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return '未获得屏幕共享授权。请重新点击截屏并选择屏幕或窗口；若内置浏览器不支持，请用 Chrome 或 Edge 打开，或系统截屏后粘贴。'
  if (name === 'NotReadableError') return '无法读取所选屏幕，请检查系统屏幕录制权限，或重新选择一个窗口。'
  if (name === 'InvalidStateError') return '无法启动选屏，请回到当前页面重新点击截屏。'
  if (name === 'NotFoundError') return '没有可截取的屏幕或窗口，请使用系统截屏后粘贴。'
  if (name === 'NotSupportedError') return '当前浏览器无法启动屏幕共享，请用 Chrome 或 Edge 打开，或使用系统截屏后粘贴。'
  return exception?.message || '截屏失败，请重试或使用系统截屏后粘贴。'
}

/** Abort promptly, but still release media if a non-cancellable chooser resolves later. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('已取消截屏', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob)
    else reject(new Error('未能生成截图，请缩小选区后重试。'))
  }, 'image/png'))
}

export async function captureBrowserScreenshot(signal: AbortSignal): Promise<ScreenshotFrame> {
  signal.throwIfAborted()
  const unavailable = browserScreenshotUnavailable()
  if (unavailable) throw new Error(unavailable)
  // Must be invoked in the click's activation, before any awaited capability request.
  const pending = navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
  const stop = (stream: MediaStream) => stream.getTracks().forEach(track => track.stop())
  void pending.then(stream => { if (signal.aborted) stop(stream) }, () => {})
  const stream = await abortable(pending, signal)
  const release = () => stop(stream)
  signal.addEventListener('abort', release, { once: true })
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    signal.throwIfAborted()
    video.srcObject = stream
    await abortable(Promise.race([
      video.play(),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('读取屏幕超时，请重新截屏。')), 10_000) }),
    ]), signal)
    signal.throwIfAborted()
    const width = video.videoWidth, height = video.videoHeight
    if (!width || !height || stream.getVideoTracks()[0]?.readyState === 'ended') throw new DOMException('无法读取所选画面', 'NotReadableError')
    // Bound canvas memory for extreme virtual desktops; preserve aspect ratio.
    const scale = Math.min(1, 8192 / width, 8192 / height, Math.sqrt(32_000_000 / (width * height)))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法处理截图，请使用系统截屏后粘贴。')
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    release() // No live screen sharing while encoding or editing the still image.
    video.srcObject = null
    const blob = await abortable(canvasPng(canvas), signal)
    return { blob, width: canvas.width, height: canvas.height }
  } finally {
    clearTimeout(timer)
    release()
    video.srcObject = null
    signal.removeEventListener('abort', release)
  }
}

/** Normalized selection, clamped to the actual image rather than its letterbox. */
export function screenshotSelection(a: { x: number; y: number }, b: { x: number; y: number }): ScreenshotRect {
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  const x = Math.min(clamp(a.x), clamp(b.x)), y = Math.min(clamp(a.y), clamp(b.y))
  return { x, y, width: Math.max(clamp(a.x), clamp(b.x)) - x, height: Math.max(clamp(a.y), clamp(b.y)) - y }
}

export function screenshotPixelRect(rect: ScreenshotRect, width: number, height: number): ScreenshotRect {
  const x = Math.max(0, Math.min(width - 1, Math.floor(rect.x * width)))
  const y = Math.max(0, Math.min(height - 1, Math.floor(rect.y * height)))
  return { x, y, width: Math.max(1, Math.min(width, Math.ceil((rect.x + rect.width) * width)) - x),
    height: Math.max(1, Math.min(height, Math.ceil((rect.y + rect.height) * height)) - y) }
}

export async function cropScreenshot(image: HTMLImageElement, frame: ScreenshotFrame, rect: ScreenshotRect): Promise<Blob> {
  const pixels = screenshotPixelRect(rect, frame.width, frame.height)
  const canvas = document.createElement('canvas')
  canvas.width = pixels.width; canvas.height = pixels.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法裁剪截图，请使用整张图片或重试。')
  context.drawImage(image, pixels.x, pixels.y, pixels.width, pixels.height, 0, 0, pixels.width, pixels.height)
  return await canvasPng(canvas)
}
