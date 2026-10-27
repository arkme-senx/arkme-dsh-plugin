import { captureMicrophone, type MicrophoneCapture, type MicrophoneCaptureOptions } from './recordings/direct-recording-capture.js'
import { acquireDictation } from './dictation-activity.js'
import type { DictationTarget } from './dictation-target.js'
import { connectRealtimeDictation } from './api.js'
import { DICTATION_MAX_MILLIS, type RealtimeDictationHandle, type RealtimeDictationSnapshot } from '../realtime-dictation-contract.js'
import type { RealtimeDictationOptions } from '../realtime-dictation-client.js'

export type DictationPhase = 'idle' | 'starting' | 'listening' | 'finishing' | 'failed'
export interface DictationState { phase: DictationPhase; pending: number; error: string; level: number }
export interface DictationDependencies {
  capture(options: MicrophoneCaptureOptions): Promise<MicrophoneCapture>
  connect(options: RealtimeDictationOptions): Promise<RealtimeDictationHandle>
  acquire(cancel: () => void): Promise<() => void>
}

/** One live stream per editor; upstream hypotheses replace only this dictation range. */
export class DictationSession {
  private state: DictationState = { phase: 'idle', pending: 0, error: '', level: 0 }
  private controller = new AbortController()
  private microphone: MicrophoneCapture | undefined
  private captureRelease: Promise<void> | undefined
  private stream: RealtimeDictationHandle | undefined
  private release: (() => void) | undefined
  private stopped = false
  private closed = false
  private latestText = ''
  private insertedText = ''
  private insertionFailed = false
  private levelListener: ((level: number) => void) | undefined
  setLevelListener(listener: (level: number) => void) { this.levelListener = listener }
  private deps: DictationDependencies
  constructor(private target: DictationTarget, private userId: number, private onState: (state: DictationState) => void, dependencies?: Partial<DictationDependencies>) {
    this.deps = { capture: captureMicrophone, acquire: acquireDictation, connect: options => connectRealtimeDictation('/arkme-self/api', options), ...dependencies }
  }
  private update(patch: Partial<DictationState>) { this.state = { ...this.state, ...patch }; this.onState(this.state) }
  async start() {
    if (this.state.phase !== 'idle' || this.closed) return
    this.update({ phase: 'starting' })
    try {
      const release = await this.deps.acquire(() => this.cancel())
      if (this.closed) { release(); return }
      this.release = release
      const microphone = await this.deps.capture({ signal: this.controller.signal, maxMillis: DICTATION_MAX_MILLIS, chunkMillis: 100,
        onReady: async rate => {
          if (rate !== 16000) throw new Error('麦克风采样率不受支持，请切换输入设备后重试')
          const stream = await this.deps.connect({ expectedUserId: this.userId, signal: this.controller.signal,
            onUpdate: value => this.result(value), onError: error => this.fail(error) })
          if (this.closed || this.stopped) { stream.dispose(); throw new DOMException('听写已取消', 'AbortError') }
          this.stream = stream
        },
        onChunk: (pcm, level) => {
          if (this.closed || this.state.phase === 'failed' || this.state.phase === 'idle') return
          try { this.stream?.send(pcm); this.levelListener?.(level) } catch (error) { this.fail(error) }
        },
        onInterrupted: message => { void this.stop(message) },
      })
      if (this.closed || this.stopped) { await microphone.stop(); return }
      this.microphone = microphone
      this.update({ phase: 'listening' })
    } catch (error) { if (!this.closed) this.fail(error) }
  }
  private result(value: RealtimeDictationSnapshot) {
    if (this.closed) return
    this.latestText = value.text
    if (!this.insertionFailed && this.latestText !== this.insertedText) {
      if (this.target.replace(this.latestText)) this.insertedText = this.latestText
      else { this.insertionFailed = true; this.fail(new Error('输入位置已变化或超出字数限制；已保留原文，可复制识别结果')); return }
    }
    if (value.phase === 'failed') this.fail(new Error(value.error?.message || '实时听写失败；已写入文字仍保留'))
    else if (value.phase === 'finishing' && !this.stopped) void this.stop()
    else if (value.phase === 'finished') {
      this.stopped = true; void this.releaseCapture().catch(() => undefined)
      if (!this.insertionFailed) { this.target.close(); this.update({ phase: 'idle', pending: 0, level: 0 }) }
    }
  }
  private releaseCapture(): Promise<void> {
    if (this.captureRelease) return this.captureRelease
    const microphone = this.microphone; this.microphone = undefined
    return this.captureRelease = Promise.resolve().then(async () => {
      try { await microphone?.stop() } finally { this.release?.(); this.release = undefined }
    })
  }
  private fail(error: unknown) {
    if (this.closed || this.state.phase === 'failed') return
    this.stopped = true; this.stream?.dispose()
    this.update({ phase: 'failed', pending: this.insertionFailed ? 1 : 0, level: 0, error: error instanceof Error ? error.message : '实时听写失败，请重新开始' })
    void this.releaseCapture().catch(() => undefined)
  }
  async stop(message = '') {
    if (this.closed || this.stopped) return
    this.stopped = true
    if (!this.stream) { this.cancel(); this.update({ phase: 'idle', pending: 0, level: 0 }); return }
    this.update({ phase: 'finishing', pending: 1, error: message })
    try { await this.releaseCapture(); if (!this.closed && this.state.phase !== 'failed') this.stream.finish() }
    catch (error) { this.fail(error) }
  }
  retry() {
    if (this.closed || !this.insertionFailed || this.state.phase !== 'failed') return
    if (this.target.replace(this.latestText)) {
      this.insertedText = this.latestText; this.insertionFailed = false; this.target.close()
      this.update({ phase: 'idle', pending: 0, error: '', level: 0 })
    }
  }
  get recoverableText() { return this.insertionFailed ? this.latestText : '' }
  get canRetry() { return this.insertionFailed }
  get busy() { return ['starting', 'listening', 'finishing'].includes(this.state.phase) }
  cancel() {
    if (this.closed) return
    this.closed = true; this.controller.abort(); this.stream?.dispose(); this.stream = undefined
    this.levelListener = undefined
    void this.releaseCapture().catch(() => undefined)
    this.target.close(); this.latestText = ''; this.insertedText = ''
  }
}
