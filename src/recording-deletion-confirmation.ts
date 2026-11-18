import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { RECORDING_DELETION_CONFIRMATION_QUERY, type RecordingDeletionFile, type RecordingDeletionPermission, type RecordingDeletionRequest, type RecordingDeletionSelection } from './recording-deletion-contract.js'
import { recordingZonedDate } from './recording-time.js'
import { ArkmePluginError } from './services/service.js'
import type { RecordingService } from './services/recording-service.js'

const TTL = 10 * 60_000
const denied = () => new ArkmePluginError('recording-delete-confirmation-invalid', '确认已失效，请回到 DSH 重新生成删除清单', false, 403)
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

interface PendingDeletion {
  scope: string
  permission: RecordingDeletionPermission
  input: RecordingDeletionRequest
  selection: RecordingDeletionSelection
  expires: number
  nonce: string
  displayed: boolean
  status: 'pending' | 'deleting' | 'finished' | 'cancelled' | 'changed'
  results: { file: RecordingDeletionFile; status: 'deleted' | 'unconfirmed' }[]
}

export class RecordingDeletionConfirmations {
  private readonly pending = new Map<string, PendingDeletion>()
  private readonly busyAccounts = new Set<string>()
  private preparing = 0
  private accountGeneration = 0

  constructor(private readonly recording: Pick<RecordingService, 'recordingDeletionPermission' | 'recordingDeletionSelection' | 'deleteRecordingFromConfirmedSelection'>, private readonly path: string) {}

  invalidate(): void {
    this.accountGeneration++
    this.pending.clear()
  }

  async prepare(input: RecordingDeletionRequest, signal?: AbortSignal) {
    const accountGeneration = this.accountGeneration
    const { scope, permission } = await this.recording.recordingDeletionPermission(undefined, undefined, signal)
    if (!permission) return { status: 'disabled' as const }
    this.prune()
    if (this.pending.size + this.preparing >= 32 || this.preparing >= 2) {
      throw new ArkmePluginError('recording-delete-busy', '待确认录音清单过多，请先处理已有清单', true, 429)
    }
    this.preparing++
    try {
      const frozenInput = structuredClone(input)
      const selection = await this.recording.recordingDeletionSelection(frozenInput, permission.timeZone, signal)
      const current = await this.recording.recordingDeletionPermission(scope, undefined, signal)
      if (accountGeneration !== this.accountGeneration || current.permission?.generation !== permission.generation) throw denied()
      const summary = { days: selection.days, fileCount: selection.files.length,
        estimatedBytes: selection.files.reduce((sum, file) => sum + file.bytes, 0), timeZone: selection.timeZone }
      if (!selection.files.length) return { status: 'empty' as const, ...summary }
      const id = randomUUID()
      const expires = Date.now() + TTL
      this.pending.set(id, { scope, permission, input: frozenInput, selection, expires, nonce: randomBytes(32).toString('hex'), displayed: false, status: 'pending', results: [] })
      return { status: 'confirmation_required' as const, ...summary, planRef: id, expiresAtMillis: expires,
        path: `${this.path}?${RECORDING_DELETION_CONFIRMATION_QUERY}=${id}` }
    } finally { this.preparing-- }
  }

  async status(id: string, signal?: AbortSignal) {
    const plan = await this.requirePlan(id, signal)
    return { status: plan.status, fileCount: plan.selection.files.length,
      deleted: plan.results.filter(result => result.status === 'deleted').length,
      unconfirmed: plan.results.filter(result => result.status === 'unconfirmed').length,
      remaining: plan.selection.files.length - plan.results.length }
  }

  async handle(req: IncomingMessage, res: ServerResponse, id: string, signal: AbortSignal) {
    if (req.headers['sec-fetch-dest'] !== 'document' || req.headers['sec-fetch-mode'] !== 'navigate' || req.headers['sec-fetch-user'] !== '?1') throw denied()
    const plan = await this.requirePlan(id, signal)
    if (req.method === 'GET') {
      if (plan.status === 'pending') plan.displayed = true
      this.page(res, plan)
      return
    }
    if (req.method !== 'POST' || req.headers.origin !== 'null' || !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) throw denied()
    let body = ''
    for await (const part of req) {
      body += String(part)
      if (body.length > 1024) throw denied()
    }
    const form = new URLSearchParams(body)
    const nonce = form.get('nonce') ?? ''
    const decision = form.get('decision')
    if (this.pending.get(id) !== plan || plan.expires <= Date.now() || !plan.displayed || plan.status !== 'pending'
      || !/^[a-f0-9]{64}$/.test(nonce) || !timingSafeEqual(Buffer.from(nonce), Buffer.from(plan.nonce))
      || decision !== 'cancel' && decision !== 'delete') throw denied()
    if (decision === 'delete' && this.busyAccounts.has(plan.scope)) {
      throw new ArkmePluginError('recording-delete-busy', '已有录音批次正在处理，请稍后再试', true, 409)
    }
    plan.nonce = ''
    if (decision === 'cancel') {
      plan.status = 'cancelled'
      this.page(res, plan)
      return
    }
    plan.status = 'deleting'
    this.busyAccounts.add(plan.scope)
    try {
      const authorize = async () => { await this.requirePlan(id) }
      await authorize()
      const current = await this.recording.recordingDeletionSelection(plan.input, plan.permission.timeZone, signal)
      if (JSON.stringify(current) !== JSON.stringify(plan.selection)) {
        plan.status = 'changed'
      } else {
        for (const file of plan.selection.files) {
          if (signal.aborted) break
          await authorize()
          try {
            await this.recording.deleteRecordingFromConfirmedSelection(file.sessionId, plan.scope, authorize)
            plan.results.push({ file, status: 'deleted' })
          } catch {
            plan.results.push({ file, status: 'unconfirmed' })
          }
        }
        plan.status = 'finished'
      }
    } catch {
      plan.status = plan.results.length ? 'finished' : 'changed'
    } finally {
      this.busyAccounts.delete(plan.scope)
      plan.expires = Date.now() + TTL
    }
    this.page(res, plan)
  }

