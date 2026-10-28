/** Timing metadata only: no credentials, message refs, names or message bodies. */
export function reactionTraceId(value?: string): string {
  return value && /^[a-f0-9-]{36}$/.test(value) ? value : globalThis.crypto.randomUUID()
}
export function logReactionTiming(traceId: string, stage: string, started: number, detail: Record<string, string | number | boolean> = {}): void {
  console.info(`[ArkmeReactionTiming] ${JSON.stringify({ traceId, stage, at: Date.now(), durationMs: Math.round((performance.now() - started) * 100) / 100, ...detail })}`)
}
