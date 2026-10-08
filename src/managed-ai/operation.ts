import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { readSessionEvents } from '../dsh-session-events.js'

/** The durable DSH boundary, never a session-wide credit exemption. */
export function turnOperationId(session: Pick<Session, 'id'>, start: SessionEvent<'turn/start'>): string {
  return createHash('sha256').update(JSON.stringify([session.id, start.seq, start.time, start.data.turn])).digest('hex')
}

export class ManagedTurnFunding {
  // A credential is retained only until its actual turn ends. It is never
  // returned to the browser, logged, or re-resolved after an account switch.
  private readonly credentials = new Map<string, Set<string>>()

  constructor(
    private readonly session: (id: NonNullable<GenerateOptions['sessionId']>) => Session | undefined,
    private readonly close: (operationUid: string, bearer: string) => Promise<void>,
    private readonly failed: () => void,
  ) {}

  prepare(request: GenerateOptions, bearer: string): string | undefined {
    if (request.sessionId === undefined || request.purpose === 'session-title') return undefined
    const session = this.session(request.sessionId)
    if (session === undefined) return undefined
    const boundary = readSessionEvents(session).findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
    if (boundary?.type !== 'turn/start') return undefined
    const uid = turnOperationId(session, boundary)
    const credentials = this.credentials.get(uid) ?? new Set<string>()
    credentials.add(bearer)
    this.credentials.set(uid, credentials)
    return uid
  }

  async ended(session: Session, event: SessionEvent): Promise<void> {
    if (event.type !== 'turn/end') return
    const start = readSessionEvents(session).findLast(item => item.type === 'turn/start' && item.data.turn === event.data.turn)
    if (start?.type !== 'turn/start') return
    const uid = turnOperationId(session, start)
    const credentials = this.credentials.get(uid)
    this.credentials.delete(uid)
    if (credentials === undefined) return
    await Promise.all([...credentials].map(async bearer => {
      try { await this.close(uid, bearer) } catch { this.failed() }
    }))
  }

  dispose(): void { this.credentials.clear() }
}

export function registerManagedTurnFunding(ctx: Context, intelligentBaseUrl: string): ManagedTurnFunding {
  const funding = new ManagedTurnFunding(
    id => ctx.get('sessions')?.get(id),
    async (operationUid, bearer) => {
      const response = await fetch(`${intelligentBaseUrl.replace(/\/+$/, '')}/api/v1/managed-ai/operations/close`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation_uid: operationUid }),
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) throw new Error('Could not close AI turn')
    },
    () => ctx.logger.warn('Arkme AI turn close failed; server authorization expiry will reclaim it'),
  )
  ctx.on('session/event', (session, event) => {
    void funding.ended(session, event).catch(() => ctx.logger.warn('Arkme AI turn boundary could not be read'))
  }, { global: true })
  ctx.effect(() => () => funding.dispose())
  return funding
}
