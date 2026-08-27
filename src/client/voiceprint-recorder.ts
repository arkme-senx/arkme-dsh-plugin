export interface ArkmeVoiceprintRecording {
  wav: Uint8Array
  durationMs: number
}

export interface ArkmeVoiceprintRecorder {
  start(): Promise<void>
  stop(): Promise<ArkmeVoiceprintRecording>
  cancel(): Promise<void>
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index))
}

export function encodeMonoPcm16Wav(chunks: readonly Float32Array[], sampleRate: number): Uint8Array {
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) {
    throw new TypeError('录音采样率无效')
  }
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const buffer = new ArrayBuffer(44 + sampleCount * 2)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + sampleCount * 2, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, sampleCount * 2, true)
  let offset = 44
  for (const chunk of chunks) {
    for (const raw of chunk) {
      const sample = Math.max(-1, Math.min(1, raw))
      view.setInt16(offset, sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), true)
      offset += 2
    }
  }
  return new Uint8Array(buffer)
}

export class BrowserPcmVoiceprintRecorder implements ArkmeVoiceprintRecorder {
  private stream: MediaStream | undefined
  private context: AudioContext | undefined
  private source: MediaStreamAudioSourceNode | undefined
  private processor: ScriptProcessorNode | undefined
  private chunks: Float32Array[] = []
  private sampleCount = 0

  async start(): Promise<void> {
    if (this.context !== undefined) throw new Error('声纹录音已经开始')
    if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined
      || typeof window === 'undefined' || window.AudioContext === undefined) {
      throw new Error('当前浏览器不支持麦克风录音')
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false })
    try {
      const context = new window.AudioContext({ sampleRate: 48_000 })
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(4096, 1, 1)
      this.chunks = []
      this.sampleCount = 0
      processor.onaudioprocess = event => {
        const input = event.inputBuffer.getChannelData(0)
        const copy = new Float32Array(input)
        this.chunks.push(copy)
        this.sampleCount += copy.length
      }
      source.connect(processor)
      processor.connect(context.destination)
      this.stream = stream
      this.context = context
      this.source = source
      this.processor = processor
      await context.resume()
    } catch (error) {
      for (const track of stream.getTracks()) track.stop()
      throw error
    }
  }

  async stop(): Promise<ArkmeVoiceprintRecording> {
    const context = this.context
    if (context === undefined) throw new Error('声纹录音尚未开始')
    const sampleRate = context.sampleRate
    const durationMs = Math.round(this.sampleCount * 1000 / sampleRate)
    const wav = encodeMonoPcm16Wav(this.chunks, sampleRate)
    await this.release()
    return { wav, durationMs }
  }

  async cancel(): Promise<void> {
    await this.release()
    this.chunks = []
    this.sampleCount = 0
  }

  private async release(): Promise<void> {
    this.processor?.disconnect()
    this.source?.disconnect()
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    const context = this.context
    this.stream = undefined
    this.context = undefined
    this.source = undefined
    this.processor = undefined
    if (context !== undefined && context.state !== 'closed') await context.close()
  }
}
