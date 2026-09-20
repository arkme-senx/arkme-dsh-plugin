import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { DirectRecordingStore, directRecordingLimit, type DirectRecordingDependencies } from '../src/client/recordings/direct-recording-store.js'
import { microphoneWorkletSource, type MicrophoneCaptureOptions } from '../src/client/recordings/direct-recording-capture.js'
import { pcmWaveHeader, type LocalMicrophoneRecording, type MicrophoneJournal } from '../src/client/recordings/direct-recording-journal.js'
import type { ArkmeMembership } from '../src/types.js'
import { probeRecordingImportSource } from '../src/recording-import-probe.js'

const member = (memberType: 0 | 1 | 2 = 0): ArkmeMembership => ({ userId: 42, memberType, expireAtMillis: null, lifetime: false, gifted: false })
const account = { key: 'prod:42', userId: 42, importPath: '/test/import' }
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
class MemoryJournal implements MicrophoneJournal {
  records = new Map<string, LocalMicrophoneRecording>()
  chunks = new Map<string, ArrayBuffer[]>()
  async list(key: string) { return [...this.records.values()].filter(record => record.accountKey === key).map(record => ({ ...record })) }
  async create(record: LocalMicrophoneRecording) { this.records.set(record.id, { ...record }); this.chunks.set(record.id, []) }
  async append(id: string, pcm: ArrayBuffer) { const record = this.records.get(id)!; record.bytes += pcm.byteLength; record.chunks++; this.chunks.get(id)!.push(pcm) }
  async finish(id: string) { this.records.get(id)!.finished = true }
  async remove(id: string) { this.records.delete(id); this.chunks.delete(id) }
  async file(id: string, tail: readonly ArrayBuffer[] = []) {
    const record = this.records.get(id)!; const parts = [...this.chunks.get(id)!, ...tail]
    const bytes = parts.reduce((sum, part) => sum + part.byteLength, 0)
    if (!bytes) throw new Error('empty')
    return new File([pcmWaveHeader(bytes, record.sampleRate), ...parts], record.fileName, { type: 'audio/wav' })
  }
}
async function setup() {
  const journal = new MemoryJournal()
  let options!: MicrophoneCaptureOptions
  const stop = vi.fn(async () => undefined), release = vi.fn()
  const capture = vi.fn(async (input: MicrophoneCaptureOptions) => { options = input; await input.onReady(16000); return { stop } })
  const upload = vi.fn(async () => ({ id: 'accepted-job' })) as unknown as ReturnType<typeof vi.fn<DirectRecordingDependencies['upload']>>
  const membership = vi.fn(async () => member())
  let id = 0
  const deps: DirectRecordingDependencies = { journal, capture, upload, membership, lock: vi.fn(async () => release), now: () => 1790000000000, id: () => `record-${++id}` }
  const store = new DirectRecordingStore(deps)
  store.configure(account); await flush()
  return { store, deps, journal, capture, upload, membership, stop, release, chunk: (bytes = 32000) => options.onChunk(new ArrayBuffer(bytes), .4), interrupt: (reason: string) => options.onInterrupted(reason), get options() { return options } }
}

