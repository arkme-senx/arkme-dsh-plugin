declare const __ARKME_LOCAL_SEND_TIMING__: boolean
export const messageSendTimingEnabled = typeof __ARKME_LOCAL_SEND_TIMING__ !== 'undefined' && __ARKME_LOCAL_SEND_TIMING__
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const operations = new Set(['source.send-text', 'source.send-rich', 'files.send'])
let emitted = 0
type Fields = { durationMs?: number | undefined; elapsedMs?: number | undefined; startedAtMillis?: number | undefined; status?: number | undefined; code?: number | undefined;
  queueMs?: number | undefined; operation?: string | undefined; route?: string | undefined; state?: string | undefined; requestId?: string | undefined; lane?: string | undefined;
  event?: string | undefined; sourceKind?: string | undefined; loading?: boolean | undefined; ok?: boolean | undefined }
const numberKeys = new Set(['durationMs', 'elapsedMs', 'startedAtMillis', 'status', 'code', 'queueMs'])
const stringKeys = new Set(['operation', 'route', 'state', 'requestId', 'lane', 'event', 'sourceKind'])

export function messageSendRecord(operation: string, params?: Record<string, unknown>): string | undefined {
  return messageSendTimingEnabled && operations.has(operation) && typeof params?.recordUid === 'string' && uuid.test(params.recordUid)
    ? params.recordUid : undefined
}

/** Local diagnostic build only: bounded metadata, never params, body, refs or error text. */
export function messageSendPoint(realm: 'ui' | 'browser' | 'host', recordUid: string | undefined, stage: string, fields: Fields = {}): void {
  if (!messageSendTimingEnabled || !recordUid || !uuid.test(recordUid) || emitted >= 1200
    || !/^[a-z-]{1,48}$/.test(stage)) return
  const safe: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (numberKeys.has(key) && typeof value === 'number' && Number.isFinite(value)) safe[key] = Math.round(value * 10) / 10
    else if (stringKeys.has(key) && typeof value === 'string' && /^[a-zA-Z0-9/._:-]{1,128}$/.test(value)) safe[key] = value
    else if ((key === 'loading' || key === 'ok') && typeof value === 'boolean') safe[key] = value
  }
  try { console.info('[arkme-send-timing] ' + JSON.stringify({ atMillis: Date.now(), sequence: ++emitted, realm, recordUid, stage, ...safe })) }
  catch { /* Diagnostics must not change the send outcome. */ }
}

const clientSends = new Map<string, { started: number; elapsed: number }>()
export function beginClientSendTiming(recordUid: string, startedAtMillis: number, sourceKind: string): void {
  if (!messageSendTimingEnabled || !uuid.test(recordUid)) return
  if (clientSends.size >= 16) clientSends.delete(clientSends.keys().next().value!)
  clientSends.set(recordUid, { started: performance.now(), elapsed: Math.max(0, Date.now() - startedAtMillis) })
  messageSendPoint('ui', recordUid, 'draft-ready', { startedAtMillis, sourceKind, elapsedMs: Date.now() - startedAtMillis })
}
export function clientSendTimingPoint(recordUid: string, stage: string): void {
  const sample = messageSendTimingEnabled ? clientSends.get(recordUid) : undefined
  if (sample) messageSendPoint('ui', recordUid, stage, { elapsedMs: sample.elapsed + performance.now() - sample.started })
}
export function observeClientSendPaint(recordUid: string, loading: boolean, element: HTMLElement | null): () => void {
  const sample = messageSendTimingEnabled ? clientSends.get(recordUid) : undefined
  if (!sample || !element) return () => {}
  if (performance.now() - sample.started > 10 * 60_000) { clientSends.delete(recordUid); return () => {} }
  clientSendTimingPoint(recordUid, loading ? 'loading-committed' : 'receipt-committed')
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      if (!element.isConnected || document.visibilityState === 'hidden') return
      clientSendTimingPoint(recordUid, loading ? 'loading-visible' : 'loading-finished')
      if (!loading) clientSends.delete(recordUid)
    })
  })
  return () => cancelAnimationFrame(frame)
}
