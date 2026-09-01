import { DshRemoteError } from './errors.js'
import type { DshRemoteNodePresentation } from './types.js'

export type DshRemoteJsonValue =
  | null
  | boolean
  | number
  | string
  | DshRemoteJsonValue[]
  | { [key: string]: DshRemoteJsonValue }

export interface DshRemoteSessionEvent {
  type: string
  seq: number
  time: number
  data: DshRemoteJsonValue
  sourceEventSeqs?: number[]
  surfaceOp?: DshRemoteJsonValue
  ignorable?: true
}

export interface DshRemoteToolEventView {
  for: 'call' | 'result'
  view: { [key: string]: DshRemoteJsonValue }
}

/** The public DSH replay unit used by both sessions.history and events.mux. */
export interface DshRemoteHistoryEntry {
  event: DshRemoteSessionEvent
  view?: DshRemoteToolEventView
  /** Realtime/read projection only. Backend canonical event storage strips it. */
  presentation?: DshRemoteNodePresentation
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'DSH HistoryEntry 结构无效', true)
  }
  return value as Record<string, unknown>
}

function jsonSnapshot(value: unknown, field: string): DshRemoteJsonValue {
  try {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new TypeError(`${field} is not JSON`)
    return JSON.parse(encoded) as DshRemoteJsonValue
  } catch (error) {
    throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', `DSH ${field} 不是有效 JSON`, true, {}, { cause: error })
  }
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', `DSH ${field} 无效`, true)
  }
  return value
}

export function snapshotDshHistoryEntry(value: {
  event: unknown
  view?: unknown
}): DshRemoteHistoryEntry {
  const source = record(value.event)
  if (typeof source.type !== 'string' || source.type.length === 0
    || !Number.isSafeInteger(source.seq) || Number(source.seq) < 0) {
    throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'DSH SessionEvent 信封无效', true)
  }
  const event: DshRemoteSessionEvent = {
    type: source.type,
    seq: Number(source.seq),
    time: finiteNumber(source.time, 'SessionEvent.time'),
    data: jsonSnapshot(source.data, 'SessionEvent.data'),
  }
  if (source.sourceEventSeqs !== undefined) {
    if (!Array.isArray(source.sourceEventSeqs)
      || source.sourceEventSeqs.some(seq => !Number.isSafeInteger(seq) || Number(seq) < 0)) {
      throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'DSH sourceEventSeqs 无效', true)
    }
    event.sourceEventSeqs = [...source.sourceEventSeqs]
  }
  if (source.surfaceOp !== undefined) event.surfaceOp = jsonSnapshot(source.surfaceOp, 'SessionEvent.surfaceOp')
  if (source.ignorable !== undefined) {
    if (source.ignorable !== true) throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'DSH ignorable 无效', true)
    event.ignorable = true
  }
  if (value.view === undefined) return { event }
  const viewSource = record(value.view)
  if ((viewSource.for !== 'call' && viewSource.for !== 'result')
    || viewSource.view === null || typeof viewSource.view !== 'object' || Array.isArray(viewSource.view)) {
    throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'DSH ToolEventView 无效', true)
  }
  return {
    event,
    view: {
      for: viewSource.for,
      view: jsonSnapshot(viewSource.view, 'ToolEventView.view') as { [key: string]: DshRemoteJsonValue },
    },
  }
}

export function dshHistoryEntryUserRpcId(entry: DshRemoteHistoryEntry): string | undefined {
  if (entry.event.type !== 'user/message' || entry.event.data === null
    || typeof entry.event.data !== 'object' || Array.isArray(entry.event.data)) return undefined
  const data = entry.event.data
  const message = data.message !== null && typeof data.message === 'object' && !Array.isArray(data.message)
    ? data.message : undefined
  const source = data.source !== null && typeof data.source === 'object' && !Array.isArray(data.source)
    ? data.source
    : message?.source !== null && typeof message?.source === 'object' && !Array.isArray(message.source)
      ? message.source : undefined
  return typeof source?.rpcId === 'string' ? source.rpcId : undefined
}
