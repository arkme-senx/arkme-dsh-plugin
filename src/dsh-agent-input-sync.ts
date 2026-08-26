import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ArkmeService } from './arkme-service.js'

interface LoggerLike {
  warn(message: string): void
}

interface DshSessionLike {
  id?: unknown
}

interface DshSessionEventLike {
  type?: unknown
  seq?: unknown
  time?: unknown
  data?: unknown
}

type SessionEventListener = (session: unknown, event: unknown) => void

interface SessionEventSource {
  on(name: 'session/event', listener: SessionEventListener, options: { global: true }): () => boolean
}

function sessionEventSource(value: unknown): SessionEventSource | undefined {
  return value !== null && typeof value === 'object' && typeof (value as { on?: unknown }).on === 'function'
    ? value as SessionEventSource
    : undefined
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stableRecordUid(namespace: string, key: string): string {
  const bytes = createHash('sha256').update(`dsh-arkme:${namespace}:${key}`).digest().subarray(0, 16)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function dshAgentInputRecordUid(sessionId: string, eventSeq: number): string {
  return stableRecordUid('dsh-agent-input', `${sessionId}\0${String(eventSeq)}`)
}

export function dshAgentInputTextFromEvent(event: unknown): string | undefined {
  const envelope = objectValue(event) as DshSessionEventLike
  if (envelope.type !== 'user/message') return undefined
  const data = objectValue(envelope.data)
  if (objectValue(data.source).kind !== 'user') return undefined
  const content = Array.isArray(data.content) ? data.content : []
  const text = content
    .map(block => {
      const item = objectValue(block)
      return item.type === 'text' ? stringValue(item.text).trim() : ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
  return text === '' ? undefined : text
}

export function registerDSHAgentInputRecordSync(
  ctx: Context,
  service: Pick<ArkmeService, 'createDSHAgentInputText'>,
  options: { logger?: LoggerLike; maxAttempts?: number; retryDelayMillis?: number } = {},
): void {
  const logger = options.logger ?? ctx.logger
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? 3))
  const retryDelayMillis = Math.max(0, Math.trunc(options.retryDelayMillis ?? 5_000))
  const inFlight = new Set<string>()
  const synced = new Set<string>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let disposed = false
  const sync = (
    key: string,
    recordUid: string,
    text: string,
    sendAtMillis: number,
    attempt: number,
  ) => {
    inFlight.add(key)
    let retrying = false
    void service.createDSHAgentInputText(recordUid, text, sendAtMillis)
      .then(() => {
        if (disposed) return
        synced.add(key)
      })
      .catch(error => {
        if (disposed) return
        if (attempt < maxAttempts) {
          retrying = true
          const timer = setTimeout(() => {
            timers.delete(timer)
            if (disposed) {
              inFlight.delete(key)
              return
            }
            sync(key, recordUid, text, sendAtMillis, attempt + 1)
          }, retryDelayMillis)
          timers.add(timer)
          return
        }
        const message = error instanceof Error && error.message.trim() !== '' ? error.message : String(error)
        logger.warn(`dsh-arkme: failed to sync DSH Agent input record: ${message}`)
      })
      .finally(() => {
        if (!retrying || disposed) inFlight.delete(key)
      })
  }
  const listener: SessionEventListener = (rawSession, rawEvent) => {
    if (disposed) return
    const event = objectValue(rawEvent) as DshSessionEventLike
    const session = objectValue(rawSession) as DshSessionLike
    const sessionId = stringValue(session.id).trim()
    const eventSeq = Math.trunc(numberValue(event.seq))
    if (sessionId === '' || eventSeq < 0) return
    const text = dshAgentInputTextFromEvent(event)
    if (text === undefined) return
    const key = `${sessionId}\0${String(eventSeq)}`
    if (inFlight.has(key) || synced.has(key)) return
    sync(key, dshAgentInputRecordUid(sessionId, eventSeq), text, numberValue(event.time), 1)
  }
  ctx.effect(() => {
    const source = sessionEventSource(ctx)
    if (source === undefined) {
      logger.warn('dsh-arkme: DSH session/event API is unavailable; DSH Agent input sync disabled')
      return () => {}
    }
    const dispose = source.on('session/event', listener, { global: true })
    return () => {
      disposed = true
      void dispose()
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    }
  }, 'dsh-arkme: DSH Agent input record sync')
}
