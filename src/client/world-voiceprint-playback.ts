export interface WorldVoiceprintPlaybackChunkLike {
  chunkIndex: number
  chunkCount: number
}

export interface WorldVoiceprintAudioDownloadOptions {
  fetchImpl?: typeof fetch
  maxAttempts?: number
  timeoutMillis?: number
}

class WorldVoiceprintMediaResponseError extends Error {
  constructor(readonly retryable: boolean) {
    super('声纹音频加载失败，请重试')
    this.name = 'WorldVoiceprintMediaResponseError'
  }
}

function hasAscii(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset + value.length > bytes.byteLength) return false
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false
  }
  return true
}

/**
 * Some upstream TTS responses are complete WAV files whose RIFF/data sizes
 * still contain the streaming sentinel 0x7fffffff. Native mobile players are
 * lenient about that header, while Chromium can finish loading the Blob and
 * then never start playback. Repair only impossible sizes using the bytes we
 * have already downloaded; ordinary WAV files and every other format remain
 * untouched.
 */
export function normalizeWorldVoiceprintAudioBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength < 12 || !hasAscii(bytes, 0, 'RIFF') || !hasAscii(bytes, 8, 'WAVE')) {
    return bytes
  }

  const sourceView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const actualRiffSize = bytes.byteLength - 8
  if (actualRiffSize > 0xffff_ffff) return bytes
  let normalized: Uint8Array | undefined
  const output = () => {
    normalized ??= Uint8Array.from(bytes)
    return new DataView(normalized.buffer, normalized.byteOffset, normalized.byteLength)
  }

  if (sourceView.getUint32(4, true) !== actualRiffSize) {
    output().setUint32(4, actualRiffSize, true)
  }

  let chunkOffset = 12
  while (chunkOffset + 8 <= bytes.byteLength) {
    const declaredSize = sourceView.getUint32(chunkOffset + 4, true)
    const availableSize = bytes.byteLength - chunkOffset - 8
    if (hasAscii(bytes, chunkOffset, 'data')) {
      if (declaredSize > availableSize) output().setUint32(chunkOffset + 4, availableSize, true)
      break
    }
    if (declaredSize > availableSize) break
    chunkOffset += 8 + declaredSize + (declaredSize % 2)
  }

  return normalized ?? bytes
}

/**
 * Downloads the complete short-lived audio response before playback. This is
 * the browser equivalent of the mobile client writing each chunk to a local
 * file, and makes the next-chunk prefetch deterministic instead of relying on
 * an HTMLAudioElement's best-effort preload hint.
 */
export async function downloadWorldVoiceprintAudio(
  url: string,
  signal: AbortSignal,
  options: WorldVoiceprintAudioDownloadOptions = {},
): Promise<Blob> {
  const fetchImpl = options.fetchImpl ?? fetch
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? 2))
  const timeoutMillis = Math.max(1, Math.trunc(options.timeoutMillis ?? 20_000))
  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal.aborted) throw signal.reason ?? new Error('声纹播放已停止')
    const controller = new AbortController()
    const onAbort = () => { controller.abort(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
    const timeout = setTimeout(() => {
      controller.abort(new Error('声纹音频加载超时'))
    }, timeoutMillis)
    try {
      const response = await fetchImpl(url, {
        credentials: 'same-origin',
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new WorldVoiceprintMediaResponseError(
          response.status === 408 || response.status === 429 || response.status >= 500,
        )
      }
      const blob = await response.blob()
      if (blob.size <= 0 || (blob.type !== '' && !blob.type.toLowerCase().startsWith('audio/'))) {
        throw new WorldVoiceprintMediaResponseError(true)
      }
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const normalized = normalizeWorldVoiceprintAudioBytes(bytes)
      const normalizedBuffer = normalized === bytes ? undefined : new ArrayBuffer(normalized.byteLength)
      if (normalizedBuffer !== undefined) new Uint8Array(normalizedBuffer).set(normalized)
      return normalized === bytes
        ? blob
        : new Blob([normalizedBuffer!], { type: 'audio/wav' })
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error
      lastError = error
      const retryable = controller.signal.aborted
        || error instanceof TypeError
        || (error instanceof WorldVoiceprintMediaResponseError && error.retryable)
      if (!retryable || attempt + 1 >= maxAttempts) break
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
    }
  }

  throw new Error('声纹音频加载失败，请重试', { cause: lastError })
}

export interface WorldVoiceprintPlaybackQueueOptions<TChunk extends WorldVoiceprintPlaybackChunkLike> {
  loadChunk(chunkIndex: number): Promise<TChunk>
  playChunk(chunk: TChunk): Promise<void>
  isActive(): boolean
}

/**
 * Resolves when one prepared audio element finishes, but reports readiness
 * only after Chromium confirms that playback actually started.
 */
export async function playPreparedWorldVoiceprintAudio(
  audio: HTMLAudioElement,
  signal: AbortSignal,
  onStarted: () => void,
  startTimeoutMillis = 8_000,
): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let started = false
    const startTimeout = setTimeout(() => {
      finish(new Error('声纹音频未能开始播放，请重试'))
    }, Math.max(1, Math.trunc(startTimeoutMillis)))
    const cleanup = () => {
      clearTimeout(startTimeout)
      audio.onended = null
      audio.onerror = null
      audio.onplaying = null
      audio.ontimeupdate = null
      signal.removeEventListener('abort', onAbort)
    }
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      if (error === undefined) resolve()
      else reject(error)
    }
    const markStarted = () => {
      if (started || settled) return
      started = true
      clearTimeout(startTimeout)
      try { onStarted() } catch (error) { finish(error) }
    }
    const onAbort = () => { finish() }
    signal.addEventListener('abort', onAbort, { once: true })
    audio.onplaying = markStarted
    audio.ontimeupdate = markStarted
    audio.onended = () => { finish() }
    audio.onerror = () => { finish(new Error('声纹音频播放失败，请重试')) }
    void audio.play().then(() => {
      if (!audio.paused) markStarted()
    }, finish)
  })
}

type SettledChunk<TChunk> =
  | { ok: true; chunk: TChunk }
  | { ok: false; error: unknown }

function settleChunk<TChunk>(promise: Promise<TChunk>): Promise<SettledChunk<TChunk>> {
  return promise.then(
    chunk => ({ ok: true, chunk }),
    error => ({ ok: false, error }),
  )
}

/**
 * Plays server-projected World voiceprint chunks in order while loading the
 * next chunk during the current chunk's playback.
 */
export async function playWorldVoiceprintChunkQueue<TChunk extends WorldVoiceprintPlaybackChunkLike>(
  options: WorldVoiceprintPlaybackQueueOptions<TChunk>,
): Promise<'completed' | 'cancelled'> {
  let current = await options.loadChunk(0)
  while (options.isActive()) {
    const nextIndex = current.chunkIndex + 1
    const next = nextIndex < current.chunkCount
      ? settleChunk(options.loadChunk(nextIndex))
      : undefined

    await options.playChunk(current)
    if (!options.isActive()) return 'cancelled'
    if (next === undefined) return 'completed'

    const settled = await next
    if (!options.isActive()) return 'cancelled'
    if (!settled.ok) throw settled.error
    current = settled.chunk
  }
  return 'cancelled'
}
