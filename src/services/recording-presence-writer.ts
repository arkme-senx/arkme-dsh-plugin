import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { hostname, platform as osPlatform } from 'node:os'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

export type CapturePresenceFact = { operation: 'start' | 'update' | 'stop'; recordingId: string; startedAt: number; elapsedMillis: number; reason?: string }
type Operation = CapturePresenceFact['operation']
type Body = Record<string, unknown> & { recording_id: string; runtime_id: string; writer_token: string; seq: number; elapsed_ms: number; state: string }
type Pending = { operation: Operation; body: Body }
type Entry = { recordingId: string; runtimeId: string; writerToken: string; startedAt: number; deviceName: string; platform: string; elapsedMillis: number; seq: number; stopped: boolean; stopReason?: string; pending?: Pending | undefined; lastEvidenceAt: number; lastSentAt: number; heartbeatMs?: number; retryAt?: number; hold?: boolean }
type Persisted = { version: 1; entries: Entry[] }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HEARTBEAT_MS = 10_000
const EVIDENCE_MS = 15_000
const ERROR_CODE = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') return undefined
  const code = 'code' in error ? String(error.code) : ''
  const match = code.match(/(?:^|-)12(0[1-6])$/)
  return match ? Number(`12${match[1]}`) : undefined
}
function truncateUtf8(value: string, limit: number): string {
  let result = ''
  let bytes = 0
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > limit) break
    result += character; bytes += size
  }
  return result
}
function actualPlatform(): string {
  const value = osPlatform()
  return value === 'darwin' ? 'macos' : value === 'win32' ? 'windows' : value === 'linux' ? 'linux' : 'web'
}

