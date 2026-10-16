import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ArkmeService } from './arkme-service.js'
import { ArkmePluginError } from './services/service.js'
import { DAY_REVIEW_LABELS, type DayReviewState } from './calendar-day-review.js'

const TTL = 5 * 60_000
const denied = () => new ArkmePluginError('day-digest-human-required', '请在宿主确认页亲自确认本次生成', false, 403)
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
type Prepared = Awaited<ReturnType<ArkmeService['prepareDayReview']>>
interface Pending { input: Prepared; nonce: string; expires: number; status: 'pending' | 'submitting' | 'ready' | 'failed'; result?: DayReviewState; message?: string; displayed: boolean }

/** The confirmation document is opaque-origin and script-free. Its CSRF nonce
 * is never available through SDK/JSON, same-origin fetch, parent DOM or frames.
 * A native browser navigation/form gesture is required at both boundaries. */
export class DayDigestConfirmation {
  private readonly pending = new Map<string, Pending>()
  constructor(private readonly service: Pick<ArkmeService, 'prepareDayReview' | 'createDayReview' | 'dayDigestAccountScope'>) {}
  async prepare(input: unknown, path: string, signal?: AbortSignal, requestedId?: string) {
    for (const [id, p] of this.pending) if (p.expires < Date.now()) this.pending.delete(id)
    if (this.pending.size >= 32) throw new Error('待确认请求过多，请稍后重试')
    const prepared = await this.service.prepareDayReview(input, signal)
    const id = requestedId ?? randomUUID()
    if (!/^[a-f0-9-]{36}$/.test(id) || this.pending.has(id)) throw denied()
    this.pending.set(id, { input: structuredClone(prepared), nonce: randomBytes(32).toString('hex'), expires: Date.now() + TTL, status: 'pending', displayed: false })
    return { confirmationId: id, confirmationUrl: `${path}?dayDigestConfirmation=${id}`, expiresAtMillis: Date.now() + TTL }
  }
  async status(id: string) {
    const p = await this.requirePending(id)
    return { status: p.status, ...(p.result ? { result: p.result } : {}), ...(p.message ? { message: p.message } : {}) }
  }
  private async requirePending(id: string) {
    const p = this.pending.get(id)
    if (!p || p.expires < Date.now() || p.input.accountScope !== await this.service.dayDigestAccountScope()) throw denied()
    return p
  }
  async handle(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    if (req.headers['sec-fetch-dest'] !== 'document' || req.headers['sec-fetch-mode'] !== 'navigate' || req.headers['sec-fetch-user'] !== '?1') throw denied()
    const p = await this.requirePending(id)
    if (req.method === 'GET') {
      if (p.status !== 'pending') { this.page(res, '该请求已处理，请返回插件查看状态。'); return }
      p.displayed = true
      this.page(res, `<h1>生成日总结</h1><p>日期：${escape(p.input.bucketDate)}（${escape(p.input.timezone)}）</p><p>来源：${p.input.sourceKinds.map(x => escape(DAY_REVIEW_LABELS[x])).join('、')}</p><p>生成：${p.input.kinds.map(x => x === 'summary' ? '日总结' : '时间轴').join('、')}。这会使用 AI；关闭此页不会提交。</p><form method="post"><input type="hidden" name="nonce" value="${p.nonce}"><button type="submit">确认生成</button></form>`, true)
      return
    }
    if (req.method !== 'POST' || req.headers.origin !== 'null' || !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded') || !p.displayed || p.status !== 'pending') throw denied()
    let body = ''
    for await (const part of req) { body += String(part); if (body.length > 1024) throw denied() }
    const nonce = new URLSearchParams(body).get('nonce') ?? ''
    if (nonce.length !== p.nonce.length || !timingSafeEqual(Buffer.from(nonce), Buffer.from(p.nonce))) throw denied()
    p.status = 'submitting'; p.nonce = ''
    try { p.result = await this.service.createDayReview(p.input); p.status = 'ready'; this.page(res, '生成请求已提交。请返回插件查看进度，可以关闭此页。') }
    catch (error) { p.status = 'failed'; p.message = error instanceof Error ? error.message : '提交未确认，请返回插件查询状态'; this.page(res, escape(p.message), true) }
  }
  private page(res: ServerResponse, content: string, html = false) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "sandbox allow-forms; default-src 'none'; style-src 'unsafe-inline'; form-action http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'; base-uri 'none'",
      'Cross-Origin-Opener-Policy': 'same-origin', 'X-Frame-Options': 'DENY' })
    res.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><title>确认日总结生成</title><style>body{font:18px system-ui;max-width:600px;margin:10vh auto;padding:24px;line-height:1.6}button{font:inherit;padding:12px 24px;cursor:pointer}</style><main>${html ? content : escape(content)}</main></html>`)
  }
}
