import { callArkme } from './api.js'
import type { ReactionRequest } from '../reaction-contract.js'
import { logReactionTiming, reactionTraceId } from '../reaction-diagnostics.js'
const timings = new WeakMap<object, { traceId: string; started: number }>()
export function traceReactionApplied(value: object, stage: string): void {
  const timing = timings.get(value)
  if (timing) logReactionTiming(timing.traceId, stage, timing.started)
}
export async function callReaction(input: ReactionRequest, signal?: AbortSignal): Promise<unknown> {
  let diagnostics = false
  try { diagnostics = globalThis.sessionStorage?.getItem('arkme.reaction.diagnostics') === '1' } catch { /* Storage can be unavailable. */ }
  if (!diagnostics) return await callArkme('reactions', input, signal)
  const traceId = reactionTraceId(input.traceId), started = performance.now()
  let ok = false
  try { const value = await callArkme('reactions', { ...input, traceId }, signal); ok = true; if (diagnostics && value && typeof value === 'object') timings.set(value, { traceId, started }); return value }
  finally { if (diagnostics) logReactionTiming(traceId, 'browser-request', started, { action: input.action, ok }) }
}