/** One host writer owns credentials and durable protocol identity. The renderer supplies capture facts only. */
export class RecordingPresenceWriter {
  private scope = ''
  private entries: Entry[] = []
  private loaded = false
  private dirty = false
  private credential: string | undefined
  private generation = 0
  private mutation: Promise<unknown> = Promise.resolve()
  private sending = false
  private inflight: Pending | undefined
  private abort = new AbortController()
  private timer?: ReturnType<typeof setTimeout>
  constructor(private readonly runtime: ServiceRuntime, private readonly directory: string, private readonly now = Date.now,
    private readonly identity = () => ({ name: hostname(), platform: actualPlatform() })) {}
  private path(scope: string): string { return join(this.directory, `recording-presence-${scope.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`) }
  private current(generation: number): boolean { return generation === this.generation }
  private async save(generation: number): Promise<void> {
    if (!this.current(generation) || !this.scope) return
    const target = this.path(this.scope)
    const temporary = `${target}.${randomUUID()}.tmp`
    const data = JSON.stringify({ version: 1, entries: this.entries } satisfies Persisted)
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      if (!this.current(generation)) return
      await writeFile(temporary, data, { mode: 0o600 })
      if (!this.current(generation)) { await unlink(temporary).catch(() => undefined); return }
      await rename(temporary, target)
      if (this.current(generation)) this.dirty = false
    } catch (error) {
      if (this.current(generation)) this.dirty = true
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }
  private async load(scope: string, generation: number): Promise<void> {
    if (this.scope === scope && this.loaded) return
    if (!this.current(generation)) return
    this.abort.abort(); this.abort = new AbortController(); this.sending = false; this.inflight = undefined
    let entries: Entry[] = []
    try {
      const data = JSON.parse(await readFile(this.path(scope), 'utf8')) as Persisted
      if (data.version === 1 && Array.isArray(data.entries)) entries = data.entries
        .filter(item => UUID.test(item.recordingId) && UUID.test(item.runtimeId) && /^[0-9a-f]{64}$/.test(item.writerToken))
        .map(item => ({ ...item, hold: false, retryAt: 0 }))
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (!this.current(generation)) return
    this.scope = scope; this.entries = entries; this.loaded = true
    // A process restart has no live capture evidence. Reconcile old sessions as terminal.
    for (const entry of this.entries) if (!entry.stopped) this.stopEntry(entry, 'process_recovered')
    try { await this.save(generation) }
    catch (error) { if (this.current(generation)) { this.loaded = false; this.schedule(HEARTBEAT_MS) }; throw error }
  }
  private body(entry: Entry, operation: Operation, seq: number): Body {
    return { recording_id: entry.recordingId, runtime_id: entry.runtimeId, writer_token: entry.writerToken,
      device_name: entry.deviceName, client_type: 'desktop', platform: entry.platform, recording_mode: 'manual',
      state: operation === 'stop' ? 'stopped' : 'recording', elapsed_ms: Math.floor(entry.elapsedMillis),
      started_at: entry.startedAt, seq, ...(operation === 'stop' ? { stop_reason: entry.stopReason || 'capture_stopped' } : {}) }
  }
  private pending(entry: Entry, operation: Operation): void {
    entry.seq += 1
    entry.pending = { operation, body: this.body(entry, operation, entry.seq) }
  }
  private stopEntry(entry: Entry, reason: string): void {
    entry.stopped = true; entry.stopReason = truncateUtf8(reason, 128).trim() || 'capture_stopped'; entry.retryAt = 0
    if (entry.pending && entry.pending !== this.inflight) entry.pending = undefined
    if (!entry.pending) this.pending(entry, 'stop')
  }
  revoke(): void {
    this.generation++
    this.abort.abort(); this.abort = new AbortController(); this.scope = ''; this.entries = []; this.loaded = false; this.dirty = false; this.credential = undefined; this.sending = false; this.inflight = undefined
    if (this.timer) clearTimeout(this.timer)
  }
  async resumeCurrent(): Promise<void> {
    const generation = this.generation
    const run = async () => {
      if (!this.current(generation)) return
      const session = await this.runtime.requireSession()
      if (!this.current(generation)) return
      const scope = `${this.runtime.config.environment}:${session.userId}`
      await this.load(scope, generation)
      if (!this.current(generation)) return
      if (this.credential !== undefined && this.credential !== session.accessToken) {
        for (const item of this.entries) { item.hold = false; item.retryAt = 0 }
      }
      this.credential = session.accessToken
      this.pump()
    }
    const result = this.mutation.then(run)
    this.mutation = result.catch(() => undefined)
    await result
  }
  async report(accountKey: string, fact: CapturePresenceFact): Promise<void> {
    const generation = this.generation
    const run = async () => {
      if (!this.current(generation)) return
      const session = await this.runtime.requireSession()
      if (!this.current(generation)) return
      const scope = `${this.runtime.config.environment}:${session.userId}`
      if (scope !== accountKey) throw new ArkmePluginError('recording-presence-account-changed', '账号已变化', false, 403)
      await this.load(scope, generation)
      if (!this.current(generation)) return
      if (this.credential !== undefined && this.credential !== session.accessToken) {
        for (const item of this.entries) { item.hold = false; item.retryAt = 0 }
      }
      this.credential = session.accessToken
      if (!['start', 'update', 'stop'].includes(fact.operation) || !UUID.test(fact.recordingId) || !Number.isSafeInteger(fact.startedAt) || fact.startedAt <= 0 || !Number.isFinite(fact.elapsedMillis) || fact.elapsedMillis < 0) throw new ArkmePluginError('recording-presence-invalid', '录音事实无效', false)
      let entry = this.entries.find(item => item.recordingId === fact.recordingId)
      if (fact.operation === 'start') {
        if (entry) return
        const identity = this.identity()
        if (!identity.name.trim() || Buffer.byteLength(identity.name) > 256 || !['macos', 'windows', 'linux'].includes(identity.platform)) return
        entry = { recordingId: fact.recordingId, runtimeId: randomUUID(), writerToken: randomBytes(32).toString('hex'), startedAt: fact.startedAt,
          deviceName: identity.name, platform: identity.platform, elapsedMillis: Math.floor(fact.elapsedMillis), seq: 0,
          stopped: false, lastEvidenceAt: this.now(), lastSentAt: 0 }
        this.entries.push(entry); this.pending(entry, 'start')
      } else {
        if (!entry || entry.stopped || entry.startedAt !== fact.startedAt) return
        const elapsed = Math.floor(fact.elapsedMillis)
        const grew = elapsed > entry.elapsedMillis
        if (grew) { entry.elapsedMillis = elapsed; entry.lastEvidenceAt = this.now() }
        if (fact.operation === 'stop') this.stopEntry(entry, fact.reason || 'capture_stopped')
        else if (grew && !entry.pending && this.now() - entry.lastSentAt >= (entry.heartbeatMs ?? HEARTBEAT_MS)) this.pending(entry, 'update')
      }
      try { await this.save(generation) }
      catch (error) { if (this.current(generation)) this.schedule(HEARTBEAT_MS); throw error }
      if (this.current(generation)) this.pump()
    }
    const result = this.mutation.then(run)
    this.mutation = result.catch(() => undefined)
    await result
  }
  private pump(): void {
    if (this.sending || !this.scope) return
    const ready = (item: Entry) => !item.hold && (item.retryAt ?? 0) <= this.now()
      && (item.pending?.operation === 'stop' || this.now() - item.lastEvidenceAt <= EVIDENCE_MS)
    const stops = this.entries.filter(item => item.pending?.operation === 'stop')
    const entry = stops.length ? stops.find(ready) : this.entries.find(item => item.pending && ready(item))
    if (!entry?.pending) { this.schedule(); return }
    this.sending = true
    const request = entry.pending; this.inflight = request
    const scope = this.scope; const signal = this.abort.signal; const generation = this.generation
    void (async () => {
      let response: Record<string, unknown> | undefined
      let failure: unknown
      try {
        const session = await this.runtime.requireSession()
        if (`${this.runtime.config.environment}:${session.userId}` !== scope || signal.aborted || !this.current(generation)) return
        response = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
          `/api/v1/audio/recording-presence/${request.operation}`, request.body, session, signal,
          { lane: 'write', bypassCache: true, trackWriteOutcome: true, publishServiceCooldown: false })
      } catch (error) { failure = error }
      if (scope !== this.scope || signal.aborted || !this.current(generation)) return
      const settle = async () => {
        if (scope !== this.scope || signal.aborted || !this.current(generation)) return
        if (failure === undefined) {
          const interval = Number(response?.heartbeat_interval_ms)
          entry.heartbeatMs = Number.isSafeInteger(interval) && interval > 0 && interval <= 2_147_483_647 ? interval : HEARTBEAT_MS
          entry.lastSentAt = this.now()
          entry.retryAt = 0
          if (entry.pending === request) entry.pending = undefined
          if (entry.stopped && !entry.pending) {
            if (request.operation === 'stop') this.entries = this.entries.filter(item => item !== entry)
            else this.pending(entry, 'stop')
          } else if (!entry.stopped && !entry.pending && this.now() - entry.lastEvidenceAt <= EVIDENCE_MS
            && entry.elapsedMillis - Number(request.body.elapsed_ms) >= (entry.heartbeatMs ?? HEARTBEAT_MS)) this.pending(entry, 'update')
        } else {
          const code = ERROR_CODE(failure)
          entry.retryAt = this.now() + HEARTBEAT_MS
          if (code === 1203 || code === 1204 || code === 1206) this.entries = this.entries.filter(item => item !== entry)
          else if (code === 1201 || code === 1202) entry.hold = true
          else if (code === 1205 && request.operation === 'update' && entry.pending === request) this.pending(entry, 'start')
          if (entry.stopped && request.operation !== 'stop' && entry.pending === request) {
            entry.pending = undefined; this.pending(entry, 'stop'); entry.retryAt = 0
          }
        }
        await this.save(generation)
      }
      const settled = this.mutation.then(settle)
      this.mutation = settled.catch(() => undefined)
      await settled.catch(() => undefined)
    })().finally(() => {
      if (this.inflight === request) { this.sending = false; this.inflight = undefined }
      if (scope === this.scope && !signal.aborted && this.current(generation)) {
        if (this.entries.some(item => item.pending && !item.hold && (item.retryAt ?? 0) <= this.now()
          && (item.pending.operation === 'stop' || this.now() - item.lastEvidenceAt <= EVIDENCE_MS))) this.pump()
        else this.schedule()
      }
    })
  }

