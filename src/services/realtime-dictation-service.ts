import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { ArkmePluginError, type ServiceRuntime } from './service.js'
import { dshRemoteRealtimeEndpoint } from '../dsh-remote/default-socket-factory.js'
import { DICTATION_MAX_BUFFER_BYTES, DICTATION_MAX_FRAME_BYTES, DICTATION_MAX_MILLIS, DICTATION_MAX_TEXT_LENGTH, type RealtimeDictationRequest, type RealtimeDictationSnapshot } from '../realtime-dictation-contract.js'

export const DICTATION_SUBPROTOCOL = 'jotmo.dictation.v1'
const failure = (code: string, message: string, status = 409) => new ArkmePluginError(`dictation-${code}`, message, status >= 500, status)
const upstreamErrors: Record<string, string> = {
  service_busy: '服务繁忙，请稍后重试', session_busy: '上一段语音尚未结束，请稍后重试',
  quota_unavailable: '语音转写额度不可用，请稍后重试', quota_settlement_failed: '转写额度不足或结算失败，请稍后重试',
  recognizer_unavailable: '语音转写暂不可用，请稍后重试', recognizer_disconnected: '语音转写连接已中断，请重试',
  final_timeout: '转写超时，请重试', timeout: '转写超时，请重试', no_speech: '未识别到语音，请重试',
}
interface Stream {
  userId: number
  socket: WebSocket
  snapshot: RealtimeDictationSnapshot
  listener?: ((value: RealtimeDictationSnapshot) => void) | undefined
  deadline?: ReturnType<typeof setTimeout> | undefined
  idle?: ReturnType<typeof setTimeout> | undefined
  retention?: ReturnType<typeof setTimeout> | undefined
  heartbeat?: ReturnType<typeof setInterval> | undefined
  upstreamId?: string
  upstreamRevision: number
  ready: boolean
  finalizing: boolean
  maxMillis: number
  bytes: number
  draining?: boolean
  resolveReady(): void
  rejectReady(error: Error): void
}

/** One account-scoped owner for UI, SDK and Tools; credentials and upstream IDs stay in Host. */
export class RealtimeDictationService {
  private streams = new Map<string, Stream>()
  private generation = 0
  constructor(private readonly runtime: ServiceRuntime, private readonly createSocket: (url: URL, options: WebSocket.ClientOptions) => WebSocket = (url, options) => new WebSocket(url, DICTATION_SUBPROTOCOL, options)) {}

  async command(request: RealtimeDictationRequest, signal?: AbortSignal): Promise<RealtimeDictationSnapshot> {
    signal?.throwIfAborted()
    if (!request || !['start', 'audio', 'status', 'finish', 'cancel'].includes(request.action)) throw failure('invalid', '听写操作无效', 400)
    if (request.action === 'start') return await this.open(request.expectedUserId, undefined, signal)
    const session = await this.runtime.requireSession(), stream = this.get(request.streamRef)
    if (stream.userId !== session.userId) throw failure('account-changed', '登录账号已变化，听写已停止')
    signal?.throwIfAborted()
    if (request.action === 'audio') {
      if (typeof request.pcm !== 'string' || request.pcm.length > Math.ceil(DICTATION_MAX_FRAME_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.pcm)) throw failure('invalid', '听写音频格式无效', 400)
      this.audio(request.streamRef, Buffer.from(request.pcm, 'base64'))
    } else if (request.action === 'finish') this.finish(request.streamRef)
    else if (request.action === 'cancel') this.cancel(request.streamRef)
    return { ...stream.snapshot }
  }

