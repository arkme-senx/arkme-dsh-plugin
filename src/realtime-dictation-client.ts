import { DICTATION_MAX_BUFFER_BYTES, DICTATION_MAX_FRAME_BYTES, DICTATION_MAX_TEXT_LENGTH, type RealtimeDictationHandle, type RealtimeDictationSnapshot } from './realtime-dictation-contract.js'

export interface RealtimeDictationOptions {
  expectedUserId: number
  onUpdate(snapshot: RealtimeDictationSnapshot): void
  onError(error: Error): void
  signal?: AbortSignal | undefined
}
/** Browser/consumer transport. Audio is never automatically retried or persisted. */
export function connectRealtimeDictation(route: string, options: RealtimeDictationOptions): Promise<RealtimeDictationHandle> {
  if (!/^\/[A-Za-z0-9/_-]+$/.test(route) || route.startsWith('//')) throw new TypeError('Dictation requires a same-origin route')
  return new Promise((resolve, reject) => {
    options.signal?.throwIfAborted()
    const socket = new WebSocket(`${route}/dictation`)
    let ready = false, disposed = false, terminal = false, finishing = false
    const timeout = setTimeout(() => fail(new Error('实时听写连接超时，请重新开始')), 12_000)
    const dispose = () => {
      if (disposed) return
      disposed = true; clearTimeout(timeout); options.signal?.removeEventListener('abort', abort)
      socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null
      socket.close()
      if (!ready) reject(new DOMException('听写已取消', 'AbortError'))
    }
    const abort = () => dispose()
    const fail = (error: Error) => { if (disposed || terminal) return; try { if (!ready) reject(error); else options.onError(error) } finally { dispose() } }
    const handle: RealtimeDictationHandle = {
      send(pcm) {
        if (disposed || terminal || finishing || socket.readyState !== WebSocket.OPEN) throw new Error('实时听写已停止，请重新开始')
        if (!pcm.byteLength || pcm.byteLength % 2 || pcm.byteLength > DICTATION_MAX_FRAME_BYTES) throw new Error('听写音频片段无效')
        if (socket.bufferedAmount + pcm.byteLength > DICTATION_MAX_BUFFER_BYTES) { const error = new Error('网络较慢，听写已停止；已写入文字仍保留'); fail(error); throw error }
        socket.send(pcm)
      },
      finish() { if (!disposed && !terminal && !finishing) { finishing = true; socket.send(JSON.stringify({ action: 'finish' })) } },
      dispose,
    }
    socket.onopen = () => socket.send(JSON.stringify({ action: 'start', expectedUserId: options.expectedUserId }))
    socket.onmessage = event => {
      if (disposed || terminal) return
      try {
        const value = JSON.parse(String(event.data)) as RealtimeDictationSnapshot
        if (value.version !== 1 || typeof value.text !== 'string' || value.text.length > DICTATION_MAX_TEXT_LENGTH || !['listening', 'finishing', 'finished', 'failed'].includes(value.phase)) throw new Error(value.error?.message || '实时听写返回格式无效')
        if (!ready) { if (value.phase !== 'listening') throw new Error(value.error?.message || '实时听写连接失败'); ready = true; clearTimeout(timeout); resolve(handle) }
        const final = value.phase === 'finished' || value.phase === 'failed'
        options.onUpdate(value)
        if (final) { terminal = true; dispose() }
      } catch (error) { fail(error instanceof Error ? error : new Error('实时听写返回格式无效')) }
    }
    socket.onerror = () => fail(new Error('实时听写连接失败，请重新开始；已写入文字仍保留'))
    socket.onclose = () => { if (!terminal) fail(new Error('实时听写连接已断开，请重新开始；已写入文字仍保留')); else dispose() }
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
  })
}
