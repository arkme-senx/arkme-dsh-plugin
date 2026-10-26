import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import type { TeamCodexEvent } from './team-codex-contract.js'
import { TeamCodexTurnTimingReader, type CodexTimingSource } from './team-codex-turn-timing.js'
import { codexMarkdownImages } from './team-codex-image-text.js'

const MAX_IMAGE = 20 * 1024 * 1024, MAX_LINE = 32 * 1024 * 1024, CHUNK = 1024 * 1024
type Kind = 'UserPromptSubmit' | 'Stop'
type Span = { turn: string; start: number; end: number }
type Request = { owner: number; source: CodexTimingSource; wanted: Map<string, Set<Kind>>; valid(): boolean }
const keyOf = (owner: number, session: string) => JSON.stringify([owner, session])
const safeId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(id)

/** A local-only owner store. Neither blobs nor refs enter the team sync payload.
 * Reads one explicitly bound rollout; indexes offsets without importing tool logs.
 * All I/O is asynchronous and runs off the message-list response path. */
export class TeamCodexPrivateImages {
  private locator: TeamCodexTurnTimingReader
  private jobs = new Map<string, Request>()
  private work: Promise<void> = Promise.resolve()
  private epoch = 0
  constructor(private db: DatabaseSync, home?: string) {
    this.locator = new TeamCodexTurnTimingReader(home)
    db.exec(`CREATE TABLE IF NOT EXISTS codex_private_images (
      owner INTEGER NOT NULL,session TEXT NOT NULL,turn TEXT NOT NULL,kind TEXT NOT NULL,ordinal INTEGER NOT NULL,
      ref TEXT NOT NULL UNIQUE,source_hash TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,
      image BLOB,thumbnail BLOB,PRIMARY KEY(owner,session,turn,kind,ordinal));
      CREATE TABLE IF NOT EXISTS codex_image_cursors (scope TEXT PRIMARY KEY,identity TEXT NOT NULL,offset INTEGER NOT NULL,turn TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS codex_image_spans (scope TEXT NOT NULL,turn TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,PRIMARY KEY(scope,turn));
      CREATE TABLE IF NOT EXISTS codex_image_reads (scope TEXT NOT NULL,turn TEXT NOT NULL,kind TEXT NOT NULL,end INTEGER NOT NULL,PRIMARY KEY(scope,turn,kind));`)
  }
  fence(): void { this.epoch++; this.jobs.clear() }
  async idle(): Promise<void> { await this.work }
  schedule(owner: number, source: CodexTimingSource, events: readonly TeamCodexEvent[], valid: () => boolean): void {
    if (!safeId(source.sessionId) || !valid()) return
    const key = keyOf(owner, source.sessionId), existing = this.jobs.get(key)
    const wanted = existing?.wanted ?? new Map<string, Set<Kind>>()
    for (const event of events) {
      const turn = source.turns ? source.turns.get(event.turnId) : event.turnId
      if (!turn || !safeId(turn) || event.kind === 'Interrupt') continue
      const kinds = wanted.get(turn) ?? new Set<Kind>(); kinds.add(event.kind); wanted.set(turn, kinds)
    }
    if (existing || !wanted.size) return
    const request = { owner, source, wanted, valid }, epoch = this.epoch
    this.jobs.set(key, request)
    this.work = this.work.then(async () => {
      if (epoch !== this.epoch || !valid()) return
      try { await this.scan(key, request, () => epoch === this.epoch && valid()) }
      catch { /* Missing/unsupported source is retried on the next page poll. Never log image data. */ }
    }).finally(() => { if (this.jobs.get(key) === request) this.jobs.delete(key) })
  }
  project(owner: number, source: CodexTimingSource, events: TeamCodexEvent[]): TeamCodexEvent[] {
    const get = this.db.prepare('SELECT ref,width,height,image IS NOT NULL AS ready FROM codex_private_images WHERE owner=? AND session=? AND turn=? AND kind=? ORDER BY ordinal')
    return events.map(event => {
      const turn = source.turns ? source.turns.get(event.turnId) : event.turnId
      const rows = turn ? get.all(owner, source.sessionId, turn, event.kind) : []
      return rows.length ? { ...event, privateImages: rows.map(r => ({ ref: String(r.ref), width: Number(r.width), height: Number(r.height), state: r.ready ? 'ready' as const : 'unavailable' as const })) } : event
    })
  }
  read(owner: number, source: CodexTimingSource, turnId: string, kind: string, ref: string, full: boolean): { dataUrl: string } | undefined {
    if (!/^[a-f0-9-]{36}$/.test(ref)) return
    const turn = source.turns ? source.turns.get(turnId) : turnId
    if (!turn) return
    const row = this.db.prepare(`SELECT ${full ? 'image' : 'thumbnail'} AS bytes FROM codex_private_images WHERE owner=? AND session=? AND turn=? AND kind=? AND ref=?`).get(owner, source.sessionId, turn, kind, ref)
    return row?.bytes instanceof Uint8Array ? { dataUrl: `data:image/${full ? 'png' : 'webp'};base64,${Buffer.from(row.bytes).toString('base64')}` } : undefined
  }
  private async scan(scope: string, request: Request, valid: () => boolean): Promise<void> {
    const path = this.locator.location(request.source)
    if (!path || !valid()) return
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const stat = await file.stat(); if (!stat.isFile()) return
      const first = Buffer.alloc(Math.min(stat.size, 65536)); await file.read(first, 0, first.length, 0)
      const newline = first.indexOf(10); if (newline < 0) return
      const meta = JSON.parse(first.subarray(0, newline).toString('utf8'))
      if (meta.type !== 'session_meta' || meta.payload?.id !== request.source.sessionId) return
      const identity = `${stat.dev}:${stat.ino}`, saved = this.db.prepare('SELECT * FROM codex_image_cursors WHERE scope=?').get(scope)
      let offset = Number(saved?.offset ?? 0), current = String(saved?.turn ?? '')
      if (saved?.identity !== identity || offset > stat.size) {
        offset = 0; current = ''
        this.db.prepare('DELETE FROM codex_image_spans WHERE scope=?').run(scope)
        this.db.prepare('DELETE FROM codex_image_reads WHERE scope=?').run(scope)
      }
      const spanPut = this.db.prepare('INSERT INTO codex_image_spans VALUES(?,?,?,?) ON CONFLICT(scope,turn) DO UPDATE SET end=excluded.end')
      let spanStart = offset
      const finishSpan = (end: number) => { if (current) spanPut.run(scope, current, spanStart, end) }
      // Index only small lifecycle records. Huge tool output is skipped without JSON parsing.
      const end = await lines(file, offset, stat.size, valid, async (bytes, start, end) => {
        if (bytes.length < 256 * 1024 && /"type"\s*:\s*"(?:turn_context|event_msg)"/.test(bytes.subarray(0, 200).toString())) {
          try {
            const row = JSON.parse(bytes.toString()), p = row.payload
            if (row.type === 'turn_context' || row.type === 'event_msg' && p?.type === 'task_started') {
              const next = safeId(p?.turn_id) && (p.root_turn_id ?? p.turn_id) === p.turn_id ? p.turn_id : ''
              if (next !== current) { finishSpan(start); current = next; spanStart = start }
            }
          } catch { /* malformed metadata */ }
        }
        offset = end
      })
      if (!valid()) return
      finishSpan(end)
      this.db.prepare('INSERT INTO codex_image_cursors VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET identity=excluded.identity,offset=excluded.offset,turn=excluded.turn').run(scope, identity, end, current)
      for (const [turn, kinds] of request.wanted) {
        if (!valid()) return
        const span = this.db.prepare('SELECT * FROM codex_image_spans WHERE scope=? AND turn=?').get(scope, turn) as Span | undefined
        if (!span) continue
        for (const kind of kinds) {
          const done = this.db.prepare('SELECT end FROM codex_image_reads WHERE scope=? AND turn=? AND kind=?').get(scope, turn, kind)
          if (done && Number(done.end) === span.end) continue
          const urls: string[] = [], generated: string[] = [], generatedCalls = new Set<string>(); let active = turn, found = false
          await lines(file, span.start, span.end, valid, async bytes => {
            if (!valid()) return
            const prefix = bytes.subarray(0, 250).toString()
            if (!/"type"\s*:\s*"(?:turn_context|event_msg|response_item)"/.test(prefix)) return
            if (/"type"\s*:\s*"reasoning"/.test(prefix)) return
            try {
              const row = JSON.parse(bytes.toString()), p = row.payload
              if (row.type === 'turn_context' || row.type === 'event_msg' && p?.type === 'task_started') {
                active = (p.root_turn_id ?? p.turn_id) === p.turn_id ? p.turn_id : ''; return
              }
              if (active !== turn || row.type !== 'response_item') return
              if (kind === 'Stop' && ['custom_tool_call','function_call'].includes(p?.type)) {
                if (typeof p.call_id==='string' && (/imagegen|image_gen/.test(p.name??'') || /\bgeneratedImage\s*\(/.test(p.input??p.arguments??''))) generatedCalls.add(p.call_id)
                return
              }
              if (kind === 'Stop' && ['custom_tool_call_output','function_call_output'].includes(p?.type) && generatedCalls.has(p.call_id)) {
                // Only explicitly rendered image-generation output, never arbitrary tool screenshots.
                for (const part of Array.isArray(p.output)?p.output:[]) {
                  const url=part.image_url?.url??part.image_url
                  if (['input_image','output_image','image'].includes(part.type)&&typeof url==='string') {generated.push(url);found=true}
                }
                return
              }
              if (p?.type !== 'message') return
              if (kind === 'UserPromptSubmit' ? p.role !== 'user' : p.role !== 'assistant' || !['final_answer', 'final'].includes(p.phase)) return
              if (!Array.isArray(p.content)) return
              if (kind === 'Stop') urls.length = 0 // Last final answer replaces a superseded answer.
              found = true
              for (const part of p.content) {
                if (['input_image', 'output_image', 'image'].includes(part?.type)) {
                  const url = part.image_url?.url ?? part.image_url ?? part.url
                  if (typeof url === 'string') urls.push(url)
                } else if (part?.type === 'local_image' && typeof part.path === 'string') urls.push(part.path)
                else if (kind === 'Stop' && typeof part?.text === 'string') urls.push(...codexMarkdownImages(part.text).map(i => i.url))
              }
            } catch { /* do not infer attachments from malformed or tool records */ }
          })
          if (!valid() || !found) continue
          urls.unshift(...generated.filter(url=>!urls.includes(url)))
          for (let ordinal = 0; ordinal < Math.min(urls.length, 32); ordinal++) {
            if (!valid()) return
            await this.save(request.owner, request.source.sessionId, turn, kind, ordinal, urls[ordinal]!, valid)
          }
          if (!valid()) return
          this.db.prepare('DELETE FROM codex_private_images WHERE owner=? AND session=? AND turn=? AND kind=? AND ordinal>=?').run(request.owner, request.source.sessionId, turn, kind, Math.min(urls.length,32))
          this.db.prepare('INSERT INTO codex_image_reads VALUES(?,?,?,?) ON CONFLICT(scope,turn,kind) DO UPDATE SET end=excluded.end').run(scope, turn, kind, span.end)
        }
      }
    } finally { await file.close() }
  }
  private async save(owner: number, session: string, turn: string, kind: Kind, ordinal: number, url: string, valid: () => boolean): Promise<void> {
    const hash = createHash('sha256').update(url).digest('hex')
    const old = this.db.prepare('SELECT ref,source_hash,image IS NOT NULL AS ready FROM codex_private_images WHERE owner=? AND session=? AND turn=? AND kind=? AND ordinal=?').get(owner, session, turn, kind, ordinal)
    if (old?.source_hash === hash && old.ready) return
    let image: Buffer | null = null, thumbnail: Buffer | null = null, width = 160, height = 120
    try {
      let bytes: Buffer
      const data = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(url)
      if (data && data[1]!.length <= MAX_IMAGE * 1.4) bytes = Buffer.from(data[1]!, 'base64')
      else {
        // Never fetch remote URLs or interpret paths found in a user's prose.
        if (!isAbsolute(url) || !/\.(png|jpe?g|webp|gif)$/i.test(url)) throw Error('Unsupported image source')
        const file = await open(url, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
        try {
          const stat = await file.stat()
          if (!stat.isFile() || stat.size > MAX_IMAGE) throw Error('Invalid image')
          // Bound the read even if another process grows the source after stat().
          bytes = Buffer.alloc(stat.size)
          let offset = 0
          while (offset < bytes.length) {
            const read = await file.read(bytes, offset, bytes.length - offset, offset)
            if (!read.bytesRead) throw Error('Incomplete image')
            offset += read.bytesRead
          }
        } finally { await file.close() }
      }
      if (bytes.length > MAX_IMAGE || !valid()) return
      const full = await sharp(bytes, { limitInputPixels: 40_000_000, animated: false }).rotate().png().toBuffer({ resolveWithObject: true })
      if (full.data.length > MAX_IMAGE) throw Error('Image too large')
      image = full.data; width = full.info.width; height = full.info.height
      thumbnail = await sharp(image).resize({ width: 480, height: 360, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
    } catch { /* Keep an honest unavailable slot, without leaking the original path. */ }
    if (!valid()) return
    this.db.prepare(`INSERT INTO codex_private_images VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,session,turn,kind,ordinal)
      DO UPDATE SET source_hash=excluded.source_hash,width=excluded.width,height=excluded.height,image=excluded.image,thumbnail=excluded.thumbnail`)
      .run(owner, session, turn, kind, ordinal, old?.ref ?? randomUUID(), hash, width, height, image, thumbnail)
  }
}

/** Bounded streaming lines, with a yield between chunks. Incomplete final records retry later. */
async function lines(file: Awaited<ReturnType<typeof open>>, start: number, end: number, valid: () => boolean,
  visit: (line: Buffer, start: number, end: number) => Promise<void>): Promise<number> {
  let offset = start, lineStart = start, carry: Buffer[] = [], length = 0, oversized = false, complete = start
  while (offset < end && valid()) {
    const buffer = Buffer.alloc(Math.min(CHUNK, end - offset)), read = await file.read(buffer, 0, buffer.length, offset)
    if (!read.bytesRead) break
    let pos = 0, next: number
    while ((next = buffer.indexOf(10, pos)) >= 0 && next < read.bytesRead) {
      const part = buffer.subarray(pos, next); length += part.length
      if (!oversized && length <= MAX_LINE) await visit(carry.length ? Buffer.concat([...carry,part],length) : part, lineStart, offset + next + 1)
      complete = offset + next + 1; lineStart = complete; carry = []; length = 0; oversized = false; pos = next + 1
      if (!valid()) return complete
    }
    if (pos < read.bytesRead) {
      const part = buffer.subarray(pos,read.bytesRead); length += part.length
      if (length > MAX_LINE) { oversized = true; carry = [] } else if (!oversized) carry.push(Buffer.from(part))
    }
    offset += read.bytesRead
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  return complete
}
