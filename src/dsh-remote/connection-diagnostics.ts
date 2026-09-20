import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { NodeClient, defaultStackParser, makeNodeTransport, type Event } from '@sentry/node'

const allowed = new Set([
  'batch_count', 'event_count', 'incomplete_batches', 'payload_bytes', 'replayed_batches', 'pending_bytes_max', 'pending_entries_max',
  ...['queue_ms', 'ownership_ms', 'capture_ms', 'channel_queue_ms', 'publish_ack_ms'].flatMap(key => [`${key}_sum`, `${key}_max`]),
  'user_id', 'client_id', 'runtime_ref', 'desktop_ref', 'connection_generation', 'lease_generation',
  'host_generation', 'error_code', 'reason', 'retryable', 'closeCode', 'last_receive_age_ms',
  'duration_ms', 'attempt_id', 'phase', 'request_id', 'trace_id', 'suspended',
])

/** Bounded, per-Profile incident reporting. Never installs global Sentry instrumentation. */
export class DshConnectionDiagnostics {
  private readonly client: NodeClient | undefined
  private readonly pending: Event[] = []
  private history: Record<string, unknown>[] = []
  private episode: { id: string; at: number; failures: number; reported: boolean } | undefined
  private saveTail = Promise.resolve()
  private saveRequested = false
  private saving = false
  private draining: Promise<void> | undefined
  private nextAttempt = 0
  private closed = false
  private accountId: string | undefined
  private accountGeneration = 0
  private readonly loaded: Promise<void>

  constructor(private readonly options: {
    dsn: string
    environment: string
    release: string
    path: string
    log: (fields: Record<string, unknown>) => void
    now?: () => number
  }) {
    try {
    if (options.dsn !== '') {
      const dsn = new URL(options.dsn)
      if (dsn.protocol !== 'https:' || dsn.password !== '' || dsn.search !== '') throw new TypeError('Invalid remote diagnostic DSN')
      this.client = new NodeClient({
        dsn: options.dsn, environment: options.environment, release: options.release,
        integrations: [], stackParser: defaultStackParser, sendClientReports: false,
        transport: (transportOptions: Parameters<typeof makeNodeTransport>[0]): ReturnType<typeof makeNodeTransport> => {
          const transport = makeNodeTransport({ ...transportOptions, bufferSize: 1 })
          return {
            flush: timeout => transport.flush(timeout),
            send: async envelope => {
              const result = await transport.send(envelope)
              if (result.statusCode !== undefined && result.statusCode >= 200 && result.statusCode < 500 && result.statusCode !== 429) {
                const id = envelope[0].event_id
                const index = this.pending.findIndex(event => event.event_id === id)
                if (index >= 0) { this.pending.splice(index, 1); this.save() }
              }
              return result
            },
          }
        },
      })
    }
    } catch {
      // Invalid observability configuration never prevents the business Host from loading.
      try { options.log({ phase: 'diagnostics_unavailable', reason: 'invalid_configuration' }) } catch { /* best effort */ }
    }
    this.loaded = this.load()
  }

  resetAccount(accountId: string | undefined): void {
    if (this.accountId === accountId) return
    this.accountId = accountId
    const generation = ++this.accountGeneration
    this.episode = undefined
    this.history = []
    // A new account must not inherit another account's incident backlog.
    void this.loaded.then(() => {
      if (generation !== this.accountGeneration || this.closed) return
      for (let i = this.pending.length - 1; i >= 0; i--) {
        if (String(this.pending[i]!.user?.id ?? '') !== accountId) this.pending.splice(i, 1)
      }
      this.save()
    })
  }

