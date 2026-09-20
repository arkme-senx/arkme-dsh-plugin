import type { DshRemoteHistoryEntry } from './dsh-event-contract.js'

export const LIVE_BATCH_ITEMS = 50
export const LIVE_BATCH_BYTES = 32 * 1024
const BUFFER_ENTRIES = 4096
const BUFFER_BYTES = 64 * 1024 * 1024
const MAX_PENDING_SESSIONS = 256

interface BufferedEntry {
  entry: DshRemoteHistoryEntry
  bytes: number
  issuedAt: number
  queuedAt: number
}
interface PendingSession {
  sessionRef: string
  cursor: number
  through: number
  entries: BufferedEntry[]
  replay: boolean
  queuedAt: number
  issuedAt: number
  readyAt: number
  retryAt: number
  bytes: number
}
export interface LiveEventBatch {
  sessionRef: string
  entries: DshRemoteHistoryEntry[]
  bytes: number
  issuedAt: number
  queueWaitMs: number
  replayed: boolean
}

/** One consumer forms batches when it can send; producer callbacks never wait on ACKs. */
export class DshLiveEventBatcher {
  private readonly sessions = new Map<string, PendingSession>()
  private bufferedBytes = 0
  private bufferedEntries = 0
  private flight: Promise<void> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private timerDueAt = Infinity
  private closed = false
  private readonly now: () => number

  constructor(private readonly options: {
    publish(batch: LiveEventBatch): Promise<void>
    // Read the existing canonical Host history, never a second archive or a lossy snapshot.
    replay(sessionRef: string, afterSeq: number, throughSeq: number): Promise<{ entries: DshRemoteHistoryEntry[]; throughSeq: number }>
    onError(error: unknown): void
    now?: () => number
    maxBufferEntries?: number
    maxBufferBytes?: number
  }) { this.now = options.now ?? (() => performance.now()) }

  enqueue(sessionRef: string, entry: DshRemoteHistoryEntry, issuedAt: number): void {
    if (this.closed) return
    let state = this.sessions.get(sessionRef)
    if (state === undefined) {
      if (this.sessions.size >= MAX_PENDING_SESSIONS) throw new Error('DSH live delivery pending-session limit exceeded')
      state = { sessionRef, cursor: entry.event.seq - 1, through: entry.event.seq - 1,
        entries: [], replay: false, queuedAt: this.now(), issuedAt, readyAt: this.now() + 40, retryAt: 0, bytes: 0 }
      this.sessions.set(sessionRef, state)
    }
    if (entry.event.seq <= state.through) return
    state.through = entry.event.seq
    const bytes = Buffer.byteLength(JSON.stringify(entry))
    if (!state.replay && this.bufferedEntries < (this.options.maxBufferEntries ?? BUFFER_ENTRIES)
      && this.bufferedBytes + bytes <= (this.options.maxBufferBytes ?? BUFFER_BYTES)) {
      state.entries.push({ entry, bytes, issuedAt, queuedAt: this.now() })
      state.bytes += bytes
      this.bufferedEntries++
      this.bufferedBytes += bytes
    } else {
      // Keep only a high-water mark once full. The consumer reads every omitted event
      // back from the authoritative Host before capture; it never advances past a gap.
      state.replay = true
    }
    if (entry.event.type !== 'assistant/chunk' || state.entries.length >= LIVE_BATCH_ITEMS
      || state.bytes >= LIVE_BATCH_BYTES) state.readyAt = 0
    this.schedule()
  }

  private schedule(): void {
    if (this.closed || this.flight !== undefined || this.sessions.size === 0) return
    const due = Math.min(...[...this.sessions.values()].map(state => Math.max(state.readyAt, state.retryAt)))
    if (this.timer !== undefined && this.timerDueAt <= due) return
    this.timerDueAt = due
    const delay = Math.max(0, due - this.now())
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = undefined; this.timerDueAt = Infinity; void this.drain() }, delay)
    this.timer.unref()
  }

  private async drain(): Promise<void> {
    if (this.flight !== undefined) return this.flight
    const flight = this.consume()
    this.flight = flight
    try { await flight }
    finally { if (this.flight === flight) this.flight = undefined; this.schedule() }
  }

  private async consume(): Promise<void> {
    while (!this.closed) {
      const state = [...this.sessions.values()].find(item => Math.max(item.readyAt, item.retryAt) <= this.now())
      if (state === undefined) return
      try {
        let source = state.entries
        let upper = state.through
        const replayed = source.length === 0 && state.replay
        if (replayed) {
          upper = Math.min(state.through, state.cursor + LIVE_BATCH_ITEMS)
          const page = await this.options.replay(state.sessionRef, state.cursor, upper)
          if (this.closed) return
          if (page.throughSeq <= state.cursor || page.throughSeq > upper
            || page.entries.some((item, index) => item.event.seq <= (page.entries[index - 1]?.event.seq ?? state.cursor)
              || item.event.seq > page.throughSeq)) {
            throw new Error('DSH live history replay returned an invalid range')
          }
          upper = page.throughSeq
          source = page.entries.map(entry => ({ entry, bytes: Buffer.byteLength(JSON.stringify(entry)),
            issuedAt: state.issuedAt, queuedAt: state.queuedAt }))
        }
        let bytes = 0
        const selected: BufferedEntry[] = []
        for (const item of source) {
          if (selected.length >= LIVE_BATCH_ITEMS || selected.length > 0 && bytes + item.bytes > LIVE_BATCH_BYTES) break
          selected.push(item)
          bytes += item.bytes
        }
        const through = replayed && selected.length === source.length
          ? upper : selected.at(-1)?.entry.event.seq
        if (through === undefined) throw new Error('DSH live delivery cannot advance without canonical events')
        if (selected.length > 0) {
          await this.options.publish({ sessionRef: state.sessionRef, entries: selected.map(item => item.entry),
            bytes, issuedAt: selected[0]!.issuedAt, queueWaitMs: Math.max(0, this.now() - selected[0]!.queuedAt), replayed })
        }
        if (this.closed) return
        if (!replayed) {
          state.entries.splice(0, selected.length)
          state.bytes -= bytes
          this.bufferedBytes -= bytes
          this.bufferedEntries -= selected.length
        }
        state.retryAt = 0
        state.cursor = through
        this.sessions.delete(state.sessionRef)
        if (state.cursor < state.through) {
          state.readyAt = 0
          this.sessions.set(state.sessionRef, state)
        }
      } catch (error) {
        // Retain a head that could not be prepared; new events cannot defeat backoff.
        // The Host consumes network failures after capture; wire retry stays in ChannelManager.
        state.retryAt = this.now() + 2_000
        try { this.options.onError(error) } catch { /* diagnostic only */ }
      }
    }
  }

  async flush(): Promise<void> {
    if (this.closed) return
    for (const state of this.sessions.values()) state.readyAt = 0
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    await this.drain()
  }

  close(): void {
    this.closed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.sessions.clear()
    this.bufferedBytes = 0
    this.bufferedEntries = 0
  }

  stats(): { bufferedBytes: number; bufferedEntries: number; pendingSessions: number } {
    return { bufferedBytes: this.bufferedBytes, bufferedEntries: this.bufferedEntries, pendingSessions: this.sessions.size }
  }
}
