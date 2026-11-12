export function groupInteractionTraceEnabled(): boolean {
  if (typeof window === 'undefined') return typeof process !== 'undefined' && process.env.ARKME_GROUP_INTERACTION_TRACE === '1'
  try { return window.localStorage.getItem('arkme-group-interaction-trace') === '1' } catch { return false }
}

/** Run-local correlation labels only. Never print the underlying refs or message text. */
export function groupInteractionTraceKey(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(16)
}

export function groupInteractionTrace(stage: string, fields: Record<string, string | number | boolean | undefined> = {}): void {
  if (groupInteractionTraceEnabled()) console.info('[arkme-group-interaction] ' + JSON.stringify({ at: Date.now(), stage, ...fields }))
}


export const directoryTraceHeader = 'x-arkme-directory-trace'
export const directoryTraceSignals = new WeakMap<AbortSignal, string>()

export function isDirectoryTraceId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)
}