describe('direct microphone recording lifecycle', () => {
  it('uses Flutter free/VIP/SVIP duration limits and falls back for expired membership', () => {
    expect([0, 1, 2].map(type => directRecordingLimit(member(type as 0 | 1 | 2), 100))).toEqual([300000, 3600000, 7200000])
    expect(directRecordingLimit({ ...member(2), expireAtMillis: 99 }, 100)).toBe(300000)
  })
  it('does not record on mount; records only after explicit start and stops/uploads with real time and owner', async () => {
    const h = await setup(); expect(h.capture).not.toHaveBeenCalled()
    await h.store.start(); expect(h.store.getSnapshot().phase).toBe('recording')
    expect(h.options.maxMillis).toBe(300000)
    h.chunk(); h.chunk(16000); await flush()
    expect(h.store.getSnapshot().elapsedMillis).toBe(1500)
    expect(h.upload).not.toHaveBeenCalled()
    await h.store.stop()
    expect(h.stop).toHaveBeenCalledOnce(); expect(h.upload).toHaveBeenCalledOnce()
    const [path, file, time, user] = h.upload.mock.calls[0]!
    expect([path, time, user]).toEqual(['/test/import', 1790000000000, 42])
    expect(file.type).toBe('audio/wav'); expect(file.size).toBe(48044)
    expect(h.store.getSnapshot().pending).toHaveLength(0)
    expect(h.store.getSnapshot().acceptedRevision).toBe(1)
  })
  it('prevents double start and double stop', async () => {
    const h = await setup(); await Promise.all([h.store.start(), h.store.start()]); h.chunk()
    await Promise.all([h.store.stop(), h.store.stop()])
    expect(h.capture).toHaveBeenCalledOnce(); expect(h.stop).toHaveBeenCalledOnce(); expect(h.upload).toHaveBeenCalledOnce()
  })
  it('keeps submitted coverage until same-account cloud chunks cover the whole recording', async () => {
    const h = await setup(); await h.store.start(); h.chunk(); h.chunk(); await h.store.stop()
    const start = 1790000000000
    const range = (from: number, to: number) => ({ startAtMillis: start + from, endAtMillis: start + to })
    expect(h.store.getSnapshot().submitted).toHaveLength(1)
    h.store.confirmSubmittedCoverage('prod:43', [range(0, 2000)])
    expect(h.store.getSnapshot().submitted).toHaveLength(1)
    h.store.confirmSubmittedCoverage(account.key, [range(0, 999), range(1000, 2000)])
    expect(h.store.getSnapshot().submitted).toHaveLength(1)
    h.store.confirmSubmittedCoverage(account.key, [range(0, 1000), range(1000, 2000)])
    expect(h.store.getSnapshot().submitted).toHaveLength(0)
    h.store.confirmSubmittedCoverage(account.key, [])
    expect(h.store.getSnapshot().submitted).toHaveLength(0)
  })
  it('retains a failed upload and retries the exact same name/time/owner without recapturing', async () => {
    const h = await setup(); h.upload.mockRejectedValueOnce(new Error('网络离线'))
    await h.store.start(); h.chunk(); await h.store.stop()
    expect(h.store.getSnapshot().error).toContain('录音仍保留在本机')
    const record = h.store.getSnapshot().pending[0]!
    const file = await h.store.download(record.id); expect(file?.size).toBe(32044)
    await h.store.upload(record.id)
    expect(h.upload.mock.calls[0]![1].name).toBe(h.upload.mock.calls[1]![1].name)
    expect(h.capture).toHaveBeenCalledOnce(); expect(h.journal.records.size).toBe(0)
  })
  it('restores interrupted local recordings without automatically uploading or starting capture', async () => {
    const h = await setup(); await h.store.start(); h.chunk(); await flush()
    const second = new DirectRecordingStore(h.deps); second.configure(account); await flush()
    expect(second.getSnapshot().pending).toHaveLength(1)
    expect(second.getSnapshot().pending[0]!.finished).toBe(false)
    expect(h.upload).not.toHaveBeenCalled(); expect(h.capture).toHaveBeenCalledOnce()
  })
  it('does not interrupt capture when the same account is configured on page changes', async () => {
    const h = await setup(); await h.store.start(); h.store.configure({ ...account }); h.chunk(); await flush()
    expect(h.stop).not.toHaveBeenCalled(); expect(h.store.getSnapshot().phase).toBe('recording')
  })
  it('stops and retains the old account recording, never uploads it into the new account', async () => {
    const h = await setup(); await h.store.start(); h.chunk(); await flush()
    h.store.configure({ ...account, key: 'prod:43', userId: 43 }); await flush()
    expect(h.stop).toHaveBeenCalledOnce(); expect(h.options.signal.aborted).toBe(true)
    expect(h.upload).not.toHaveBeenCalled(); expect(h.store.getSnapshot().pending).toHaveLength(0)
    expect((await h.journal.list('prod:42'))[0]!.bytes).toBe(32000)
  })
  it('fences a late microphone permission grant after account changes', async () => {
    const h = await setup(); let resolve!: (value: { stop: () => Promise<void> }) => void
    h.capture.mockImplementationOnce(async options => { await options.onReady(16000); return await new Promise(done => { resolve = done }) })
    const starting = h.store.start(); await flush()
    h.store.configure({ ...account, key: 'prod:43', userId: 43 }); await flush()
    resolve({ stop: h.stop }); await starting
    expect(h.stop).toHaveBeenCalled(); expect(h.store.getSnapshot().phase).toBe('idle'); expect(h.upload).not.toHaveBeenCalled()
  })
  it('aborts uploads on logout and keeps the local copy when the host has not accepted', async () => {
    const h = await setup(); await h.store.start(); h.chunk()
    h.upload.mockImplementationOnce(async (_path, _file, _start, _owner, options) => await new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(new Error('aborted')))))
    const stopping = h.store.stop(); await flush(); expect(h.store.getSnapshot().phase).toBe('uploading')
    h.store.configure(undefined); await stopping
    expect(h.journal.records.size).toBe(1); expect(h.store.getSnapshot().accountKey).toBeUndefined()
  })
  it('fails closed when membership cannot be verified or belongs to a different account', async () => {
    const h = await setup(); h.membership.mockRejectedValueOnce(new Error('会员状态未确认'))
    await h.store.start(); expect(h.capture).not.toHaveBeenCalled(); expect(h.release).toHaveBeenCalled()
    h.membership.mockResolvedValueOnce({ ...member(), userId: 43 }); await h.store.start()
    expect(h.capture).not.toHaveBeenCalled(); expect(h.store.getSnapshot().error).toContain('账号已变化')
  })
  it('does not capture if storage or the cross-tab lock is unavailable', async () => {
    const h = await setup(); vi.spyOn(h.deps, 'lock').mockRejectedValueOnce(new Error('其他窗口正在录音'))
    await h.store.start(); expect(h.capture).not.toHaveBeenCalled(); expect(h.store.getSnapshot().phase).toBe('idle')
    const second = new DirectRecordingStore({ ...h.deps, journal: { ...h.journal, list: async () => { throw new Error('blocked') } } as never })
    second.configure(account); await flush(); await second.start(); expect(h.capture).not.toHaveBeenCalled()
  })
  it('keeps interrupted microphone content and lets user decide when to submit', async () => {
    const h = await setup(); await h.store.start(); h.chunk(); h.interrupt('麦克风断开'); await flush()
    expect(h.stop).toHaveBeenCalledOnce(); expect(h.upload).not.toHaveBeenCalled()
    expect(h.store.getSnapshot().error).toBe('麦克风断开'); expect(h.store.getSnapshot().pending[0]!.bytes).toBe(32000)
  })
  it('preserves failed-to-persist tail in memory for download and stops immediately', async () => {
    const h = await setup(); await h.store.start(); h.chunk(); await flush()
    vi.spyOn(h.journal, 'append').mockRejectedValueOnce(new Error('quota'))
    h.chunk(8000); await flush()
    expect(h.store.getSnapshot().error).toContain('勿关闭页面'); expect(h.stop).toHaveBeenCalledOnce()
    expect(h.upload).not.toHaveBeenCalled()
    const file = await h.store.download(h.store.getSnapshot().pending[0]!.id)
    expect(file?.size).toBe(40044)
  })
  it('does not leave an unuploadable empty recording after immediate stop or failed permission', async () => {
    const h = await setup(); await h.store.start(); await h.store.stop()
    expect(h.journal.records.size).toBe(0); expect(h.upload).not.toHaveBeenCalled(); expect(h.store.getSnapshot().error).toContain('录音过短')
    h.capture.mockRejectedValueOnce(new Error('麦克风权限未获允许')); await h.store.start()
    expect(h.store.getSnapshot().phase).toBe('idle'); expect(h.store.getSnapshot().error).toContain('权限')
  })
})