  private schedule(afterFailure?: number): void {
    if (this.timer) clearTimeout(this.timer)
    if (!this.scope || (!this.entries.length && !this.dirty)) return
    const now = this.now()
    let delay = afterFailure ?? (this.dirty ? HEARTBEAT_MS : Number.POSITIVE_INFINITY)
    const waitingStops = this.entries.some(entry => entry.pending?.operation === 'stop')
    if (afterFailure === undefined) for (const entry of this.entries) {
      if (waitingStops && entry.pending?.operation !== 'stop') continue
      if (entry.hold) continue
      if (entry.pending) {
        if (entry.pending.operation === 'stop' || now - entry.lastEvidenceAt <= EVIDENCE_MS) {
          delay = Math.min(delay, Math.max(1, (entry.retryAt ?? now) - now))
        }
      } else if (!entry.stopped && now - entry.lastEvidenceAt <= EVIDENCE_MS) {
        delay = Math.min(delay, Math.max(1, entry.lastSentAt + (entry.heartbeatMs ?? HEARTBEAT_MS) - now))
      }
    }
    if (!Number.isFinite(delay)) return
    const generation = this.generation
    this.timer = setTimeout(() => {
      void this.tick().catch(() => { if (this.current(generation) && this.scope) this.schedule(HEARTBEAT_MS) })
    }, Math.max(1, delay))
    this.timer.unref?.()
  }
  private async tick(): Promise<void> {
    const generation = this.generation
    const run = async () => {
      if (!this.scope || !this.current(generation)) return
      const now = this.now()
      for (const entry of this.entries) {
        if (entry.stopped || entry.pending || entry.hold) continue
        if (now - entry.lastEvidenceAt <= EVIDENCE_MS && now - entry.lastSentAt >= (entry.heartbeatMs ?? HEARTBEAT_MS)) this.pending(entry, 'update')
      }
      try { await this.save(generation) }
      catch (error) { if (this.current(generation)) this.schedule(HEARTBEAT_MS); throw error }
      if (this.current(generation)) this.pump()
    }
    const result = this.mutation.then(run); this.mutation = result.catch(() => undefined); await result
  }
}
