import { AsyncLocalStorage } from 'node:async_hooks'
import { logReactionTiming, reactionTraceId } from './reaction-diagnostics.js'
import type { ReactionRequest } from './reaction-contract.js'
const context = new AsyncLocalStorage<string>()
// Queue execution can run under another request's timer; bind at admission.
export function bindReactionTrace<T>(work: (signal: AbortSignal) => Promise<T>): (signal: AbortSignal) => Promise<T> {
  return AsyncLocalStorage.bind(work)
}
export async function withReactionTrace<T>(input: ReactionRequest, work: () => Promise<T>): Promise<T> {
  if (process.env.ARKME_REACTION_DIAGNOSTICS !== '1') return await work()
  return await context.run(reactionTraceId(input.traceId), () => measureReaction('host-total', { action: input.action }, work))
}
export async function measureReaction<T>(stage: string, detail: Record<string, string | number | boolean>, work: () => Promise<T>): Promise<T> {
  const traceId = context.getStore()
  if (!traceId) return await work()
  const started = performance.now()
  let ok = false
  try { const result = await work(); ok = true; return result }
  finally { logReactionTiming(traceId, stage, started, { ...detail, ok }) }
}

// Capture the trace before another request's release/timer admits this request.
export function reactionQueueObserver(route: string): import('./request-coordinator.js').ArkmeCoordinatedRequest<unknown>['onQueue'] {
  const traceId = context.getStore()
  if (!traceId) return undefined
  const started = performance.now()
  return (event, detail) => logReactionTiming(traceId, `queue-${event}`, started, { route, ...detail })
}