  async open(expectedUserId: number, listener?: (value: RealtimeDictationSnapshot) => void, signal?: AbortSignal): Promise<RealtimeDictationSnapshot> {
    signal?.throwIfAborted()
    const generation = this.generation, initial = await this.runtime.requireSession()
    if (!Number.isSafeInteger(expectedUserId) || initial.userId !== expectedUserId) throw failure('account-changed', '登录账号已变化，听写已停止')
    const checkCapacity = () => { if (this.streams.size >= 8 || [...this.streams.values()].filter(s => !this.terminal(s)).length >= 2) throw failure('busy', '正在进行其他听写，请稍后重试', 429) }
    checkCapacity()
    const availability = await this.runtime.authenticatedAuthReadPost<{ enabled?: boolean; allowed?: boolean; max_duration_ms?: number }>('/api/v1/dictation/check', {}, initial, signal, { bypassCache: true })
    if (availability.enabled !== true) throw failure('disabled', '语音输入暂未开放，请稍后再试', 503)
    if (availability.allowed !== true) throw failure('quota', '本月语音转写额度已用完', 403)
    // Preflight may refresh the token; capture the current credentials again before the upgrade.
    const session = await this.runtime.requireSession()
    signal?.throwIfAborted()
    if (generation !== this.generation || session.userId !== expectedUserId) throw failure('account-changed', '登录账号已变化，听写已停止')
    checkCapacity()
    const origin = this.runtime.config.dshRemoteRealtimeBaseUrl?.trim() || (this.runtime.config.environment === 'prod' ? 'https://realtime.jotmo.cc' : 'https://jotmo-realtime.senguo.me')
    const socket = this.createSocket(new URL(dshRemoteRealtimeEndpoint(origin)), { headers: { Authorization: `Bearer ${session.accessToken}`, 'X-Jotmo-Dictation-Start': 'deferred' }, handshakeTimeout: 8_000, maxPayload: 256 * 1024, perMessageDeflate: false, followRedirects: false })
    const ref = randomUUID(), ready = Promise.withResolvers<void>()
    const stream: Stream = { userId: session.userId, socket, snapshot: { version: 1, streamRef: ref, phase: 'listening', text: '', revision: 0 }, listener, bytes: 0,
      upstreamRevision: 0, ready: false, finalizing: false, maxMillis: DICTATION_MAX_MILLIS, resolveReady: ready.resolve, rejectReady: ready.reject }
    this.streams.set(ref, stream)
    const abort = () => this.cancel(ref)
    socket.on('error', () => this.fail(stream, 'connection', '实时听写连接失败，请重新开始；已写入文字仍保留'))
    socket.on('close', () => { if (!this.terminal(stream)) this.fail(stream, 'disconnected', '实时听写连接已断开，请重新开始；已写入文字仍保留') })
    socket.on('open', () => { if (socket.protocol !== DICTATION_SUBPROTOCOL) this.fail(stream, 'protocol', '实时听写协议不受支持，请升级服务后重试') })
    socket.on('message', (data, binary) => {
      if (this.terminal(stream)) return
      try {
        if (binary) throw new Error('Expected JSON event')
        const event = JSON.parse(data.toString()) as Record<string, unknown>
        if (event.type === 'error') { const code = typeof event.code === 'string' ? event.code : ''; this.fail(stream, code in upstreamErrors ? code : 'upstream', upstreamErrors[code] ?? '语音转写失败，请重试'); return }
        if (event.type === 'prepared' && !stream.upstreamId && !stream.ready) {
          if (typeof event.session_id !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(event.session_id)) throw new Error('Invalid session')
          stream.upstreamId = event.session_id
          socket.send(JSON.stringify({ type: 'start', session_id: stream.upstreamId }))
          return
        }
        if (!stream.upstreamId || event.session_id !== stream.upstreamId) return
        if (event.type === 'ready' && !stream.ready) {
          if (!Number.isSafeInteger(event.max_duration_ms) || Number(event.max_duration_ms) < 1000) throw new Error('Invalid duration')
          stream.maxMillis = Math.min(Number(event.max_duration_ms), DICTATION_MAX_MILLIS)
          stream.ready = true; clearTimeout(stream.deadline)
          stream.deadline = setTimeout(() => this.requestFinish(stream), stream.maxMillis); stream.deadline.unref()
          this.touch(stream); stream.resolveReady(); return
        }
        if (!stream.ready) throw new Error('Result before ready')
        if (event.type === 'result') {
          if (event.text !== undefined && typeof event.text !== 'string' || String(event.text ?? '').length > DICTATION_MAX_TEXT_LENGTH || !Number.isSafeInteger(event.revision) || Number(event.revision) < 1 || event.is_final !== undefined && typeof event.is_final !== 'boolean') throw new Error('Invalid result')
          if (Number(event.revision) <= stream.upstreamRevision) return
          stream.upstreamRevision = Number(event.revision)
          stream.snapshot = { ...stream.snapshot, text: String(event.text ?? ''), revision: stream.snapshot.revision + 1 }
          if (event.is_final === true) this.end(stream, 'finished')
          else this.emit(stream)
        } else if (event.type === 'finalizing') {
          stream.finalizing = true; stream.draining = false
          clearTimeout(stream.deadline); clearTimeout(stream.idle)
          stream.snapshot = { ...stream.snapshot, phase: 'finishing' }
          stream.deadline = setTimeout(() => this.fail(stream, 'timeout', '未收到最后识别结果；已写入文字仍保留，请重新开始'), 10_000); stream.deadline.unref()
          this.emit(stream)
        } else if (event.type === 'cancelled') this.fail(stream, 'cancelled', '听写已取消')
        else if (event.type === 'done') throw new Error('Done without a settled final result')
      } catch { this.fail(stream, 'protocol', '实时听写返回格式无效，请重新开始') }
    })
    stream.deadline = setTimeout(() => this.fail(stream, 'timeout', '实时听写准备超时，请重试'), 16_000); stream.deadline.unref()
    stream.heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.ping() }, 5_000); stream.heartbeat.unref()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    try {
      await ready.promise
      signal?.throwIfAborted()
      if (generation !== this.generation || (await this.runtime.requireSession()).userId !== session.userId || this.terminal(stream)) throw failure('account-changed', '登录账号已变化，听写已停止')
      this.emit(stream); return { ...stream.snapshot }
    } catch (error) { this.cancel(ref); throw error }
    finally { signal?.removeEventListener('abort', abort) }
  }

  audio(ref: string, pcm: Buffer): void {
    const stream = this.get(ref)
    if (this.terminal(stream) || !stream.ready || stream.socket.readyState !== WebSocket.OPEN) throw failure('closed', '听写已经停止，请重新开始')
    if (stream.finalizing) return // The backend has stopped accepting audio; release capture without replaying its tail.
    if (stream.snapshot.phase !== 'listening' && !stream.draining) throw failure('closed', '听写已经停止，请重新开始')
    if (!pcm.length || pcm.length % 2 || pcm.length > DICTATION_MAX_FRAME_BYTES) throw failure('invalid', '听写音频必须是 16kHz 单声道 PCM 小片段', 400)
    if (stream.bytes + pcm.length > 32 * stream.maxMillis || stream.socket.bufferedAmount + pcm.length > DICTATION_MAX_BUFFER_BYTES) { this.fail(stream, 'backpressure', '网络较慢或听写已达时长上限，已停止采集；已写入文字仍保留'); return }
    stream.bytes += pcm.length; stream.socket.send(pcm, { binary: true })
    if (!stream.draining) this.touch(stream)
  }
  finish(ref: string): void {
    const stream = this.get(ref)
    if (this.terminal(stream) || stream.finalizing || !stream.ready || stream.snapshot.phase !== 'listening' && !stream.draining) return
    stream.draining = false; clearTimeout(stream.deadline); clearTimeout(stream.idle)
    stream.snapshot = { ...stream.snapshot, phase: 'finishing' }; this.emit(stream)
    stream.socket.send(JSON.stringify({ type: 'stop', session_id: stream.upstreamId }))
    stream.deadline = setTimeout(() => this.fail(stream, 'timeout', '未收到最后识别结果；已写入文字仍保留，请重新开始'), 10_000); stream.deadline.unref()
  }
  cancel(ref: string): void { const stream = this.streams.get(ref); if (stream && !this.terminal(stream)) this.fail(stream, 'cancelled', '听写已取消') }
  dispose(): void { this.generation++; for (const stream of this.streams.values()) { this.fail(stream, 'account-changed', '登录账号已变化或插件已关闭，听写已停止'); clearTimeout(stream.retention) }; this.streams.clear() }
  private get(ref: string): Stream { const stream = this.streams.get(ref); if (!stream) throw failure('not-found', '听写会话已失效，请重新开始', 404); return stream }
  private terminal(stream: Stream) { return stream.snapshot.phase === 'finished' || stream.snapshot.phase === 'failed' }
  private requestFinish(stream: Stream) {
    if (stream.snapshot.phase !== 'listening') return
    clearTimeout(stream.idle); stream.draining = true; stream.snapshot = { ...stream.snapshot, phase: 'finishing' }
    stream.deadline = setTimeout(() => this.finish(stream.snapshot.streamRef), 2_000); stream.deadline.unref(); this.emit(stream)
  }
  private touch(stream: Stream) { clearTimeout(stream.idle); stream.idle = setTimeout(() => this.requestFinish(stream), 12_000); stream.idle.unref() }
  private emit(stream: Stream) { stream.listener?.({ ...stream.snapshot }) }
  private fail(stream: Stream, code: string, message: string) { if (!this.terminal(stream)) { stream.snapshot = { ...stream.snapshot, error: { code: `dictation-${code}`, message, retryable: !['cancelled', 'account-changed'].includes(code) } }; this.end(stream, 'failed') } }
  private end(stream: Stream, phase: 'finished' | 'failed') {
    if (this.terminal(stream)) return
    clearTimeout(stream.deadline); clearTimeout(stream.idle); clearInterval(stream.heartbeat)
    if (!stream.ready) stream.rejectReady(failure(stream.snapshot.error?.code.replace(/^dictation-/, '') ?? 'connection', stream.snapshot.error?.message ?? '实时听写连接失败，请重试', 502))
    stream.snapshot = { ...stream.snapshot, phase }; this.emit(stream); stream.listener = undefined
    if (stream.socket.readyState === WebSocket.OPEN) {
      if (phase === 'failed' && stream.upstreamId) stream.socket.send(JSON.stringify({ type: 'cancel', session_id: stream.upstreamId }))
      stream.socket.close()
      const timer = setTimeout(() => stream.socket.terminate(), 1000); timer.unref(); stream.socket.once('close', () => clearTimeout(timer))
    } else stream.socket.terminate()
    stream.retention = setTimeout(() => this.streams.delete(stream.snapshot.streamRef), 30_000); stream.retention.unref()
  }
}
