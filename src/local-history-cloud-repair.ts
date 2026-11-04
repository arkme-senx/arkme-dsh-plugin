import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setImmediate as yieldNow } from 'node:timers/promises'
import { cloudHistoryFormat, type LocalHistoryFormats } from './local-history-format.js'
import type { SessionFormatArtifact } from '@deepseek-ai/dsh-session-format'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { snapshotDshHistoryEntry } from './dsh-remote/dsh-event-contract.js'
import { nativeAnnotationProjection } from './dsh-remote/annotation-projection.js'
import { securePrivateDirectory, securePrivateFile } from './private-filesystem.js'

export type HistorySyncState = 'pending' | 'syncing' | 'complete' | 'conflict' | 'unsupported' | 'failed'
export interface HistorySyncEvent { runtimeRef: string; sessionRef: string; status: HistorySyncStatus; revision: number }
export interface HistorySyncStatus { state: HistorySyncState; nextSeq: number; throughSeq: number }
type Job = HistorySyncStatus & { runtime: string; session: string; digest?: string; retryAt: number; attempts: number; comparisonVersion?: number; sourceVersion?: number; sourceThrough?: number; sourceNext?: number; completedRevision?: string }
type Json = Record<string, unknown>
const BASE = '/api/v1/dsh-remote/session-history'
const ref = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(value)

