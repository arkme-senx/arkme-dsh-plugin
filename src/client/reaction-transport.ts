import { callArkme } from './api.js'
import { supportsBackgroundRead } from './background-read.js'
import type { ReactionRequest } from '../reaction-contract.js'
import { logReactionTiming, reactionTraceId } from '../reaction-diagnostics.js'
const timings = new WeakMap<object, { traceId: string; started: number }>()
export function traceReactionApplied(value: object, stage: string): void {
  const timing = timings.get(value)
  if (timing) logReactionTiming(timing.traceId, stage, timing.started)
}
export async function callReaction(input: ReactionRequest, signal?: AbortSignal): Promise<unknown> {
  const background = supportsBackgroundRead('reactions', input)
  const request = (value: ReactionRequest) => background
    ? callArkme('reactions', value, signal, { priority: 'background' })
    : callArkme('reactions', value, signal)
  let diagnostics = false
  try { diagnostics = globalThis.sessionStorage?.getItem('arkme.reaction.diagnostics') === '1' } catch { /* Storage can be unavailable. */ }
  if (!diagnostics) return await request(input)
  const traceId = reactionTraceId(input.traceId), started = performance.now()
  let ok = false
  try { const value = await request({ ...input, traceId }); ok = true; if (diagnostics && value && typeof value === 'object') timings.set(value, { traceId, started }); return value }
  finally { if (diagnostics) logReactionTiming(traceId, 'browser-request', started, { action: input.action, ok }) }
}
