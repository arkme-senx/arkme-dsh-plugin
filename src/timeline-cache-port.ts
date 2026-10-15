import { Worker } from 'node:worker_threads'
import type { ArkmeTimelinePage } from './types.js'
import type { TimelineCacheCommit } from './unified-timeline-cache.js'
import type { ChatSyncCommand } from './chat-message-sync.js'

export type TimelineCacheCommand = { kind: 'reserve' | 'close' }
  | { kind: 'sync'; command: ChatSyncCommand }
  | { kind: 'read'; scope: string; request: string; anchorId?: string; latest?: boolean }
  | { kind: 'write'; scope: string; request: string; page: ArkmeTimelinePage; options: TimelineCacheCommit }
  | { kind: 'invalidate'; scope: string; timelineItemKey?: string; terminal?: boolean; refreshOnly?: boolean }
  | { kind: 'invalidate-source'; sourceKey: string; timelineItemKey?: string; terminal?: boolean; refreshOnly?: boolean }
export interface TimelineCachePort {
  call<T>(command: TimelineCacheCommand): Promise<T>
  close(): void
}
const unavailable = () => new Error('Timeline storage unavailable')
function commandBytes(command: TimelineCacheCommand): number {
  if (command.kind !== 'write' && command.kind !== 'sync') return 4096
  // Count before structuredClone admission without allocating another full JSON copy.
  const queue: unknown[] = [command]
  const seen = new Set<object>()
  let bytes = 0
  for (let index = 0; index < queue.length; index++) {
    const value = queue[index]
    if (typeof value === 'string') bytes += value.length * 3 + 8
    else if (value && typeof value === 'object' && !seen.has(value)) {
      seen.add(value); bytes += 32
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue
        bytes += key.length * 3 + 8; queue.push((value as Record<string, unknown>)[key])
        if (bytes > 8 * 1024 * 1024 || queue.length > 100000) throw unavailable()
      }
    } else bytes += 8
    if (bytes > 8 * 1024 * 1024 || queue.length > 100000) throw unavailable()
  }
  return bytes
}

/** One bounded worker per Host. SQL, JSON, cleanup and checkpoints never execute on the Host event loop. */
export class TimelineCacheWorker implements TimelineCachePort {
  private readonly worker: Worker
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void; timer: ReturnType<typeof setTimeout>; bytes: number }>()
  private queuedBytes = 0
  private nextId = 0
  private closed = false
  private initialized = false
  private readonly startupTimer: ReturnType<typeof setTimeout>
  constructor(directory: string, workerUrl = new URL('./timeline-cache-worker.js', import.meta.url)) {
    this.worker = new Worker(workerUrl, { workerData: { directory } })
    this.worker.unref()
    this.startupTimer = setTimeout(() => { this.fail(); void this.worker.terminate() }, 30000)
    this.startupTimer.unref?.()
    this.worker.on('message', (reply: { ready?: boolean; id: number; value?: unknown; failed?: boolean; code?: string }) => {
      this.initialized = true; clearTimeout(this.startupTimer)
      if (reply.ready) return
      const request = this.pending.get(reply.id)
      if (!request) return
      this.pending.delete(reply.id); clearTimeout(request.timer)
      this.queuedBytes -= request.bytes
      if (!this.pending.size) this.worker.unref()
      if (reply.failed) request.reject(reply.code ? new Error(reply.code) : unavailable()); else request.resolve(reply.value)
    })
    this.worker.on('error', () => this.fail())
    this.worker.on('exit', () => this.fail())
  }
  call<T>(command: TimelineCacheCommand): Promise<T> {
    if (this.closed || this.pending.size >= 32) return Promise.reject(unavailable())
    let bytes: number
    try { bytes = commandBytes(command) } catch { return Promise.reject(unavailable()) }
    if (this.queuedBytes + bytes > 64 * 1024 * 1024) return Promise.reject(unavailable())
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        console.warn('arkme: timeline storage request timed out', { kind: command.kind, ...(command.kind === 'sync' ? { action: command.command.action } : {}), pending: this.pending.size })
        if (!this.initialized) {
          // Cold startup must not permanently disable offline reads. The caller
          // still falls back at 5s; retain admission accounting until the queued
          // reply arrives, or the bounded 30s startup deadline terminates it.
          reject(unavailable()); return
        }
        this.fail(); void this.worker.terminate()
      }, 5000)
      this.queuedBytes += bytes
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer, bytes })
      this.worker.ref()
      try { this.worker.postMessage({ id, command }) } catch { this.fail(); void this.worker.terminate() }
    })
  }
  private fail(): void {
    this.closed = true; clearTimeout(this.startupTimer)
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(unavailable()) }
    this.pending.clear()
    this.queuedBytes = 0
  }
  close(): void {
    if (this.closed) return
    // FIFO close drains already accepted commits; crash/timeout relies on SQLite recovery.
    void this.call({ kind: 'close' }).finally(() => { this.fail(); void this.worker.terminate() }).catch(() => undefined)
    this.closed = true
  }
}
