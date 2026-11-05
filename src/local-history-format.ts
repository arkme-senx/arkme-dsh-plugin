import { open, opendir, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { setImmediate as yieldNow } from 'node:timers/promises'
import { isDeepStrictEqual } from 'node:util'
import { createSessionFormatChain, parseSessionFormatLogFilename, type SessionFormatCodec, type SessionFormatArtifact, type SessionFormatEvent, type SessionFormatHeader } from '@deepseek-ai/dsh-session-format'
import { releasedV0SessionFormatCodec, sessionFormatV0ToV1, assertReleasedV1Header } from '@deepseek-ai/dsh-session-format-v0-to-v1'
import { releasedV1SessionFormatCodec, sessionFormatV1ToV2, assertReleasedV2Header } from '@deepseek-ai/dsh-session-format-v1-to-v2'
import { releasedV2SessionFormatCodec, releasedV3SessionFormatCodec, sessionFormatV2ToV3, assertReleasedV3Header } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import { historicalSessionFormatCatalog, createSessionFormatCatalogWithChildren } from '@deepseek-ai/dsh-session-format-catalog'
import { historicalChildCatalogSource } from '@deepseek-ai/dsh-session-format-v3-to-v4'

const MAX_BYTES = 64 * 1024 * 1024
export interface LocalHistoryFormats { originals: SessionFormatArtifact[]; current: SessionFormatArtifact; unavailableOriginals?: boolean }

/** Original physical generations remain read-only; the official catalog owns every transformation. */
export async function readLocalHistoryFormats(root: string, id: string, expected: { header: unknown; events: readonly unknown[] }, children: string[], signal: AbortSignal): Promise<LocalHistoryFormats | undefined> {
  const originals = new Map<number, SessionFormatArtifact>()
  let current: SessionFormatArtifact | undefined
  let failure: unknown
  for (let ceiling = 4; ceiling >= 0;) {
    signal.throwIfAborted()
    let physical: Awaited<ReturnType<typeof readPhysical>>
    try { physical = await readPhysical(root, id, signal, ceiling) }
    catch (error) { signal.throwIfAborted(); failure ??= error; ceiling--; continue }
    if (!physical) break
    ceiling = Number(physical.header.version) - 1
    try {
      const converted = await restorePhysical(root, physical, expected, children, signal)
      current ??= converted.current
      for (const artifact of converted.originals) if (!originals.has(artifact.header.version)) originals.set(artifact.header.version, artifact)
    } catch (error) { signal.throwIfAborted(); failure ??= error }
  }
  if (!current) { if (failure) throw failure; return }
  // A valid newer journal must not depend on decoding an obsolete intermediate generation.
  return { originals: [...originals.values()].sort((a, b) => a.header.version - b.header.version), current, ...(failure ? { unavailableOriginals: true } : {}) }
}

async function restorePhysical(root: string, physical: NonNullable<Awaited<ReturnType<typeof readPhysical>>>, expected: { header: unknown; events: readonly unknown[] }, children: string[], signal: AbortSignal): Promise<LocalHistoryFormats> {
  const facts = []
  for (const child of Number(physical.header.version) < 4 ? children : []) {
    signal.throwIfAborted()
    const source = await readPhysical(root, child, signal)
    if (!source) throw new Error('迁移缺少子会话原始日志')
    const restore = historicalSessionFormatCatalog.createRestore(source.header, { recovery: 'strict', validation: 'current' })
    for (const row of source.rows) restore.decodeRow(structuredClone(row))
    facts.push(historicalChildCatalogSource(restore.finish()))
  }
  const restore = createSessionFormatCatalogWithChildren(facts).createRestore(physical.header, { recovery: 'strict', validation: 'current' })
  for (let i = 0; i < physical.rows.length; i++) {
    restore.decodeRow(structuredClone(physical.rows[i]))
    if (i % 100 === 0) await yieldNow(undefined, { signal })
  }
  const current = restore.finish()
  if (!isDeepStrictEqual(current.header, expected.header) || !isDeepStrictEqual(current.events, expected.events.slice(0, current.events.length))) throw new Error('原始日志与当前官方读取结果不一致，未补传')
  const originals: SessionFormatArtifact[] = []
  const migrations = [sessionFormatV0ToV1, sessionFormatV1ToV2, sessionFormatV2ToV3]
  const codecs: SessionFormatCodec[] = [releasedV0SessionFormatCodec, releasedV1SessionFormatCodec, releasedV2SessionFormatCodec, releasedV3SessionFormatCodec]
  for (let version = Math.max(1, Number(physical.header.version)); version < 4; version++) {
    const decoder = codecs[Number(physical.header.version)]?.createDecoder(physical.header, 'strict')
    if (!decoder) break
    const events: SessionFormatEvent[] = []; let bytes = 0
    const emitEvent = (event: SessionFormatEvent) => {
      bytes += Buffer.byteLength(JSON.stringify(event))
      if (bytes > MAX_BYTES) throw new Error('旧日志大小超过迁移上限')
      events.push(event)
    }
    const chain = createSessionFormatChain({ currentVersion: version, migrations: migrations.slice(0, version), restoreCurrentHeader: (header: SessionFormatHeader) => {
      [assertReleasedV1Header, assertReleasedV2Header, assertReleasedV3Header][version - 1]!(header); return header
    } })
    const stream = chain.createStream(decoder.header, decoder.headerInheritedEventCount, { emitEvent, emitRun: run => { for (const event of run.expand()) emitEvent(event) } })
    for (let i = 0; i < physical.rows.length; i++) {
      decoder.decodeRow(structuredClone(physical.rows[i]), stream)
      if (i % 100 === 0) await yieldNow(undefined, { signal })
    }
    const sourceCut = decoder.finish(stream)
    originals.push({ header: stream.header, inheritedEventCount: version === Number(physical.header.version) ? sourceCut : stream.finish(), events })
  }
  return { originals, current: { ...current, events: expected.events as SessionFormatEvent[] } }
}

async function readPhysical(root: string, id: string, signal: AbortSignal, ceiling = Infinity) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(id) || id === '.' || id === '..') throw new Error('旧日志标识无效')
  let selected: { path: string; version: number } | undefined, directories = 0
  for await (const group of await opendir(root)) {
    signal.throwIfAborted()
    if (++directories > 2048) throw new Error('旧日志分组超过发现上限')
    if (!group.isDirectory() || group.isSymbolicLink()) continue
    const folder = join(root, group.name, id), info = await lstat(folder).catch(error => { if (error.code !== 'ENOENT') throw error })
    if (!info?.isDirectory() || info.isSymbolicLink()) continue
    let files = 0
    for await (const entry of await opendir(folder)) {
      if (++files > 128) throw new Error('旧日志文件数量超过上限')
      const version = parseSessionFormatLogFilename(entry.name.replace(/\.zstd$/u, ''))
      if (version === undefined || version > ceiling || !entry.isFile() || entry.isSymbolicLink()) continue
      if (!selected || version > selected.version) selected = { path: join(folder, entry.name), version }
      else if (version === selected.version) throw new Error('旧日志存在多个物理副本')
    }
  }
  if (!selected) return
  const file = await open(selected.path, constants.O_RDONLY | constants.O_NOFOLLOW)
  let contents: Buffer
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size > MAX_BYTES) throw new Error('旧日志大小超过上限')
    const bytes = await file.readFile({ signal }), after = await file.stat()
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('旧日志正在变化')
    if (selected.path.endsWith('.zstd')) {
      const chunks: Buffer[] = []; let offset = 0, total = 0
      while (offset < bytes.length) {
        signal.throwIfAborted()
        const decoded = zstdDecompressSync(bytes.subarray(offset), { info: true, maxOutputLength: MAX_BYTES - total }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } }
        if (decoded.engine.bytesWritten <= 0) throw new Error('旧日志压缩帧无效')
        chunks.push(decoded.buffer); total += decoded.buffer.length; offset += decoded.engine.bytesWritten
        await yieldNow(undefined, { signal })
      }
      contents = Buffer.concat(chunks)
    } else contents = bytes
  } finally { await file.close() }
  const lines = contents.toString('utf8').trimEnd().split('\n')
  const header = JSON.parse(lines.shift()!)
  if (header.id !== id || header.version !== selected.version) throw new Error('旧日志来源不匹配')
  return { header, rows: lines.map(line => JSON.parse(line)) }
}

