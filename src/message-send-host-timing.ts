import { AsyncLocalStorage } from 'node:async_hooks'
import { messageSendPoint, messageSendTimingEnabled } from './message-send-timing.js'

const context = new AsyncLocalStorage<string>()
export function currentMessageSend(): string | undefined { return messageSendTimingEnabled ? context.getStore() : undefined }
export function bindMessageSend<T extends unknown[], R>(work: (...args: T) => R): (...args: T) => R {
  const recordUid = currentMessageSend()
  return recordUid ? (...args) => context.run(recordUid, () => work(...args)) : work
}
export async function measureMessageSend<T>(recordUid: string | undefined, stage: string, work: () => Promise<T>, state?: string): Promise<T> {
  if (!messageSendTimingEnabled || !recordUid) return await work()
  const started = performance.now()
  let ok = false
  messageSendPoint('host', recordUid, stage + '-start', { state })
  try { const result = await context.run(recordUid, work); ok = true; return result }
  finally { messageSendPoint('host', recordUid, stage + '-end', { durationMs: performance.now() - started, state, ok }) }
}