  record(phase: string, fields: Record<string, unknown> = {}): void {
    if (this.closed) return
    const now = this.now()
    const safe: Record<string, unknown> = { phase, at: now }
    for (const [key, value] of Object.entries(fields)) {
      if (allowed.has(key) && (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string' && value.length <= 160)) safe[key] = value
    }
    try { this.options.log({ service: 'arkme-dsh-host', deploy_env: this.options.environment, release: this.options.release, ...safe }) } catch { /* Diagnostics cannot break connectivity. */ }
    if (phase === 'live_delivery_window') return
    this.history.push(safe)
    if (this.history.length > 32) this.history.shift()
    if (phase === 'connection_failed') {
      if (fields.reason === 'system_resume') return
      this.episode ??= { id: randomUUID(), at: now, failures: 0, reported: false }
      this.episode.failures += 1
      if (this.episode.failures >= 3 || fields.retryable === false) this.report('connection_failed')
    } else if (phase === 'host_registered') {
      if (this.episode?.reported) this.report('recovered', true)
      this.episode = undefined
      this.history = []
    }
  }

  /** Called by the existing session poll; no independent retry timer. */
  tick(): void {
    if (this.closed || this.accountId === undefined) return
    if (this.episode !== undefined && this.now() - this.episode.at >= 60_000) this.report('connection_failed')
    if (this.draining !== undefined || this.now() < this.nextAttempt || this.client === undefined) return
    const generation = this.accountGeneration
    const flight = this.loaded.then(async () => {
      if (this.closed || generation !== this.accountGeneration) return
      while (this.pending.length > 0 && (this.pending[0]!.timestamp ?? 0) * 1000 < this.now() - 7 * 86_400_000) this.pending.shift()
      const event = this.pending.find(value => String(value.user?.id ?? '') === this.accountId)
      if (event === undefined) return
      this.nextAttempt = this.now() + 30_000
      this.client!.captureEvent(event)
      await this.client!.flush(2_000)
    }).catch(() => undefined).finally(() => { if (this.draining === flight) this.draining = undefined })
    this.draining = flight
  }

  async close(): Promise<void> {
    this.closed = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = async () => {
      await this.draining
      await this.client?.close(2_000)
      await this.saveTail
    }
    await Promise.race([
      finish().catch(() => undefined),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 2_000) }),
    ])
    if (timer !== undefined) clearTimeout(timer)
  }

  private now(): number { return (this.options.now ?? Date.now)() }
  private report(phase: string, recovered = false): void {
    const episode = this.episode
    if (episode === undefined || episode.reported && !recovered) return
    episode.reported = true
    const event: Event = {
      event_id: randomUUID().replaceAll('-', ''), timestamp: this.now() / 1000,
      message: `DSH Host ${phase}`, level: recovered ? 'info' : 'warning',
      tags: { feature: 'dsh_remote', phase },
      contexts: { dsh_connection: { episode_id: episode.id, failures: episode.failures, duration_ms: this.now() - episode.at, transitions: [...this.history] } },
    }
    const user = this.accountId ?? this.history.findLast(value => value.user_id !== undefined)?.user_id
    if (user !== undefined) event.user = { id: String(user) }
    if (Buffer.byteLength(JSON.stringify(event)) > 24 * 1024) return
    const generation = this.accountGeneration
    void this.loaded.then(() => {
      if (this.closed || this.accountGeneration !== generation) return
      this.pending.push(event)
      while (this.pending.length > 100) this.pending.shift()
      this.save()
      this.tick()
    })
  }

  private async load(): Promise<void> {
    try {
      if ((await stat(this.options.path)).size > 3 * 1024 * 1024) return
      const events: unknown = JSON.parse(await readFile(this.options.path, 'utf8'))
      if (Array.isArray(events)) for (const event of events.slice(-100)) {
        if (event === null || typeof event !== 'object' || !/^[a-f0-9]{32}$/.test(String(event.event_id)) ||
            typeof event.timestamp !== 'number' || event.timestamp * 1000 < this.now() - 7 * 86_400_000 ||
            event.timestamp * 1000 > this.now() || Buffer.byteLength(JSON.stringify(event)) > 24 * 1024) continue
        const phase = event.tags?.phase
        const context = event.contexts?.dsh_connection
        if ((phase !== 'connection_failed' && phase !== 'recovered') || !context || !Array.isArray(context.transitions) ||
            typeof context.episode_id !== 'string' || context.episode_id.length > 64 || !Number.isFinite(context.duration_ms) ||
            !Number.isSafeInteger(context.failures) || !/^\d{1,20}$/.test(String(event.user?.id))) continue
        const transitions = context.transitions.slice(-32).map((row: unknown) => {
          if (row === null || typeof row !== 'object') return {}
          return Object.fromEntries(Object.entries(row).filter(([key, value]) =>
            (allowed.has(key) || key === 'at') && (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 160)))
        })
        this.pending.push({ event_id: event.event_id, timestamp: event.timestamp, message: `DSH Host ${phase}`,
          level: phase === 'recovered' ? 'info' : 'warning', user: { id: String(event.user.id) }, tags: { feature: 'dsh_remote', phase },
          contexts: { dsh_connection: { episode_id: context.episode_id, duration_ms: context.duration_ms, failures: context.failures, transitions } } })
      }
    } catch { /* Missing or invalid diagnostic cache does not block startup. */ }
  }

  private save(): void {
    this.saveRequested = true
    if (this.saving) return
    this.saving = true
    this.saveTail = (async () => {
      while (this.saveRequested) {
        this.saveRequested = false
        const data = JSON.stringify(this.pending)
        await mkdir(dirname(this.options.path), { recursive: true })
        await writeFile(`${this.options.path}.tmp`, data, { mode: 0o600 })
        await rename(`${this.options.path}.tmp`, this.options.path)
      }
    })().catch(() => undefined).finally(() => { this.saving = false })
  }
}