/** Read-only repair owner. The journal remains the only payload store. */
export class LocalHistoryCloudRepair {
  private readonly jobs = new Map<string, Job>()
  private readonly coordinates = new Map<string, { revision: string; formatVersion?: 4; sourceSeq?: number }>()
  private readonly revisions = new Map<string, string>()
  private readonly ready: Promise<void>
  private flight: Promise<void> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private capabilityExpiresAt = 0
  private supported?: boolean
  private comparisonVersion = 1
  private nativeFormat = false
  private sourceEntryLimit = 50_000
  private readonly checkedConflicts = new Set<Job>()
  private readonly controller = new AbortController()
  private saving = Promise.resolve()
  constructor(private readonly options: {
    root: string; scope: string; persistence: SessionPersistence
    formats?(session: string, expected: { header: unknown; events: readonly unknown[] }, signal: AbortSignal): Promise<LocalHistoryFormats | undefined>
    discover(runtime: string, session: string, signal: AbortSignal): Promise<boolean>
    authorize(): Promise<void>
    host(): { ref: string; generation: number } | undefined
    post(path: string, body: Json, signal: AbortSignal): Promise<Json>
    report(error: unknown): void
    changed?(runtime: string, session: string, status: HistorySyncStatus): void
  }) {
    this.ready = this.restore()
    void this.ready.then(() => this.schedule()).catch(options.report)
  }
  status(runtime: string, session: string): HistorySyncStatus | undefined {
    const job = this.jobs.get(JSON.stringify([runtime, session]))
    return job && { state: job.state, nextSeq: job.nextSeq, throughSeq: job.throughSeq }
  }
  async enqueue(runtime: string, session: string): Promise<void> {
    await this.ready
    this.controller.signal.throwIfAborted()
    if (!ref(runtime) || !ref(session)) throw new Error('历史补传来源无效')
    const key = JSON.stringify([runtime, session])
    if (!this.jobs.has(key)) {
      if (this.jobs.size >= 256) {
        const completed = [...this.jobs].find(([, job]) => job.state === 'complete')?.[0]
        if (completed) { this.jobs.delete(completed); this.revisions.delete(completed) }
      }
      if (this.jobs.size >= 256) throw new Error('历史补传队列已满')
      this.jobs.set(key, { runtime, session, state: 'pending', nextSeq: 0, throughSeq: -1, retryAt: 0, attempts: 0 })
      await this.save()
    } else if (this.jobs.get(key)!.state === 'complete') {
      const snapshot = await this.options.persistence.stat(SessionId(session))
      if (snapshot && snapshot.revision !== (this.revisions.get(key) ?? this.jobs.get(key)!.completedRevision)) {
        this.jobs.get(key)!.state = 'pending'
        this.jobs.get(key)!.retryAt = 0
        await this.save()
      }
    }
    this.schedule()
  }
  get stopped(): boolean { return this.controller.signal.aborted }
  cancel(): void {
    this.controller.abort()
    clearTimeout(this.timer)
  }
  async close(): Promise<void> {
    this.cancel()
    await this.ready.catch(() => undefined)
    await this.flight
    await this.saving.catch(() => undefined)
  }
  private async restore() {
    const path = join(this.options.root, 'queue.json')
    const metadata = await stat(path).catch(error => { if (error.code !== 'ENOENT') throw error })
    if (!metadata) return
    if (metadata.size > 256 * 1024) throw new Error('历史补传队列损坏')
    const value = JSON.parse(await readFile(path, 'utf8')) as { scope?: string; jobs?: Job[] }
    if (value.scope !== this.options.scope || !Array.isArray(value.jobs) || value.jobs.length > 256) throw new Error('历史补传队列账号不匹配')
    for (const job of value.jobs) {
      if (!ref(job.runtime) || !ref(job.session) || !['pending', 'syncing', 'complete', 'conflict', 'unsupported', 'failed'].includes(job.state)
        || !Number.isSafeInteger(job.nextSeq) || job.nextSeq < 0 || !Number.isSafeInteger(job.throughSeq) || job.throughSeq < -1 || job.nextSeq > job.throughSeq + 1
        || job.comparisonVersion !== undefined && (!Number.isSafeInteger(job.comparisonVersion) || job.comparisonVersion < 1)
        || job.sourceVersion !== undefined && ![1, 2, 3, 4].includes(job.sourceVersion)
        || job.sourceThrough !== undefined && (!Number.isSafeInteger(job.sourceThrough) || job.sourceThrough < -1 || job.sourceThrough >= Number.MAX_SAFE_INTEGER)
        || job.sourceNext !== undefined && (!Number.isSafeInteger(job.sourceNext) || job.sourceNext < 0 || job.sourceNext > (job.sourceThrough ?? -1) + 1)
        || !Number.isFinite(job.retryAt) || !Number.isSafeInteger(job.attempts) || job.attempts < 0 || job.digest !== undefined && !/^[a-f0-9]{64}$/u.test(job.digest)) throw new Error('历史补传进度无效')
      if (job.completedRevision !== undefined && (typeof job.completedRevision !== 'string' || job.completedRevision.length > 1024)) throw new Error('历史版本回执无效')
      if (job.state === 'syncing' || job.state === 'unsupported' || job.state === 'failed') job.state = 'pending'
      this.jobs.set(JSON.stringify([job.runtime, job.session]), job)
      this.options.changed?.(job.runtime, job.session, this.status(job.runtime, job.session)!)
    }
  }
  private save(): Promise<void> {
    const jobs = [...this.jobs.values()].map(job => ({ ...job }))
    const contents = JSON.stringify({ scope: this.options.scope, jobs })
    const write = async () => {
      await mkdir(this.options.root, { recursive: true, mode: 0o700 })
      await securePrivateDirectory(this.options.root)
      const temp = join(this.options.root, `${randomUUID()}.tmp`)
      await writeFile(temp, contents, { mode: 0o600, flag: 'wx' })
      await securePrivateFile(temp)
      await rename(temp, join(this.options.root, 'queue.json'))
      for (const job of jobs) this.options.changed?.(job.runtime, job.session, { state: job.state, nextSeq: job.nextSeq, throughSeq: job.throughSeq })
    }
    return this.saving = this.saving.then(write, write)
  }
  private schedule() {
    if (this.controller.signal.aborted || this.flight || this.timer) return
    const pending = [...this.jobs.values()].filter(job => job.state === 'pending' || job.state === 'unsupported' || job.state === 'conflict')
    if (!pending.length) return
    const wait = Math.min(300_000, Math.max(0, Math.min(...pending.map(job => this.dueAt(job))) - Date.now()))
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flight = this.run().catch(this.options.report).finally(() => { this.flight = undefined; this.schedule() })
    }, wait)
    this.timer.unref?.()
  }
  private dueAt(job: Job): number {
    return job.state === 'conflict' && this.checkedConflicts.has(job) ? Math.max(job.retryAt, this.capabilityExpiresAt) : job.retryAt
  }
  async annotationCoordinates(runtime: string, session: string, eventSeq: number, signal: AbortSignal): Promise<{ formatVersion?: 4; sourceSeq?: number }> {
    await this.enqueue(runtime, session); await this.options.authorize()
    if (!this.options.formats || this.jobs.get(JSON.stringify([runtime, session]))?.sourceVersion === 4) return {}
    const id = SessionId(session), snapshot = await this.options.persistence.stat(id, { signal })
    if (!snapshot) throw new Error('原日志不可用')
    const key = JSON.stringify([runtime, session, eventSeq]), cached = this.coordinates.get(key)
    if (cached?.revision === snapshot.revision) return cached
    const handle = await this.options.persistence.open(id, 'read', { signal })
    try {
      const events: Awaited<ReturnType<Awaited<ReturnType<SessionPersistence['open']>>['read']>>['events'][number][] = []; let bytes = 0
      for (let offset = 0;;) {
        const page = await handle.read(offset, 100, { signal })
        for (const event of page.events) {
          if (event.seq !== offset++) throw new Error('历史序号不连续')
          bytes += Buffer.byteLength(JSON.stringify(event))
          if (bytes > 64 * 1024 * 1024) throw Object.assign(new Error('旧日志超过迁移上限'), { code: 'LOCAL_HISTORY_TOO_LARGE' })
          events.push(event)
        }
        if (page.events.length < 100) break
        await yieldNow(undefined, { signal })
      }
      const formats = await this.options.formats(session, { header: snapshot.header, events }, signal)
      const job = this.jobs.get(JSON.stringify([runtime, session]))!
      const original = formats ? await this.originalFormat(job, formats, signal) : undefined
      const messageId = (event: { data: unknown } | undefined) => { const data = event?.data as Json | undefined; return (data?.message as Json | undefined)?.id ?? data?.id }
      const matches = original && original.header.version < 4 ? original.events.filter(event => messageId(event) && messageId(event) === messageId(events[eventSeq])) : []
      if (matches.length > 1) throw new Error('旧日志消息身份重复')
      const source = matches[0], current = events[eventSeq]
      if (source && (!current || source.type !== current.type || source.time !== current.time
        || nativeAnnotationProjection(snapshotDshHistoryEntry({ event: source }))?.canonical !== nativeAnnotationProjection(snapshotDshHistoryEntry({ event: current }))?.canonical)) throw new Error('迁移后消息内容不一致')
      const result = { revision: snapshot.revision, ...(original && original.header.version < 4 ? { formatVersion: 4 as const, ...(source ? { sourceSeq: source.seq } : {}) } : {}) }
      if (this.coordinates.size >= 500) this.coordinates.delete(this.coordinates.keys().next().value!)
      this.coordinates.set(key, result)
      return result
    } finally { await handle.close() }
  }

  private async originalFormat(job: Job, formats: LocalHistoryFormats, signal: AbortSignal): Promise<SessionFormatArtifact> {
    const original = job.sourceVersion === undefined ? await cloudHistoryFormat(formats, { post: this.options.post }, job.runtime, job.session, signal)
      : [formats.current, ...formats.originals].find(value => value.header.version === job.sourceVersion)
    if (!original) throw new Error('旧日志格式来源不可用')
    if (job.sourceVersion === undefined) {
      job.sourceVersion = original.header.version
      if (job.sourceVersion < 4) { job.sourceThrough = original.events.length - 1; job.sourceNext = 0; job.nextSeq = 0 }
      await this.save()
    }
    return original
  }

  formatVersion(runtime: string, session: string): number | undefined {
    const version = this.jobs.get(JSON.stringify([runtime, session]))?.sourceVersion
    return version !== undefined && version < 4 ? 4 : undefined
  }

  private async postBatch(path: string, body: Json & { entries: unknown[] }, signal: AbortSignal): Promise<{ result: Json; count: number }> {
    let entries = body.entries
    for (;;) {
      signal.throwIfAborted()
      const end = Number(body.from_seq) + entries.length
      const batch = { ...body, entries, ...Object.fromEntries(['annotations', 'mappings'].filter(key => Array.isArray(body[key]))
        .map(key => [key, (body[key] as Json[]).filter(row => Number(row.event_seq) < end)])) }
      try { return { result: await this.options.post(path, batch, signal), count: entries.length } }
      catch (error) {
        const value = error as { httpStatus?: number; upstreamStatus?: number }
        if ((value.upstreamStatus ?? value.httpStatus) !== 413) throw error
        if (entries.length <= 1) throw Object.assign(new Error('单条历史超过传输上限'), { code: 'LOCAL_HISTORY_TOO_LARGE', cause: error })
        // A rejected request has no receipt; retry only its smaller prefix.
        entries = entries.slice(0, Math.ceil(entries.length / 2))
      }
    }
  }

  private async repairFormat(job: Job, snapshot: Awaited<ReturnType<SessionPersistence['stat']>> & {}, handle: Awaited<ReturnType<SessionPersistence['open']>>, host: { ref: string; generation: number }, signal: AbortSignal): Promise<boolean> {
    if (job.sourceVersion === 4) return false
    const events: Awaited<ReturnType<Awaited<ReturnType<SessionPersistence['open']>>['read']>>['events'][number][] = []; let bytes = 0
    for (let offset = 0;;) {
      const page = await handle.read(offset, 100, { signal })
      for (const event of page.events) {
        if (event.seq !== offset++) throw new Error('历史序号不连续')
        bytes += Buffer.byteLength(JSON.stringify(event))
        if (bytes > 64 * 1024 * 1024) throw Object.assign(new Error('历史超过格式迁移上限'), { code: 'LOCAL_HISTORY_TOO_LARGE' })
        events.push(event)
      }
      if (page.events.length < 100) break
      await yieldNow(undefined, { signal })
    }
    const formats = await this.options.formats!(job.session, { header: snapshot.header, events }, signal)
    if (!formats) { job.sourceVersion = 4; await this.save(); return false }
    const original = await this.originalFormat(job, formats, signal)
    if (original.header.version === 4) return false
    if (!this.nativeFormat || original.events.length > this.sourceEntryLimit) { await this.waitForCapability(job); return true }
    if (job.sourceThrough !== original.events.length - 1) throw Object.assign(new Error('旧日志原始版本已变化'), { code: 'HISTORY_REPAIR_CONFLICT' })
    const digest = createHash('sha256').update(JSON.stringify(events)).digest('hex')
    if (digest !== job.digest) {
      const prefix = createHash('sha256').update(JSON.stringify(events.slice(0, job.throughSeq + 1))).digest('hex')
      if (prefix !== job.digest) job.nextSeq = 0
      job.digest = digest
    }
    job.throughSeq = events.length - 1
    const identity = { importer_runtime_ref: host.ref, importer_host_generation: host.generation, runtime_ref: job.runtime, session_ref: job.session }
    const sourceMessages = new Map<string, { seq: number; canonical: string; type: string; time: number }>()
    for (const event of original.events) {
      const projection = nativeAnnotationProjection(snapshotDshHistoryEntry({ event })), data = event.data as Json
      const id = String((data.message as Json | undefined)?.id ?? data.id ?? '')
      if (projection && id) {
        if (sourceMessages.has(id)) throw new Error('旧日志消息身份重复')
        sourceMessages.set(id, { seq: event.seq, canonical: projection.canonical, type: event.type, time: event.time })
      }
    }
    const upload = async (artifact: SessionFormatArtifact, native: boolean) => {
      let offset = native ? job.nextSeq : job.sourceNext ?? 0
      if (offset > artifact.events.length) throw new Error('格式补传进度无效')
      while (offset < artifact.events.length || artifact.events.length === 0 && offset === 0) {
        const entries = [], annotations = [], mappings = []; let size = 0
        for (const event of artifact.events.slice(offset, offset + 100)) {
          const entry = snapshotDshHistoryEntry({ event }), projection = nativeAnnotationProjection(entry)
          const annotation = projection && { event_seq: event.seq, canonical_text: projection.canonical }
          const data = event.data as Json, id = String((data.message as Json | undefined)?.id ?? data.id ?? '')
          const source = sourceMessages.get(id)
          if (source && projection && (source.canonical !== projection.canonical || source.type !== event.type || source.time !== event.time)) throw new Error('迁移后消息内容不一致')
          const mapping = annotation && { ...annotation, ...(source ? { source_seq: source.seq } : {}) }
          const n = Buffer.byteLength(JSON.stringify(entry))
          if (n > 512 * 1024) throw Object.assign(new Error('单条历史超过云端上限'), { code: 'LOCAL_HISTORY_TOO_LARGE' })
          const encoded = n + (annotation ? Buffer.byteLength(JSON.stringify(mapping)) : 0)
          if (size + encoded > 4 * 1024 * 1024) break
          entries.push(entry); if (annotation) annotations.push(annotation); if (mapping) mappings.push(mapping); size += encoded
        }
        if (!entries.length && artifact.events.length) throw new Error('格式补传批次为空')
        if ((await this.options.persistence.stat(SessionId(job.session), { signal }))?.revision !== snapshot.revision) throw new Error('历史仍在变化，稍后重试')
        await this.options.authorize()
        const { result, count } = await this.postBatch(`${BASE}/${native ? 'format-repair' : 'repair'}`, { ...identity, from_seq: offset, through_seq: artifact.events.length - 1, entries,
          ...(native ? { format_version: 4, source_format_version: original.header.version, source_through_seq: job.sourceThrough, header: artifact.header, mappings } : { annotations }) }, signal)
        signal.throwIfAborted(); await this.options.authorize()
        if (result.next_seq !== offset + count || result.complete !== (result.next_seq === artifact.events.length)) throw new Error('云端历史确认无效')
        offset = Number(result.next_seq)
        if (native) job.nextSeq = offset; else job.sourceNext = offset
        job.attempts = 0
        await this.save(); if (result.complete) break
        await yieldNow(undefined, { signal })
      }
    }
    job.state = 'syncing'; await this.save()
    await upload(original, false); await upload(formats.current, true)
    job.state = 'complete'; job.attempts = 0; job.completedRevision = snapshot.revision
    this.revisions.set(JSON.stringify([job.runtime, job.session]), snapshot.revision)
    await this.save(); return true
  }
  private async waitForCapability(job: Job) {
    job.state = 'unsupported'; job.retryAt = this.capabilityExpiresAt
    await this.save()
  }
  private async run() {
    const job = [...this.jobs.values()].find(value => ['pending', 'unsupported', 'conflict'].includes(value.state) && this.dueAt(value) <= Date.now())
    if (!job) return
    const checkingConflict = job.state === 'conflict'
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(120_000)])
    try {
      await this.options.authorize()
      const host = this.options.host()
      if (!host) throw new Error('当前实例尚未注册')
      if (this.supported === undefined || Date.now() >= this.capabilityExpiresAt) {
        const cap = await this.options.post(`${BASE}/repair-capabilities`, {}, signal)
        this.capabilityExpiresAt = Date.now() + 300_000
        this.supported = cap.enabled === true && cap.version === 1
        this.nativeFormat = cap.native_format_version === 4
        this.sourceEntryLimit = Number.isSafeInteger(cap.max_source_entries) && Number(cap.max_source_entries) > 0 ? Number(cap.max_source_entries) : 50_000
        this.comparisonVersion = Number.isSafeInteger(cap.comparison_version) && Number(cap.comparison_version) > 0 ? Number(cap.comparison_version) : 1
      }
      if (!this.supported || job.state === 'unsupported' && job.sourceVersion !== undefined && job.sourceVersion < 4
        && (!this.nativeFormat || (job.sourceThrough ?? -1) >= this.sourceEntryLimit)) {
        if (!checkingConflict) await this.waitForCapability(job)
        else this.checkedConflicts.add(job)
        return
      }
      if (job.state === 'unsupported') job.state = 'pending'
      for (const waiting of this.jobs.values()) {
        if (waiting.state === 'conflict' && (waiting.comparisonVersion ?? 1) < this.comparisonVersion) { waiting.state = 'pending'; waiting.retryAt = 0 }
      }
      // Probe capability changes, never replay a known conflict under the same comparison rules.
      if (job.state === 'conflict' && this.checkedConflicts.has(job)) return
      if (job.state === 'conflict' && !this.options.formats) { this.checkedConflicts.add(job); return }
      job.comparisonVersion = this.comparisonVersion
      if (!await this.options.discover(job.runtime, job.session, signal)) throw Object.assign(new Error('原日志不可用'), { code: 'LOCAL_SOURCE_MISSING' })
      const id = SessionId(job.session), persistence = this.options.persistence
      const snapshot = await persistence.stat(id, { signal })
      if (!snapshot) throw Object.assign(new Error('原日志不可用'), { code: 'LOCAL_SOURCE_MISSING' })
      const handle = await persistence.open(id, 'read', { signal })
      try {
        const key = JSON.stringify([job.runtime, job.session])
        if (this.options.formats && await this.repairFormat(job, snapshot, handle, host, signal)) return
        if (job.state === 'conflict') { this.checkedConflicts.add(job); return }
        if (this.revisions.get(key) !== snapshot.revision) {
          const digest = createHash('sha256'); let count = 0
          while (true) {
            const { events } = await handle.read(count, 100, { signal })
            for (const event of events) { if (event.seq !== count++) throw new Error('历史序号不连续'); digest.update(JSON.stringify(snapshotDshHistoryEntry({ event }))).update('\n') }
            if (events.length < 100) break
            await yieldNow(undefined, { signal })
          }
          if ((await persistence.stat(id, { signal }))?.revision !== snapshot.revision) throw new Error('历史仍在变化，稍后重试')
          const hash = digest.digest('hex')
          if (job.digest !== hash) { job.nextSeq = 0; job.digest = hash }
          job.throughSeq = count - 1
          this.revisions.set(key, snapshot.revision)
        }
        if (job.nextSeq > 0 && job.nextSeq === job.throughSeq + 1) { job.state = 'complete'; job.completedRevision = snapshot.revision; await this.save(); return }
        job.state = 'syncing'; await this.save()
        do {
          const { events } = await handle.read(job.nextSeq, Math.min(100, job.throughSeq + 1 - job.nextSeq), { signal })
          const entries = [], annotations = []; let bytes = 0
          for (const event of events) {
            const entry = snapshotDshHistoryEntry({ event }), projection = nativeAnnotationProjection(entry)
            const annotation = projection && { event_seq: event.seq, canonical_text: projection.canonical }
            const size = Buffer.byteLength(JSON.stringify(entry)), textBytes = annotation ? Buffer.byteLength(JSON.stringify(annotation)) : 0
            if (size > 512 * 1024) throw Object.assign(new Error('单条历史超过云端上限'), { code: 'LOCAL_HISTORY_TOO_LARGE' })
            if (bytes + size + textBytes > 4 * 1024 * 1024) break
            if (event.seq !== job.nextSeq + entries.length) throw new Error('历史序号不连续')
            entries.push(entry); bytes += size + textBytes
            if (annotation) annotations.push(annotation)
          }
          if (!entries.length && job.throughSeq !== -1) throw new Error('历史读取不完整')
          if ((await persistence.stat(id, { signal }))?.revision !== snapshot.revision) throw new Error('历史已变化，稍后重试')
          await this.options.authorize()
          const { result, count } = await this.postBatch(`${BASE}/repair`, { importer_runtime_ref: host.ref, importer_host_generation: host.generation,
            runtime_ref: job.runtime, session_ref: job.session, from_seq: job.nextSeq, through_seq: job.throughSeq, entries, annotations }, signal)
          signal.throwIfAborted(); await this.options.authorize()
          if (result.next_seq !== job.nextSeq + count || result.complete !== (result.next_seq === job.throughSeq + 1)) throw new Error('云端历史确认无效')
          job.nextSeq = Number(result.next_seq); job.attempts = 0
          job.state = result.complete ? 'complete' : 'syncing'
          if (result.complete) job.completedRevision = snapshot.revision
          await this.save(); await yieldNow(undefined, { signal })
          if (result.complete) break
        } while (job.state !== 'complete')
      } finally { await handle.close() }
    } catch (error) {
      const value = error as { code?: string; name?: string; httpStatus?: number; upstreamStatus?: number }
      if (this.controller.signal.aborted) job.state = 'pending'
      else if (value.code === 'HISTORY_REPAIR_CONFLICT') { job.state = 'conflict'; this.checkedConflicts.add(job) }
      else if ([404, 405].includes(value.upstreamStatus ?? 0)) { this.supported = false; this.capabilityExpiresAt = Date.now() + 300_000; job.state = 'unsupported' }
      else if (value.name === 'SessionPersistenceCorruptionError') job.state = 'failed'
      else if (/LOCAL_SOURCE_MISSING|LOCAL_HISTORY_TOO_LARGE|LOCAL_HISTORY_FORMAT_UNAVAILABLE|REMOTE_NOT_FOUND|INVALID|permission|account|auth/iu.test(value.code ?? '') || [401, 403].includes(value.httpStatus ?? 0)) job.state = 'failed'
      else job.state = 'pending'
      if (value.code === 'REMOTE_PROJECTION_CONFLICT') job.nextSeq = 0
      job.retryAt = Date.now() + Math.min(300_000, 5_000 * 2 ** Math.min(job.attempts++, 6))
      if (job.state === 'unsupported') job.retryAt = this.capabilityExpiresAt
      await this.save(); if (!this.controller.signal.aborted) this.options.report(error)
    }
  }
}
