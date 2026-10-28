import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ArkmeService } from './arkme-service.js'
import { ArkmePluginError } from './services/service.js'
import { DAY_REVIEW_LABELS } from './calendar-day-review.js'

const TTL = 5 * 60_000
const denied = () => new ArkmePluginError('day-review-human-required', '请在宿主确认页亲自确认本次生成', false, 403)
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
type Prepared = Record<string, unknown> & import('./calendar-day-review.js').DayReviewQuery
type Action = 'create' | 'resume' | 'reconcile'
interface Pending { input: Prepared; action: Action; account: string; nonce: string; expires: number; status: 'pending' | 'submitting' | 'ready' | 'failed'; result?: import('./calendar-day-review.js').DayReviewState; message?: string; error?: import('./types.js').ArkmePluginErrorBody; displayed: boolean }

/** The confirmation document is opaque-origin and script-free. Its CSRF nonce
 * is never available through SDK/JSON, same-origin fetch, parent DOM or frames.
 * A native browser navigation/form gesture is required at both boundaries. */
export class DayReviewConfirmation {
  private readonly pending = new Map<string, Pending>()
  constructor(private readonly service: Pick<ArkmeService, 'createDayReview' | 'resumeDayReview' | 'reconcileDayReview' | 'dayReviewConfirmationAccount'>) {}
  async prepare(input: Prepared, action: Action, signal: AbortSignal, id: string) {
    for (const [id, p] of this.pending) if (p.expires < Date.now()) this.pending.delete(id)
    if (this.pending.size >= 32) throw new Error('待确认请求过多，请稍后重试')
    if (!['create', 'resume', 'reconcile'].includes(action)) throw denied()
    const account = await this.service.dayReviewConfirmationAccount(input, signal)
    if (!/^[a-f0-9-]{36}$/.test(id) || this.pending.has(id)) throw denied()
    this.pending.set(id, { input: structuredClone(input), action, account, nonce: randomBytes(32).toString('hex'), expires: Date.now() + TTL, status: 'pending', displayed: false })

  }
  async status(id: string) {
    const p = await this.requirePending(id)
    return { status: p.status, ...(p.result ? { result: p.result } : {}), ...(p.message ? { message: p.message } : {}), ...(p.error ? { error: p.error } : {}) }
  }
  private async requirePending(id: string) {
    const p = this.pending.get(id)
    if (!p || p.expires < Date.now() || p.account !== await this.service.dayReviewConfirmationAccount(p.input)) throw denied()
    return p
  }
  async handle(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    if (req.headers['sec-fetch-dest'] !== 'document' || req.headers['sec-fetch-mode'] !== 'navigate' || req.headers['sec-fetch-user'] !== '?1') throw denied()
    const p = await this.requirePending(id)
    if (req.method === 'GET') {
      if (p.status !== 'pending') { this.page(res, '该请求已处理，请返回插件查看状态。'); return }
      p.displayed = true
      const sources = Array.isArray(p.input.sourceKinds) ? p.input.sourceKinds.map(x => escape(DAY_REVIEW_LABELS[x as keyof typeof DAY_REVIEW_LABELS] ?? String(x))).join('、') : '沿用原任务的来源'
      const action = { create: '生成', resume: '恢复', reconcile: '核对并重试' }[p.action]
      this.page(res, `<h1>确认${action}日回顾</h1><p>日期：${escape(p.input.bucketDate)}（${escape(p.input.timezone)}）</p><p>来源：${sources}</p><p>模型：${escape(String(p.input.modelCode ?? '沿用默认或原任务模型'))}</p><p>这会使用 AI 并可能消耗积分。关闭此页不会提交。</p><details><summary>本次请求参数</summary><pre>${escape(JSON.stringify(p.input, null, 2))}</pre></details><form method="post"><input type="hidden" name="nonce" value="${p.nonce}"><button type="submit">确认${action}</button></form>`, true)
      return
    }
    if (req.method !== 'POST' || req.headers.origin !== 'null' || !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded') || !p.displayed || p.status !== 'pending') throw denied()
    let body = ''
    for await (const part of req) { body += String(part); if (body.length > 1024) throw denied() }
    const nonce = new URLSearchParams(body).get('nonce') ?? ''
    if (!/^[a-f0-9]{64}$/.test(nonce) || !timingSafeEqual(Buffer.from(nonce), Buffer.from(p.nonce))) throw denied()
    p.status = 'submitting'; p.nonce = ''
    try { p.result = await this.service[({ create: 'createDayReview', resume: 'resumeDayReview', reconcile: 'reconcileDayReview' } as const)[p.action]](p.input); p.status = 'ready'; this.page(res, '生成请求已提交。请返回插件查看进度，可以关闭此页。') }
    catch (error) {
      p.status = 'failed'
      if (error instanceof ArkmePluginError) p.error = { code: error.code, message: error.message, retryable: error.retryable }
      p.message = p.error?.message ?? '提交未确认，请返回插件查询状态'
      this.page(res, p.message)
    }
  }
  private page(res: ServerResponse, content: string, html = false) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "sandbox allow-forms; default-src 'none'; style-src 'unsafe-inline'; form-action http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'; base-uri 'none'",
      'Cross-Origin-Opener-Policy': 'same-origin', 'X-Frame-Options': 'DENY' })
    res.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><title>确认日总结生成</title><style>body{font:18px system-ui;max-width:600px;margin:10vh auto;padding:24px;line-height:1.6}button{font:inherit;padding:12px 24px;cursor:pointer}</style><main>${html ? content : escape(content)}</main></html>`)
  }
}
