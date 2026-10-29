import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ArkmeService } from './arkme-service.js'
import { ArkmePluginError } from './services/service.js'
import { DAY_REVIEW_LABELS } from './calendar-day-review.js'
import { arkmeTheme as colors } from './client/arkme-theme.js'

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
    if (!['create', 'resume', 'reconcile'].includes(action)) throw denied()
    const account = await this.service.dayReviewConfirmationAccount(input, signal)
    if (this.pending.size >= 32) throw new Error('待确认请求过多，请稍后重试')
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
    const theme = new URL(req.url ?? '/', 'http://localhost').searchParams.get('theme')
    if (req.method === 'GET') {
      if (p.status !== 'pending') { this.page(res, p.message ?? '请求已提交，请返回日历查看进度。', false, theme); return }
      p.displayed = true
      const sources = Array.isArray(p.input.sourceKinds) ? p.input.sourceKinds.map(x => escape(DAY_REVIEW_LABELS[x as keyof typeof DAY_REVIEW_LABELS] ?? String(x))).join('、') : '沿用原任务的来源'
      const title = { create: '生成当天回顾', resume: '继续生成回顾', reconcile: '核对上次提交' }[p.action]
      const description = { create: '将所选资料整理为当天的日总结和时间轴。', resume: '从上次中断处继续，保留已完成的内容。', reconcile: '先核对上次请求是否已受理，避免重复创建任务。' }[p.action]
      const action = { create: '确认生成', resume: '继续生成', reconcile: '确认核对' }[p.action]
      const billing = p.action === 'resume' ? '已完成步骤会复用，不重复收费；剩余步骤仍会消耗 AI 积分。' : p.action === 'reconcile' ? '核对本身不消耗积分。如需继续生成，后续步骤仍会消耗 AI 积分。' : '生成会消耗 AI 积分，按实际模型用量结算。'
      this.page(res, `<header><p class="eyebrow">日回顾</p><h1>${title}</h1><p class="description">${description}</p></header><dl><div><dt>日期</dt><dd>${escape(p.input.bucketDate)}<small>${escape(p.input.timezone)}</small></dd></div><div><dt>内容来源</dt><dd>${sources}</dd></div>${p.action === 'create' && p.input.modelCode ? `<div><dt>生成模型</dt><dd>${escape(String(p.input.modelCode))}</dd></div>` : ''}</dl><p class="billing">${billing}</p><form method="post"><input type="hidden" name="nonce" value="${p.nonce}"><footer><span>确认前不会提交或扣费</span><div class="actions"><button class="secondary" type="submit" name="decision" value="cancel">取消</button><button type="submit">${action}</button></div></footer></form>`, true, theme)
      return
    }
    if (req.method !== 'POST' || req.headers.origin !== 'null' || !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded') || !p.displayed || p.status !== 'pending') throw denied()
    let body = ''
    for await (const part of req) { body += String(part); if (body.length > 1024) throw denied() }
    const form = new URLSearchParams(body)
    const nonce = form.get('nonce') ?? ''
    if (!/^[a-f0-9]{64}$/.test(nonce) || !timingSafeEqual(Buffer.from(nonce), Buffer.from(p.nonce))) throw denied()
    if (form.get('decision') === 'cancel') {
      p.status = 'failed'; p.nonce = ''
      p.error = { code: 'day-review-human-required', message: '已取消，本次操作未提交。', retryable: false }
      p.message = p.error.message
      this.finish(req, res, id, theme); return
    }
    p.status = 'submitting'; p.nonce = ''
    try { p.result = await this.service[({ create: 'createDayReview', resume: 'resumeDayReview', reconcile: 'reconcileDayReview' } as const)[p.action]](p.input); p.status = 'ready'; this.finish(req, res, id, theme) }
    catch (error) {
      p.status = 'failed'
      if (error instanceof ArkmePluginError) p.error = { code: error.code, message: error.message, retryable: error.retryable }
      p.message = p.error?.message ?? '提交未确认，请返回插件查询状态'
      this.page(res, p.message, false, theme)
    }
  }
  private finish(req: IncomingMessage, res: ServerResponse, id: string, theme: string | null) {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    const query = new URLSearchParams({ dayReviewConfirmation: id, receipt: 'complete' })
    if (theme === 'dark' || theme === 'light') query.set('theme', theme)
    // The desktop closes this receipt redirect; ordinary browsers render the receipt.
    res.writeHead(303, { Location: `${path}?${query}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end()
  }
  private page(res: ServerResponse, content: string, html = false, theme?: string | null) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "sandbox allow-forms; default-src 'none'; style-src 'unsafe-inline'; form-action http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'; base-uri 'none'",
      'Cross-Origin-Opener-Policy': 'same-origin', 'X-Frame-Options': 'DENY' })
    res.end(`<!doctype html><html lang="zh"${theme === 'dark' || theme === 'light' ? ` data-theme="${theme}"` : ''}><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>日回顾 · 即我</title><style>
      :root{color-scheme:light;--surface:#fff;--soft:#f5f6f8}
      :root[data-theme=dark]{color-scheme:dark;--surface:#222326;--soft:#2c2d31;--dsw-alias-label-primary:#f1f2f4;--dsw-alias-label-secondary:#a5a8b0;--dsw-alias-border-l2:#3b3d43;--dsw-alias-button-primary-fill:#eeeff2;--dsw-alias-label-primary-inverted:#17191c}
      @media(prefers-color-scheme:dark){:root:not([data-theme]){color-scheme:dark;--surface:#222326;--soft:#2c2d31;--dsw-alias-label-primary:#f1f2f4;--dsw-alias-label-secondary:#a5a8b0;--dsw-alias-border-l2:#3b3d43;--dsw-alias-button-primary-fill:#eeeff2;--dsw-alias-label-primary-inverted:#17191c}}
      *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--surface);color:${colors.text};font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:100%;max-width:480px;padding:24px 28px}h1{font-size:20px;line-height:28px;font-weight:600;margin:0}.eyebrow{margin:0 0 8px;color:${colors.secondary};font-size:12px}.description{margin:8px 0 20px;color:${colors.secondary}}dl{margin:0 0 20px}dl>div{display:flex;gap:20px;padding:9px 0}dt{flex:0 0 64px;color:${colors.secondary}}dd{margin:0;flex:1;min-width:0;overflow-wrap:anywhere}small{display:block;color:${colors.secondary};font-size:12px}.billing{margin:0;padding:12px 14px;border-radius:10px;background:var(--soft);color:${colors.secondary};font-size:13px}footer{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:24px}.actions{display:flex;gap:10px;flex:none}.secondary{background:transparent;color:${colors.text};border:1px solid ${colors.border}}footer span{font-size:12px;color:${colors.secondary}}button{flex:none;height:36px;padding:0 18px;border:0;border-radius:9px;background:${colors.primaryAction};color:${colors.onPrimaryAction};font:inherit;font-size:14px;font-weight:500;cursor:pointer}button:hover{opacity:.88}button:focus-visible{outline:2px solid ${colors.accent};outline-offset:3px}.receipt{margin:12px 0;color:${colors.secondary}}@media(max-width:360px){main{padding:20px}footer{gap:10px}button{padding:0 12px}}
      </style><main>${html ? content : `<header><p class="eyebrow">日回顾</p><h1>操作结果</h1></header><p class="receipt" role="status">${escape(content)}</p>`}</main></html>`)
  }
}
