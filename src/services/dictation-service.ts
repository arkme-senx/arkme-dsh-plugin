import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { ArkmePluginError, objectValue, stringValue, type ServiceRuntime } from './service.js'

const MAX_PCM_BYTES = 16_000 * 2 * 12
const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(objectValue) : []
interface Attempt { hash: string; fileName?: string; requested?: boolean; text?: string; running?: Promise<{ text: string }>; at: number }

/** The same private short-voice owner as Flutter. Audio and credentials never enter a message. */
export class DictationService {
  private attempts = new Map<string, Attempt>()
  private generation = 0
  constructor(private runtime: ServiceRuntime) {}
  dispose() { this.generation++; this.attempts.clear() }

  async transcribe(input: { expectedUserId: number; segmentId: string; pcm: string }, signal?: AbortSignal): Promise<{ text: string }> {
    const session = await this.runtime.requireSession()
    if (session.userId !== input.expectedUserId) throw new ArkmePluginError('dictation-account-changed', '登录账号已变化，听写已停止', false, 409)
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(input.segmentId) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.pcm) || input.pcm.length > Math.ceil(MAX_PCM_BYTES / 3) * 4) {
      throw new ArkmePluginError('dictation-invalid', '听写音频格式无效', false, 400)
    }
    const pcm = Buffer.from(input.pcm, 'base64')
    if (pcm.length < 3200 || pcm.length > MAX_PCM_BYTES || pcm.length % 2) throw new ArkmePluginError('dictation-invalid', '听写片段应为 0.1 至 12 秒的单声道音频', false, 400)
    const key = `${session.userId}:${input.segmentId}`, hash = createHash('sha256').update(pcm).digest('hex')
    const now = Date.now()
    for (const [id, value] of this.attempts) if (!value.running && now - value.at > 15 * 60_000) this.attempts.delete(id)
    let attempt = this.attempts.get(key)
    if (attempt && attempt.hash !== hash) throw new ArkmePluginError('dictation-conflict', '听写片段已变化，请重新开始', false, 409)
    if (attempt?.text !== undefined) return { text: attempt.text }
    if (attempt?.running) return await attempt.running
    if ([...this.attempts.values()].filter(value => value.running).length >= 2) throw new ArkmePluginError('dictation-busy', '正在识别其他语音，请稍后重试', true, 429)
    if (this.attempts.size >= 300) throw new ArkmePluginError('dictation-busy', '听写请求过多，请稍后重试', true, 429)
    if (!attempt) { attempt = { hash, at: now }; this.attempts.set(key, attempt) }
    const generation = this.generation
    const check = async () => {
      signal?.throwIfAborted()
      if (generation !== this.generation || (await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('dictation-account-changed', '登录账号已变化，听写已停止', false, 409)
    }
    const step = async <T>(name: 'upload' | 'start' | 'result', action: () => Promise<T>): Promise<T> => {
      try { return await action() }
      catch (error) {
        signal?.throwIfAborted()
        const label = { upload: '听写音频上传', start: '语音识别启动', result: '识别结果读取' }[name]
        const status = error instanceof ArkmePluginError ? error.upstreamStatus ?? error.httpStatus : undefined
        // Operational evidence only: no tokens, audio, transcript, storage key, or upstream response body.
        console.warn('[ArkmeDictation]', JSON.stringify({ stage: name, segmentId: input.segmentId, upstreamStatus: status, code: error instanceof ArkmePluginError ? error.code : 'transport-failed' }))
        throw new ArkmePluginError(`dictation-${name}-failed`, `${label}失败${status ? `（HTTP ${status}）` : ''}，请重试；已写入的文字仍保留`, true, 502, { ...(status ? { upstreamStatus: status } : {}), cause: error })
      }
    }
    const run = async () => {
      await check()
      if (!attempt.fileName) {
        const wav = Buffer.alloc(44 + pcm.length)
        wav.write('RIFF'); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8)
        wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
        wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
        wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44)
        const form = new FormData()
        form.set('sec', String(Math.ceil(pcm.length / 32000)))
        form.set('file', new Blob([wav], { type: 'audio/wav' }), `dictation-${input.segmentId}.wav`)
        const uploaded = await step('upload', () => this.runtime.authenticatedAuthMultipartPost<Record<string, unknown>>('/api/v1/premium/upload/short-voice', form, session, signal))
        attempt.fileName = stringValue(uploaded.fileName) || stringValue(uploaded.file_name)
        if (!attempt.fileName) throw new ArkmePluginError('dictation-contract', '语音上传未返回有效凭据，请重试', true, 502)
      }
      await check()
      if (!attempt.requested) {
        const started = await step('start', () => this.runtime.authenticatedAuthPost<Record<string, unknown>>('/api/v1/premium/trans/short-voice', { file_ls: [{ name: attempt.fileName, sec: Math.ceil(pcm.length / 32000) }] }, session, signal))
        if (Array.isArray(started.unable_file_name_ls) && started.unable_file_name_ls.includes(attempt.fileName)) throw new ArkmePluginError('dictation-quota', '语音转文字权益不足，请查看会员权益后重试', false, 403)
        attempt.requested = true
      }
      const deadline = Date.now() + 90_000
      while (Date.now() < deadline) {
        await check()
        const result = await step('result', () => this.runtime.authenticatedAuthReadPost<Record<string, unknown>>('/api/v1/premium/list/short-voice-trans', { file_name_ls: [attempt.fileName] }, session, signal, { bypassCache: true }))
        await check()
        const ready = rows(result.trans_already_ls).find(row => row.file_name === attempt.fileName)
        if (ready) {
          if (typeof ready.trans_text !== 'string' || ready.trans_text.length > 20_000) throw new ArkmePluginError('dictation-contract', '语音识别结果格式异常，请重试', true, 502)
          attempt.text = ready.trans_text; attempt.at = Date.now()
          return { text: attempt.text }
        }
        if (['trans_failed_ls', 'oss_no_exist_ls', 'no_req_trans_ls'].some(name => rows(result[name]).some(row => row.file_name === attempt.fileName))) {
          attempt.requested = false
          throw new ArkmePluginError('dictation-failed', '这段语音未能识别，请重试', true, 502)
        }
        if (!rows(result.waiting_trans_ls).some(row => row.file_name === attempt.fileName)) throw new ArkmePluginError('dictation-contract', '语音识别状态暂不可确认，请重试', true, 502)
        await delay(1500, undefined, signal ? { signal } : undefined)
      }
      throw new ArkmePluginError('dictation-timeout', '语音识别仍在处理中，可重试读取结果', true, 504)
    }
    attempt.running = run().finally(() => { delete attempt.running })
    return await attempt.running
  }
}
