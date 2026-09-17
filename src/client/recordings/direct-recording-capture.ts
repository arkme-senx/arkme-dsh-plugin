export interface MicrophoneCapture {
  stop(): Promise<void>
}
export interface MicrophoneCaptureOptions {
  signal: AbortSignal
  maxMillis: number
  onReady(sampleRate: number): Promise<void>
  onChunk(pcm: ArrayBuffer, level: number): void
  onInterrupted(message: string): void
}

/** PCM, not MediaRecorder WebM: existing Audio imports accept WAV/MP3/M4A only. */
export const microphoneWorkletSource = `
class ArkmePcmJournal extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.samples = new Int16Array(sampleRate); this.used = 0; this.peak = 0;
    this.frames = 0; this.maxFrames = Math.floor(sampleRate * options.processorOptions.maxMillis / 1000);
    this.stopped = false;
    this.port.onmessage = () => { this.stopped = true; this.flush(); this.port.postMessage({ stopped: true }); };
  }
  flush() {
    if (!this.used) return;
    const pcm = new ArrayBuffer(this.used * 2); const view = new DataView(pcm);
    for (let i = 0; i < this.used; i++) view.setInt16(i * 2, this.samples[i], true);
    this.port.postMessage({ pcm, level: this.peak }, [pcm]); this.used = 0; this.peak = 0;
  }
  process(inputs) {
    if (this.stopped) return true;
    const input = inputs[0] && inputs[0][0]; if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      if (this.frames >= this.maxFrames) {
        this.stopped = true; this.flush(); this.port.postMessage({ limit: true }); break;
      }
      const value = Math.max(-1, Math.min(1, input[i]));
      this.samples[this.used++] = Math.round(value * (value < 0 ? 32768 : 32767));
      this.peak = Math.max(this.peak, Math.abs(value)); this.frames++;
      if (this.used === this.samples.length) this.flush();
    }
    return true;
  }
}
registerProcessor('arkme-pcm-journal', ArkmePcmJournal);
`

export async function captureMicrophone(options: MicrophoneCaptureOptions): Promise<MicrophoneCapture> {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined') {
    throw new Error('当前环境不支持直接录音，请使用支持麦克风录音的桌面浏览器')
  }
  const context = new AudioContext({ sampleRate: 16000 })
  let stream: MediaStream | undefined
  let node: AudioWorkletNode | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let stopped = false
  let stopping: Promise<void> | undefined
  let ack: (() => void) | undefined
  const release = () => {
    stopped = true
    stream?.getTracks().forEach(track => track.stop())
    node?.disconnect(); source?.disconnect()
    void context.close().catch(() => undefined)
  }
  const stop = (): Promise<void> => {
    if (stopping) return stopping
    stopping = (async () => {
      stopped = true
      if (node) await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 1500)
        ack = () => { clearTimeout(timer); resolve() }
        node!.port.postMessage('stop')
      })
      options.signal.removeEventListener('abort', abort)
      release()
    })()
    return stopping
  }
  // Preserve the last partial second before releasing an active microphone.
  // During a pending permission prompt, a late grant is released by guard().
  const abort = () => { if (node) void stop(); else release() }
  options.signal.addEventListener('abort', abort, { once: true })
  const guard = () => { if (options.signal.aborted || stopped) throw new Error('录音启动已取消') }
  try {
    guard()
    await context.resume()
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false })
    guard()
    const url = URL.createObjectURL(new Blob([microphoneWorkletSource], { type: 'text/javascript' }))
    try { await context.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
    guard()
    await options.onReady(context.sampleRate)
    guard()
    node = new AudioWorkletNode(context, 'arkme-pcm-journal', { channelCount: 1, channelCountMode: 'explicit', processorOptions: { maxMillis: options.maxMillis } })
    node.port.onmessage = event => {
      if (event.data.pcm instanceof ArrayBuffer) options.onChunk(event.data.pcm, Number(event.data.level) || 0)
      if (event.data.stopped) ack?.()
      if (event.data.limit) options.onInterrupted('已达到本次录音时长上限，录音已停止')
    }
    node.onprocessorerror = () => options.onInterrupted('录音设备发生错误，已停止录音；可保存已录内容')
    for (const track of stream.getTracks()) track.addEventListener('ended', () => { if (!stopped) options.onInterrupted('麦克风已断开，已停止录音；可保存已录内容') })
    context.onstatechange = () => {
      if (!stopped && context.state !== 'running') options.onInterrupted('录音被系统中断，已停止录音；可保存已录内容')
    }
    source = context.createMediaStreamSource(stream)
    source.connect(node); node.connect(context.destination) // Worklet emits silence; no microphone feedback.
    return { stop }
  } catch (error) {
    options.signal.removeEventListener('abort', abort); release()
    if (error instanceof Error && error.name === 'NotAllowedError') throw new Error('麦克风权限未获允许，请在浏览器或系统设置中允许后重试')
    if (error instanceof Error && error.name === 'NotFoundError') throw new Error('未找到麦克风，请连接后重试')
    throw error
  }
}
