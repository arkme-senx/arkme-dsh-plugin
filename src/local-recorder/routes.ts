import { createReadStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import { ArkmePluginError } from '../services/service.js'
import type { LocalRecorderOwner } from './owner.js'

export async function callLocalRecorder(owner: LocalRecorderOwner, operation: string, params: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const id = typeof params.deviceId === 'string' ? params.deviceId : ''
  const recording = typeof params.recordingId === 'string' ? params.recordingId : ''
  try {
    switch (operation) {
      case 'recorders.local.snapshot': return await owner.snapshot()
      case 'recorders.local.discover': return await owner.discover(signal)
      case 'recorders.local.sync': return await owner.sync(id)
      case 'recorders.local.stop': return await owner.stop(id)
      case 'recorders.local.recordings': return await owner.recordings(id, Number(params.offset), Number(params.revision))
      case 'recorders.local.prepare': return await owner.prepare(id, recording)
      case 'recorders.local.import': return await owner.importAudio(id, recording, Number(params.startAtMillis), String(params.ownership))
      default: throw new ArkmePluginError('invalid-operation', '未知本地设备操作', false, 400)
    }
  } catch (error) {
    if (error instanceof ArkmePluginError) throw error
    throw new ArkmePluginError('local-recorder-failed', '设备操作未完成，请检查连接或重新同步', true, 409, { cause: error })
  }
}

/** Opaque account-owned media refs, local same-origin reads and bounded Range streaming. */
export function createLocalRecorderMediaHandler(owner: LocalRecorderOwner, port: number) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
        || ![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host ?? '')) throw new Error('local origin required')
      const source = req.headers.origin ?? req.headers.referer
      if (!source || new URL(source).host !== req.headers.host || !['http:', 'https:'].includes(new URL(source).protocol)) throw new Error('same origin required')
      if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') throw new Error('same origin required')
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
      const media = await owner.resolveAudio(url.searchParams.get('ref') ?? '')
      let start = 0, end = media.size - 1, partial = false
      if (req.headers.range) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
        if (!range || !range[1] && !range[2]) { res.writeHead(416, { 'Content-Range': `bytes */${media.size}` }); res.end(); return }
        if (!range[1]) start = Math.max(0, media.size - Number(range[2]))
        else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])) }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= media.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${media.size}` }); res.end(); return
        }
        partial = true
      }
      res.writeHead(partial ? 206 : 200, { 'Content-Type': 'audio/wav', 'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
        ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${media.size}` } : {}),
        ...(url.searchParams.get('download') === '1' ? { 'Content-Disposition': `attachment; filename="${media.fileName}"` } : {}) })
      if (req.method === 'HEAD') { res.end(); return }
      await pipeline(createReadStream(media.path, { start, end }), res, { signal: media.signal })
    } catch (error) {
      if (res.headersSent) { res.destroy(); return }
      res.writeHead(error instanceof ArkmePluginError ? error.httpStatus : 403, { 'Cache-Control': 'no-store' }); res.end()
    }
  }
}