/** Validate every retained cloud coordinate before choosing the original namespace. */
export async function cloudHistoryFormat(formats: LocalHistoryFormats, request: import('./dsh-remote/control-plane.js').DshRemoteHttpRequester, runtime: string, session: string, signal: AbortSignal): Promise<SessionFormatArtifact> {
  const { visitCloudTurnHistory } = await import('./dsh-remote/cloud-turn-history.js')
  const { snapshotDshHistoryEntry } = await import('./dsh-remote/dsh-event-contract.js')
  let candidates = [formats.current, ...formats.originals.slice().reverse()], bytes = 0
  const accept = (raw: unknown) => {
    const entry = snapshotDshHistoryEntry(raw as { event: unknown })
    bytes += Buffer.byteLength(JSON.stringify(entry))
    if (bytes > MAX_BYTES) throw new Error('云端旧日志超过迁移校验上限')
    candidates = candidates.filter(candidate => {
      if (isDeepStrictEqual(candidate.events[entry.event.seq], entry.event)) return true
      // The server's published V3/V4 equivalence keeps these coordinates stable.
      return candidate.header.version === 4 && formats.originals.some(original => original.header.version === 3
        && original.events.length <= candidate.events.length && isDeepStrictEqual(original.events[entry.event.seq], entry.event))
    })
    if (!candidates.length) {
      if (formats.unavailableOriginals) throw Object.assign(new Error('旧日志解码失败，无法验证云端格式身份'), { code: 'LOCAL_HISTORY_FORMAT_UNAVAILABLE' })
      throw Object.assign(new Error('本机原始日志与云端内容不同'), { code: 'HISTORY_REPAIR_CONFLICT' })
    }
    return { type: 'event' as const, event: { ...entry.event } }
  }
  let before: number | undefined
  for (;;) {
    const value = await request.post('/api/v1/dsh-remote/session-events/list', { runtime_ref: runtime, session_ref: session, limit: 100, ...(before === undefined ? {} : { before_seq: before }) }, signal)
    if (!Array.isArray(value.entries) || value.entries.length > 100) throw new Error('云端原始历史响应无效')
    const entries = value.entries.map(accept)
    if (value.next_cursor === undefined) break
    const next = entries[0]?.event.seq
    if (next === undefined || before !== undefined && next >= before) throw new Error('云端旧日志分页无效')
    before = next
  }
  await visitCloudTurnHistory(request, { runtime_ref: runtime, session_ref: session }, signal, accept)
  return candidates[0]!
}
