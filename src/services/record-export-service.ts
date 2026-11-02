import type { Readable } from 'node:stream'
import { mkdtemp, mkdir, open, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ZipFile } from 'yazl'
import { GeneratedArtifacts } from '../generated-artifacts.js'
import type { ArkmeRecordExportOptions, ArkmeRecordExport, ArkmeRecordExportProgress } from '../data-management.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

export const RECORD_EXPORT_PREFIX = 'arkme-record-export-v1'
const MAX_BYTES = 1024 * 1024 * 1024
const invalid = () => new ArkmePluginError('record-export-incomplete', '导出内容不完整，未生成备份，请重试', true, 502)
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  return value as Record<string, unknown>
}
function text(value: unknown): string { if (typeof value !== 'string') throw invalid(); return value }
function number(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid(); return value as number }
function rows(value: unknown, limit: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > limit) throw invalid()
  return value.map(object)
}
function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 100) || 'attachment'
}
function mediaUrl(environment: string, raw: unknown): URL {
  let url: URL
  try { url = new URL(text(raw)) } catch { throw invalid() }
  const hosts = environment === 'prod'
    ? ['jotmo-userfiles.oss-cn-hangzhou.aliyuncs.com', 'userfiles.jotmo.cc', 'jotmo-useraudio.oss-cn-hangzhou.aliyuncs.com']
    : ['jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com', 'jotmo-userfiles.senguo.me', 'jotmo-useraudio-test.oss-cn-hangzhou.aliyuncs.com']
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !hosts.includes(url.hostname)) throw invalid()
  return url
}

/** One request-scoped export, bounded disk spooling and a streamed ZIP. Signed
 * media URLs stay in this owner and are never returned to consumers. */
