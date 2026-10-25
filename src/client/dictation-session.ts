import { captureMicrophone, type MicrophoneCapture, type MicrophoneCaptureOptions } from './recordings/direct-recording-capture.js'
import { acquireDictation } from './dictation-activity.js'
import type { DictationTarget } from './dictation-target.js'
import { callArkme } from './api.js'

export type DictationPhase = 'idle' | 'starting' | 'listening' | 'finishing' | 'failed'
export interface DictationState { phase: DictationPhase; pending: number; error: string; level: number }
interface Segment { id: string; pcm: ArrayBuffer; text?: string }
export interface DictationDependencies {
  capture(options: MicrophoneCaptureOptions): Promise<MicrophoneCapture>
  transcribe(segment: Segment, signal: AbortSignal): Promise<string>
  acquire(cancel: () => void): Promise<() => void>
}
export function pcmBase64(pcm: ArrayBuffer): string {
  const bytes = new Uint8Array(pcm); let text = ''
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(text)
}

/** Bounded sentence queue; results commit in spoken order, never auto-submit. */
export class DictationSession {
  private state: DictationState = { phase: 'idle', pending: 0, error: '', level: 0 }
  private controller = new AbortController()
  private microphone?: MicrophoneCapture
  private release: (() => void) | undefined
  private parts: ArrayBuffer[] = []
  private frames = 0
  private silentFrames = 0
  private voiced = false
  private segments: Segment[] = []
  private running = false
  private stopped = false
  private closed = false
  private deps: DictationDependencies
  constructor(private target: DictationTarget, userId: number, private onState: (state: DictationState) => void, dependencies?: Partial<DictationDependencies>) {
    this.deps = {
      capture: captureMicrophone, acquire: acquireDictation,
      transcribe: async (segment, signal) => (await callArkme<{ text: string }>('dictation.transcribe', { expectedUserId: userId, segmentId: segment.id, pcm: pcmBase64(segment.pcm) }, signal)).text,
      ...dependencies,
    }
  }
  private update(patch: Partial<DictationState>) { this.state = { ...this.state, ...patch }; this.onState(this.state) }
  async start() {
    if (this.state.phase !== 'idle' || this.closed) return
    this.update({ phase: 'starting' })
    try {
      const release = await this.deps.acquire(() => this.cancel())
      if (this.closed) { release(); return }
      this.release = release
      const microphone = await this.deps.capture({ signal: this.controller.signal, maxMillis: 10 * 60_000, chunkMillis: 100,
        onReady: async rate => { if (rate !== 16000) throw new Error('麦克风采样率不受支持，请切换输入设备后重试') },
        onChunk: (pcm, level) => this.chunk(pcm, level), onInterrupted: message => { void this.stop(message) },
      })
      if (this.closed || this.stopped) { await microphone.stop(); return }
      this.microphone = microphone
      this.update({ phase: 'listening' })
    } catch (error) { if (!this.closed) this.fail(error) }
  }
  private chunk(pcm: ArrayBuffer, level: number) {
    if (this.closed || this.state.phase === 'failed') return
    // Keep a short pre-roll and all audio once speech begins; do not upload idle silence.
    if (level >= 0.006) { this.voiced = true; this.silentFrames = 0 } else this.silentFrames += pcm.byteLength / 2
    this.parts.push(pcm); this.frames += pcm.byteLength / 2
    if (!this.voiced && this.frames > 4800) { const removed = this.parts.shift(); this.frames -= (removed?.byteLength ?? 0) / 2 }
    // Audio arrives at 10 Hz; rendering only follows phrases and state changes.
    if (this.voiced && (this.frames >= 8 * 16000 || this.silentFrames >= 0.8 * 16000)) this.flush()
  }
  private flush() {
    if (this.voiced && this.frames >= 1600) {
      const pcm = new Uint8Array(this.frames * 2); let offset = 0
      for (const part of this.parts) { pcm.set(new Uint8Array(part), offset); offset += part.byteLength }
      this.segments.push({ id: crypto.randomUUID(), pcm: pcm.buffer })
      this.update({ pending: this.segments.length })
    }
    this.parts = []; this.frames = 0; this.voiced = false; this.silentFrames = 0
    if (this.segments.length >= 5) void this.stop('识别暂时较慢，已暂停采集；请等待当前语音识别完成')
    void this.drain()
  }
  private async drain() {
    if (this.running || this.closed || this.state.phase === 'failed') return
    this.running = true
    try {
      while (this.segments.length && !this.closed) {
        const segment = this.segments[0]!
        segment.text ??= await this.deps.transcribe(segment, this.controller.signal)
        if (this.closed) return
        if (!this.target.insert(segment.text)) throw new Error('输入位置已失效或超出字数限制，已暂停听写；可复制识别结果')
        this.segments.shift(); this.update({ pending: this.segments.length })
      }
      if (this.stopped && !this.closed) { this.target.close(); this.update({ phase: 'idle', level: 0 }) }
    } catch (error) { if (!this.closed) this.fail(error) }
    finally { this.running = false }
  }
  private fail(error: unknown) {
    this.stopped = true
    this.update({ phase: 'failed', level: 0, error: error instanceof Error ? error.message : '语音识别失败，请重试' })
    const microphone = this.microphone
    void microphone?.stop().catch(() => undefined).finally(() => { this.flush(); this.release?.(); this.release = undefined })
    if (!this.microphone) { this.release?.(); this.release = undefined }
  }
  async stop(message = '') {
    if (this.closed || this.stopped) return
    this.stopped = true; this.update({ phase: 'finishing', error: message })
    try { await this.microphone?.stop() } catch { this.update({ error: '麦克风已停止，正在保留已录语音' }) }
    this.release?.(); this.release = undefined
    this.flush()
    if (!this.running && !this.segments.length) { this.target.close(); this.update({ phase: 'idle', level: 0 }) }
  }
  retry() { if (this.closed || this.state.phase !== 'failed' || !this.segments.length) return; this.update({ phase: 'finishing', error: '' }); void this.drain() }
  get recoverableText() { return this.segments.flatMap(segment => segment.text ? [segment.text] : []).join('') }
  get canRetry() { return this.segments.length > 0 }
  get busy() { return ['starting', 'listening', 'finishing'].includes(this.state.phase) }
  cancel() {
    if (this.closed) return
    this.closed = true; this.controller.abort()
    const release = this.release; this.release = undefined
    if (this.microphone) void this.microphone.stop().catch(() => undefined).finally(() => release?.())
    else release?.()
    this.target.close(); this.parts = []; this.segments = []
  }
}