  private prune() {
    for (const [id, plan] of this.pending) if (plan.expires <= Date.now() && plan.status !== 'deleting') this.pending.delete(id)
  }

  private async requirePlan(id: string, signal?: AbortSignal) {
    const plan = this.pending.get(id)
    if (!plan || plan.expires <= Date.now()) throw denied()
    const { permission } = await this.recording.recordingDeletionPermission(plan.scope, undefined, signal)
    if (permission?.generation !== plan.permission.generation || this.pending.get(id) !== plan) throw denied()
    return plan
  }

  private page(res: ServerResponse, plan: PendingDeletion) {
    const { selection, status } = plan
    const bytes = selection.files.reduce((sum, file) => sum + file.bytes, 0)
    const formatter = new Intl.DateTimeFormat('zh-CN', { timeZone: selection.timeZone, dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' })
    const mib = (value: number) => `${(value / 1048576).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} MiB`
    const dayList = selection.days.map(day => `<li>${escape(day.date)} · ${day.bytes === null ? '大小待核实' : mib(day.bytes)}${day.selected ? '' : ' · 未入选'}</li>`).join('')
    const files = selection.files.map((file, index) => {
      const result = plan.results[index]?.status
      const crossesDay = recordingZonedDate(file.startAt, selection.timeZone) !== recordingZonedDate(file.endAt - 1, selection.timeZone)
      return `<li><strong>${escape(file.fileName || '录音')}</strong> · ${mib(file.bytes)}${crossesDay ? ' · 跨日' : ''}<small>${escape(formatter.format(file.startAt))} – ${escape(formatter.format(file.endAt))}${result === 'deleted' ? ' · 已删除' : result === 'unconfirmed' ? ' · 结果待核对' : status === 'finished' ? ' · 未提交' : ''}</small></li>`
    }).join('')
    const count = selection.days.filter(day => day.selected).length
    const threshold = typeof plan.input.aboveBytes === 'number' ? `<p>每日云端录音存储 &gt; ${mib(plan.input.aboveBytes)}</p>` : ''
    const deleted = plan.results.filter(result => result.status === 'deleted').length
    const receipt = status === 'finished' ? `已删除 ${deleted} 份，${plan.results.length - deleted} 份结果待核对，${selection.files.length - plan.results.length} 份未提交。可返回 DSH 查看结果。`
      : status === 'changed' ? '清单或权限已变化。请回到 DSH 重新核对。'
      : status === 'cancelled' ? '已取消。'
      : '正在处理，请稍后查看结果。'
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Cross-Origin-Opener-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "sandbox allow-forms; default-src 'none'; style-src 'unsafe-inline'; form-action http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'; base-uri 'none'" })
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>确认删除录音 · 即我</title><style>
      :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:660px;padding:28px;margin:auto}h1{font-size:22px;margin:0 0 12px}p{margin:8px 0}small{display:block;opacity:.78}strong{overflow-wrap:anywhere}details{margin:12px 0}summary{cursor:pointer;font-weight:600}ul{max-height:36vh;overflow:auto;padding-left:24px}li{margin:8px 0}form{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-top:24px}button{font:inherit;border:1px solid GrayText;border-radius:8px;padding:8px 14px;cursor:pointer}button[value=delete]{background:#b7202a;color:white;border-color:#b7202a}
      </style><main><h1>${status === 'pending' ? '确认删除整份录音' : '录音删除结果'}</h1>${status === 'pending'
        ? `${threshold}<p>${count} 天 · ${selection.files.length} 份录音 · 预计释放 ${mib(bytes)}</p><p>将永久删除整份音频及关联录音数据，跨日部分也会受影响。</p>`
        : `<p role="status">${receipt}</p>`}
      <p>时区 ${escape(selection.timeZone)}</p><details><summary>查看筛选日期</summary><ul>${dayList}</ul></details><details><summary>查看录音文件及跨日影响</summary><ul>${files}</ul></details>
      ${status === 'pending' ? `<form method="post"><input type="hidden" name="nonce" value="${plan.nonce}"><button name="decision" value="cancel">取消</button><button name="decision" value="delete">确认删除 ${selection.files.length} 份录音</button></form>` : ''}</main></html>`)
  }
}