export class RecordExportService {
  private controller: AbortController | undefined
  private readonly root: string
  private readonly generated: GeneratedArtifacts
  constructor(private readonly runtime: ServiceRuntime) {
    this.root = join(runtime.config.fileStateDirectory ?? join(homedir(), '.arkme'), 'record-exports', runtime.config.environment)
    this.generated = new GeneratedArtifacts(this.root, () => runtime.stateStore.uniqueCode(),
      async () => (await runtime.requireSession()).userId, undefined,
      { prefix: RECORD_EXPORT_PREFIX, extension: 'zip', mimeType: 'application/zip' })
  }
  dispose(): void { this.controller?.abort() }
  read(ref: string) { return this.generated.read(ref) }
  async run(options: ArkmeRecordExportOptions, parent?: AbortSignal, progress?: (value: ArkmeRecordExportProgress) => void): Promise<ArkmeRecordExport> {
    if (options.confirmed !== true || ![1, 2].includes(options.orderKind)) throw new ArkmePluginError('record-export-confirmation-required', '请确认导出范围和次数后再开始', false, 400)
    if (this.controller) throw new ArkmePluginError('record-export-busy', '已有导出正在进行，请稍后重试', true, 429)
    const controller = new AbortController(); this.controller = controller
    const signal = AbortSignal.any([controller.signal, ...(parent ? [parent] : [])])
    const timeout = setTimeout(() => controller.abort(), 30 * 60_000)
    let sessionUid = '', scratch = '', finishAttempted = false
    const session = await this.runtime.requireSession().catch(error => { clearTimeout(timeout); this.controller = undefined; throw error })
    const scope = `${this.runtime.config.environment}:${session.userId}`
    const assertAccount = async () => {
      signal.throwIfAborted()
      const current = await this.runtime.requireSession()
      if (options.expectedAccountScope !== scope || current.userId !== session.userId || current.refreshToken !== session.refreshToken
        || scope !== `${this.runtime.config.environment}:${current.userId}`) throw new ArkmePluginError('record-export-account-changed', '账号已切换，请重新打开导出', false, 409)
    }
    const post = async (path: string, body: Record<string, unknown>, read = false) => {
      await assertAccount()
      const result = await this.runtime.authenticatedPost<Record<string, unknown>>(`/api/v1/records/export/${path}`, body, session, signal,
        read ? { lane: 'interactive-read', bypassCache: true, cacheMs: 0 } : undefined)
      await assertAccount(); return object(result)
    }
    let count = 0, bytes = 0, attachmentCount = 0, lastProgress = 0
    const report = (force = false) => { if (force || Date.now() - lastProgress >= 250) { lastProgress = Date.now(); try { progress?.({ count }) } catch { /* UI observers do not own export. */ } } }
    try {
      await assertAccount()
      const start = await post('session/start', { order_kind: options.orderKind, hide_record_privacy_lock: true })
      if (start.can_export !== true) throw new ArkmePluginError('record-export-blocked', '当前导出额度不足或暂不满足导出条件，请刷新后重试', false, 409)
      sessionUid = text(start.export_session_uid)
      const expectedCount = number(start.record_count)
      if (!sessionUid || expectedCount > 100_000) throw invalid()
      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '')
      const fileName = `Jotmo${expectedCount}条快记_导出时间${stamp}.zip`
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      scratch = await mkdtemp(join(this.root, 'working-'))
      const markdownPath = join(scratch, 'records.md'), markdown = await open(markdownPath, 'wx', 0o600)
      report(true)
      let generated
      try {
        generated = await this.generated.create(session.userId, fileName, async write => {
          const zip = new ZipFile()
          const output = zip.outputStream as Readable
          const abort = () => output.destroy(new Error('export cancelled'))
          signal.addEventListener('abort', abort, { once: true })
          zip.on('error', error => output.destroy(error))
          const pump = (async () => { for await (const chunk of zip.outputStream) await write(chunk as Buffer) })()
          // Observe immediately even if disk backpressure fails during an upstream request.
          void pump.catch(() => controller.abort())
          try {
            let cursorAt = 0, cursorUid = '', date = ''
            const seen = new Set<string>()
            for (let pageIndex = 0; ; pageIndex++) {
              if (pageIndex >= 1001) throw invalid()
              const page = await post('records/page', { export_session_uid: sessionUid, limit: 100,
                ...(cursorAt ? { cursor_send_at: cursorAt, cursor_record_uid: cursorUid } : {}) }, true)
              const items = rows(page.items, 100)
              const refs = items.flatMap(item => rows(item.file_refs, 100))
              const signed = new Map<string, Record<string, unknown>>()
              // Signing requests also stay bounded when a page contains many attachments.
              for (let i = 0; i < refs.length; i += 100) {
                const response = await post('files/batch-sign', { export_session_uid: sessionUid,
                  file_asset_uids: [...new Set(refs.slice(i, i + 100).map(ref => text(ref.file_asset_uid)))],
                  record_uids: items.map(item => text(item.record_uid)) }, true)
                for (const file of rows(response.items, 100)) signed.set(text(file.file_asset_uid), file)
              }
              for (const item of items) {
                const recordUid = text(item.record_uid)
                if (!recordUid || seen.has(recordUid) || ++count > expectedCount) throw invalid()
                seen.add(recordUid)
                const at = new Date(number(item.send_at))
                if (!Number.isFinite(at.getTime())) throw invalid()
                const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
                let content = date === day ? '' : `## [[${day}]]\n`
                date = day
                content += `### ${at.getFullYear()}年${at.getMonth() + 1}月${at.getDate()}日 ${at.toTimeString().slice(0, 8)}\n\n`
                const title = text(item.title ?? '').trim(), body = text(item.text ?? '').trim()
                content += [title && title !== body ? title : '', body].filter(Boolean).join('\n\n').replaceAll('```', '') + '\n\n'
                for (const ref of rows(item.file_refs, 100)) {
                  if (++attachmentCount > 60_000) throw invalid()
                  const file = signed.get(text(ref.file_asset_uid))
                  if (!file || file.method !== 'GET') throw invalid()
                  const size = number(file.size)
                  if (bytes + size > MAX_BYTES) throw invalid()
                  const url = mediaUrl(this.runtime.config.environment, file.url)
                  const headers = object(file.headers ?? {})
                  // The contract signs GET query URLs; only signed OSS headers are forwarded.
                  if (Object.keys(headers).some(key => !/^x-oss-/i.test(key) || typeof headers[key] !== 'string')) throw invalid()
                  const path = join(scratch, `${attachmentCount}`), target = await open(path, 'wx', 0o600)
                  const download = new AbortController(), timer = setTimeout(() => download.abort(), 120_000)
                  let response: Response | undefined
                  try {
                    response = await this.runtime.fetchImpl(url, { method: 'GET', redirect: 'error', headers: headers as Record<string, string>, signal: AbortSignal.any([signal, download.signal]) })
                    if (!response.ok || !response.body) throw invalid()
                    let received = 0
                    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
                      await assertAccount(); received += chunk.byteLength
                      if ((size > 0 && received > size) || bytes + received > MAX_BYTES) throw invalid()
                      await target.writeFile(chunk)
                    }
                    if (size > 0 && received !== size) throw invalid()
                    bytes += received
                  } finally { clearTimeout(timer); download.abort(); await response?.body?.cancel().catch(() => undefined); await target.close() }
                  const zipPath = `${ref.file_kind === 2 ? 'voice' : 'pic'}/${attachmentCount}-${safeName(text(ref.suggested_name ?? 'attachment'))}`
                  zip.addFile(path, zipPath, { compress: false })
                  const link = `./${zipPath.split('/').map(encodeURIComponent).join('/')}`
                  content += ref.file_kind === 2 ? `[语音](${link})\n` : `![图片](${link})\n`
                }
                bytes += Buffer.byteLength(content)
                if (bytes > MAX_BYTES) throw invalid()
                await markdown.writeFile(content)
                report()
              }
              if (typeof page.has_more !== 'boolean') throw invalid()
              if (!page.has_more) break
              const nextAt = number(page.next_cursor_send_at), nextUid = text(page.next_cursor_record_uid)
              if (!items.length || !nextAt || !nextUid || (nextAt === cursorAt && nextUid === cursorUid)) throw invalid()
              cursorAt = nextAt; cursorUid = nextUid
            }
            if (count !== expectedCount) throw invalid()
            await markdown.sync()
            zip.addFile(markdownPath, `Jotmo${stamp}.md`, { compress: false }); zip.end()
            await pump; await assertAccount()
            return count
          } finally {
            signal.removeEventListener('abort', abort)
            output.destroy()
            await pump.catch(() => undefined)
          }
        }, signal)
      } finally { await markdown.close() }
      // Once published, an uncertain finish response must not trigger another
      // export or a contradictory failure write. Keep the usable download.
      finishAttempted = true
      let quotaFinalized = true
      try { await post('session/finish', { export_session_uid: sessionUid, success: true }) } catch { quotaFinalized = false }
      await assertAccount(); report(true)
      return { ...generated.file, accountScope: scope, count, quotaFinalized }
    } catch (error) {
      if (sessionUid && !finishAttempted) {
        const current = await this.runtime.requireSession().catch(() => undefined)
        if (current?.userId === session.userId && current.refreshToken === session.refreshToken && scope === `${this.runtime.config.environment}:${current.userId}`) {
          await this.runtime.authenticatedPost('/api/v1/records/export/session/finish', { export_session_uid: sessionUid, success: false,
            failure_code: 'plugin_export_failed', failure_message: '导出取消或备份生成失败' }, session, AbortSignal.timeout(10_000)).catch(() => undefined)
        }
      }
      if (error instanceof ArkmePluginError) throw error
      throw new ArkmePluginError('record-export-failed', signal.aborted ? '导出已取消或超时' : '导出失败，请重试', true, 502)
    } finally {
      clearTimeout(timeout)
      if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => undefined)
      this.controller = undefined
    }
  }
}
