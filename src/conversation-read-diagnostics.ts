import { AsyncLocalStorage } from 'node:async_hooks'

declare const __ARKME_LOCAL_HISTORY_TIMING__: boolean
export function historyReadTrace(value: string | null): string | undefined {
  if (typeof __ARKME_LOCAL_HISTORY_TIMING__ !== 'undefined' && __ARKME_LOCAL_HISTORY_TIMING__
    && value && /^[a-f0-9]{16}-[1-9][0-9]?-[1-9][0-9]?$/.test(value)) return value
}
type Phase = 'scope' | 'storage-ready' | 'access' | 'projection' | 'message-bodies' | 'worker-queue' | 'sqlite' | 'upstream' | 'owner-queue' | 'upstream-queue' | 'upstream-http' | 'network-projection' | 'cache-commit' | 'bot-display-disk' | 'bot-display-network'
const timing = new AsyncLocalStorage<{ spans: Partial<Record<Phase, number>>; facts: Record<string, string | number> }>()
export function noteConversationRead(key: 'cache-result' | 'owner-admission' | 'transport-admission', value: string): void {
  const context = timing.getStore()
  if (context) context.facts[key] = value
}
export function countConversationHttpAttempt(): void {
  const context = timing.getStore()
  if (context) context.facts.httpAttempts = Number(context.facts.httpAttempts ?? 0) + 1
}

export function bindConversationRead<T extends unknown[]>(work: (...args: T) => void): (...args: T) => void {
  const context = timing.getStore()
  return context ? (...args) => timing.run(context, () => work(...args)) : work
}

export function conversationReadTracing(): boolean { return timing.getStore() !== undefined }

export function recordConversationReadPhase(phase: Phase, millis: number): void {
  const spans = timing.getStore()?.spans
  if (spans) spans[phase] = (spans[phase] ?? 0) + Math.max(0, millis)
}

export async function measureConversationReadPhase<T>(phase: Phase, work: () => Promise<T>): Promise<T> {
  if (!conversationReadTracing()) return await work()
  const started = performance.now()
  try { return await work() }
  finally { recordConversationReadPhase(phase, performance.now() - started) }
}

const operations = new Set(['source.timeline', 'source.timeline-around', 'source.bot-senders.presentation', 'source.members.page', 'source.members.presentation', 'conversation.viewport.read'])
let nextId = 0
let windowStarted = 0
let emitted = 0

/** Opt-in, bounded owner timing. Never log params, cursors, credentials or error text. */
export async function measureConversationRead<T>(operation: string, work: () => Promise<T>, report?: (headers: string) => void, trace?: string): Promise<T> {
  if ((!trace && process.env.ARKME_CHAT_NOTIFICATION_DIAGNOSTICS !== '1') || !operations.has(operation)) return await work()
  const started = performance.now()
  const id = ++nextId
  const spans: Partial<Record<Phase, number>> = {}
  let ok = false
  let failure: unknown
  const facts: Record<string, string | number> = {}
  try { const result = await timing.run({ spans, facts }, work); ok = true; return result }
  catch (error) { failure = error; throw error }
  finally {
    report?.(Object.entries(spans).map(([phase, millis]) => `arkme-${phase};dur=${millis.toFixed(1)}`).join(', '))
    const now = Date.now()
    if (now - windowStarted >= 60_000 || now < windowStarted) { windowStarted = now; emitted = 0 }
    if (emitted < 120) {
      emitted++
      const code = failure !== null && typeof failure === 'object' && 'code' in failure ? failure.code : undefined
      console.info('dsh-arkme: conversation_read', { atMillis: now, id, operation,
        millis: Math.round(performance.now() - started), phases: spans, ok, ...(trace ? { trace, facts } : {}),
        ...(ok ? {} : { code: typeof code === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(code) ? code : 'read-failed' }),
      })
    }
  }
}
