import type { ArkmeArkoExportProgress } from './arko-history-contract.js'
import { ARKO_IMAGE_DRAFT_LIMIT, ARKO_IMAGE_DRAFT_MAX_BYTES, ARKO_IMAGE_MIME_TYPES } from './arko-image-contract.js'
import { createHash } from 'node:crypto'
import { ArkmePluginError, objectValue } from './services/service.js'

const MAX_FRAME_BYTES = 32 * 1024 * 1024
const MAX_WIRE_BYTES = 1024 * 1024 * 1024 + 64 * 1024
const invalid = () => new ArkmePluginError('arko-export-incomplete', '导出内容不完整或校验失败，请重新导出', true, 502)
const runLabels: Record<string, string> = { queued: '排队中', running: '运行中', waiting_user: '等待继续', waiting_tool: '等待操作', completed: '已完成', partial: '部分完成', failed: '运行失败', cancelled: '已取消', expired: '已过期' }
const escapeHeading = (text: string) => text.replace(/[\r\n]/g, ' ').replace(/[\\`*_{}[\]<>#!|]/g, '\\$&')

function userBody(text: string): string {
  // User input is plain text. A dynamically longer fence preserves every byte
  // without turning HTML, headings or embedded backticks into active Markdown.
  let fenceLength = 3
  for (const match of text.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1)
  const fence = '`'.repeat(fenceLength)
  return `${fence}text\n${text}\n${fence}`
}
function imageDescriptions(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > ARKO_IMAGE_DRAFT_LIMIT) throw invalid()
  return value.map(raw => {
    const image = objectValue(raw)
    if (image.type !== 'image' || typeof image.file_name !== 'string' || Buffer.byteLength(image.file_name, 'utf8') > 1024 || /[\0\r\n]/.test(image.file_name)
      || typeof image.file_asset_uid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(image.file_asset_uid)
      || !ARKO_IMAGE_MIME_TYPES.some(mime => mime === image.mime_type)
      || !Number.isSafeInteger(image.size) || (image.size as number) <= 0 || (image.size as number) > ARKO_IMAGE_DRAFT_MAX_BYTES
      || typeof image.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(image.sha256)
      || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || (image.width as number) <= 0 || (image.height as number) <= 0
      || (image.width as number) > 8192 || (image.height as number) > 8192 || (image.width as number) * (image.height as number) > 40_000_000) throw invalid()
    return `${image.file_name || '图片'}（${String(image.mime_type)}，${String(image.size)} 字节）`
  })
}
/** Integrity is computed over untouched byte lines, never reserialized JSON. */
export async function consumeArkoExport(body: ReadableStream<Uint8Array>, signal: AbortSignal, write: (text: string) => Promise<void>, name: string, onProgress?: (progress: ArkmeArkoExportProgress) => void): Promise<number> {
  const reader = body.getReader(), digest = createHash('sha256')
  let pending: Buffer = Buffer.allocUnsafe(64 * 1024), pendingBytes = 0, state: 'initial' | 'items' | 'complete' = 'initial'
  let count = 0, bytes = 0, wire = 0
  const isComplete = () => state === 'complete'
  const acceptLine = async (line: Buffer) => {
    if (isComplete()) throw invalid()
    let frame: Record<string, unknown>
    try { frame = objectValue(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line))) } catch { throw invalid() }
    if (frame.kind === 'start' && state === 'initial' && frame.version === 'arko-export-v1') state = 'items'
    else if (frame.kind === 'item' && state === 'items') {
      const item = objectValue(frame.item)
      if ((item.role !== 2 && item.role !== 3) || typeof item.content !== 'string'
        || !Number.isSafeInteger(item.id) || !Number.isSafeInteger(item.session_id)
        || typeof item.created_at_ms !== 'number' || typeof item.order_at_ms !== 'number'
        || ![1, 2, 3, 5].includes(item.status as number) || ![1, 2].includes(item.source_type as number)) throw invalid()
      digest.update(line); count++; bytes += line.length
      const at = new Date(item.created_at_ms).toISOString()
      if (item.run_status !== undefined && (typeof item.run_status !== 'string' || item.run_status.length > 64)) throw invalid()
      const run = typeof item.run_status === 'string' ? item.run_status : ''
      const status = run ? ` · ${escapeHeading(Object.hasOwn(runLabels, run) ? runLabels[run]! : run)}` : item.status === 2 ? ' · 生成中' : item.status === 3 || item.status === 5 ? ' · 未完成' : ''
      const images = imageDescriptions(item.attachments)
      if (images.length && item.role !== 2) throw invalid()
      const text = item.role === 2 ? (item.content || !images.length ? userBody(item.content) : '') : item.content
      const attachments = images.length ? `\n\n图片附件（仅描述，不包含图片文件）：\n\n${userBody(images.map((image, index) => `${index + 1}. ${image}`).join('\n'))}` : ''
      await write(`## ${item.role === 2 ? '我' : escapeHeading(name)} · ${at}${status}\n\n来源：${item.source_type === 1 ? '历史助手' : 'Agent'} · 消息 ${String(item.id)}\n\n${text}${attachments}\n\n`)
      onProgress?.({ count })
    } else if (frame.kind === 'complete' && state === 'items' && frame.version === 'arko-export-v1') {
      if (frame.count !== count || frame.bytes !== bytes || frame.sha256 !== digest.digest('hex')) throw invalid()
      state = 'complete'
      await write(`共 ${count} 条消息。\n`)
    } else throw invalid()
  }
  try {
    await write(`# ${escapeHeading(name)} 对话记录\n\n导出时间：${new Date().toISOString()}\n\n`)
    while (true) {
      signal.throwIfAborted()
      const part = await reader.read()
      signal.throwIfAborted()
      if (part.done) break
      wire += part.value.byteLength
      if (wire > MAX_WIRE_BYTES) throw invalid()
      const chunk = Buffer.from(part.value.buffer, part.value.byteOffset, part.value.byteLength)
      let offset = 0
      while (offset < chunk.length) {
        if (isComplete()) throw invalid()
        const newline = chunk.indexOf(10, offset)
        const end = newline < 0 ? chunk.length : newline + 1
        const needed = pendingBytes + end - offset
        if (needed > MAX_FRAME_BYTES + 1) throw invalid()
        if (needed > pending.length) {
          // Geometric growth copies a long frame O(n), independent of network
          // fragmentation. Never concatenate the growing prefix on each read.
          const grown = Buffer.allocUnsafe(Math.min(MAX_FRAME_BYTES + 1, Math.max(needed, pending.length * 2)))
          pending.copy(grown, 0, 0, pendingBytes); pending = grown
        }
        chunk.copy(pending, pendingBytes, offset, end)
        pendingBytes = needed; offset = end
        if (newline >= 0) { await acceptLine(pending.subarray(0, pendingBytes)); pendingBytes = 0 }
      }
    }
    if (!isComplete() || pendingBytes !== 0) throw invalid()
    signal.throwIfAborted()
    return count
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