describe('streaming WAV capture format', () => {
  it('passes the real host audio-import format and duration validation', async () => {
    const buffer = new Uint8Array(await new Blob([pcmWaveHeader(48000, 16000), new ArrayBuffer(48000)]).arrayBuffer())
    const result = await probeRecordingImportSource({ size: buffer.byteLength, read: async (offset, length) => buffer.slice(offset, offset + length) }, { fileName: 'direct.wav', mimeType: 'audio/wav', fileSize: buffer.byteLength })
    expect(result).toEqual({ kind: 'wav', durationMillis: 1500 })
  })
  it('encodes valid mono PCM headers and rejects invalid sizes', () => {
    const header = pcmWaveHeader(32000, 16000); const data = new DataView(header)
    expect(new TextDecoder().decode(header.slice(0, 4))).toBe('RIFF')
    expect(data.getUint32(4, true)).toBe(32036); expect(data.getUint32(40, true)).toBe(32000)
    expect(data.getUint32(24, true)).toBe(16000); expect(data.getUint16(22, true)).toBe(1)
    expect(() => pcmWaveHeader(3, 16000)).toThrow(); expect(() => pcmWaveHeader(2, 0)).toThrow()
  })
  function worklet(maxMillis = 10000) {
    const messages: { pcm?: ArrayBuffer; stopped?: boolean; limit?: boolean; level?: number }[] = []
    let constructor: any
    runInNewContext(microphoneWorkletSource, { AudioWorkletProcessor: class { port = { postMessage: (message: any) => messages.push(message), onmessage: undefined } }, sampleRate: 16000, registerProcessor: (_name: string, value: any) => { constructor = value } })
    return { processor: new constructor({ processorOptions: { maxMillis } }), messages }
  }
  it('journals each second, clips samples and flushes a final partial second before stop acknowledgement', () => {
    const { processor, messages } = worklet()
    processor.process([[new Float32Array(16000).fill(2)]]); processor.process([[new Float32Array(8000).fill(-2)]])
    expect(messages).toHaveLength(1); expect(messages[0]!.pcm!.byteLength).toBe(32000)
    expect(new DataView(messages[0]!.pcm!).getInt16(0, true)).toBe(32767)
    processor.port.onmessage(); expect(messages).toHaveLength(3)
    expect(new DataView(messages[1]!.pcm!).getInt16(0, true)).toBe(-32768)
    expect(messages[2]!.stopped).toBe(true)
    processor.process([[new Float32Array(16000)]]); expect(messages).toHaveLength(3)
  })
  it('enforces the duration limit in the audio thread even when UI timers are throttled', () => {
    const { processor, messages } = worklet(500)
    processor.process([[new Float32Array(16000)]])
    expect(messages[0]!.pcm!.byteLength).toBe(16000); expect(messages[1]!.limit).toBe(true)
    processor.process([[new Float32Array(16000)]]); expect(messages).toHaveLength(2)
  })
})
