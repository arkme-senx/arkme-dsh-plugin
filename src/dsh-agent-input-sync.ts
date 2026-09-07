import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ArkmeService } from './arkme-service.js'
import { ArkmePluginError } from './services/service.js'

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

export function dshAgentInputRecordUid(sessionId: string, submissionId: string): string {
  return stableRecordUid('dsh-agent-input-submission-v1', `${sessionId}\0${submissionId}`)
}

export interface DshAgentTextSubmission {
  submissionId: string
  text: string
}

/** Read accepted composer text, never model-facing user-role content. */
export function dshAgentInputSubmissionsFromEvent(event: unknown, sessionId: string): DshAgentTextSubmission[] {
  const envelope = objectValue(event) as DshSessionEventLike
  if (envelope.type !== 'agent/inbox/spliced') return []
  const data = objectValue(envelope.data)
  if (data.outcome === 'canceled' || (typeof data.removedCount === 'number' && data.removedCount > 0)) return []
  return (Array.isArray(data.inserted) ? data.inserted : []).flatMap(value => {
    const source = objectValue(objectValue(value).source)
    const submission = objectValue(source.submission)
    const submissionId = stringValue(source.rpcId)
    const text = stringValue(submission.text)
    if (source.kind !== 'user' || submission.schemaVersion !== 1 || submission.origin !== 'web-composer'
      || submission.sessionId !== sessionId || submissionId.trim() === '' || text.trim() === '') return []
    return [{ submissionId, text }]
  })
}

export type DshAgentInputWriter = (recordUid: string, text: string, sendAtMillis: number) => Promise<unknown>

export function registerDSHAgentInputRecordSync(
  ctx: Context,
  service: Pick<ArkmeService, 'captureDSHAgentInputWriter'>,
  options: { logger?: LoggerLike; maxAttempts?: number; retryDelayMillis?: number } = {},
): void {
  const logger = options.logger ?? ctx.logger
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? 3))
  const retryDelayMillis = Math.max(0, Math.trunc(options.retryDelayMillis ?? 5_000))
  // An observed submission never acquires a second account, even after terminal failure.
  const observed = new Set<string>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let disposed = false
  let warnedUnsupported = false
  const sync = (
    recordUid: string,
    text: string,
    sendAtMillis: number,
    attempt: number,
    writer: DshAgentInputWriter,
  ) => {
    void Promise.resolve().then(() => disposed ? undefined : writer(recordUid, text, sendAtMillis))
      .catch((error: unknown) => {
        if (disposed) return
        if (error instanceof ArkmePluginError && !error.retryable) {
          logger.warn('dsh-arkme: accepted DSH text sync stopped by account or input policy')
          return
        }
        if (attempt < maxAttempts) {
          const timer = setTimeout(() => {
            timers.delete(timer)
            if (disposed) return
            sync(recordUid, text, sendAtMillis, attempt + 1, writer)
          }, retryDelayMillis)
          timers.add(timer)
          return
        }
        logger.warn('dsh-arkme: failed to sync accepted DSH text after bounded retries')
      })
  }
  const listener: SessionEventListener = (rawSession, rawEvent) => {
    if (disposed) return
    const event = objectValue(rawEvent) as DshSessionEventLike
    if (event.type !== 'agent/inbox/spliced' && event.type !== 'user/message') return
    if (typeof objectValue(ctx.get('sessionController')).submitText !== 'function') {
      if (!warnedUnsupported) {
        warnedUnsupported = true
        logger.warn('dsh-arkme: DSH text sync requires sessionController.submitText with composer provenance v1; upgrade the DSH host and Web client together. Unmarked messages are not archived.')
      }
      return
    }
    const session = objectValue(rawSession) as DshSessionLike
    const sessionId = stringValue(session.id).trim()
    if (sessionId === '' || !Number.isSafeInteger(event.seq) || (event.seq as number) < 0
      || typeof event.time !== 'number' || !Number.isFinite(event.time) || event.time <= 0) return
    for (const submission of dshAgentInputSubmissionsFromEvent(event, sessionId)) {
      const key = `${sessionId}\0${submission.submissionId}`
      if (observed.has(key)) continue
      observed.add(key)
      void service.captureDSHAgentInputWriter().then(writer => {
        if (disposed) return
        sync(dshAgentInputRecordUid(sessionId, submission.submissionId), submission.text, numberValue(event.time), 1, writer)
      }).catch(() => {
        if (!disposed) logger.warn('dsh-arkme: accepted DSH text could not acquire an account-scoped writer')
      })
    }
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
