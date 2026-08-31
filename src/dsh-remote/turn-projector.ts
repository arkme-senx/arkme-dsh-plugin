import type {
  DshRemoteHistoryEntry,
} from './dsh-event-contract.js'
import type {
  DshRemoteTimelineNode,
  DshRemoteTimelineNodeKind,
  DshRemoteTurnProjection,
} from './types.js'

const MAX_TURN_PROJECTION_BYTES = 4 * 1024 * 1024

interface MutableNode {
  ref: string
  kind: DshRemoteTimelineNodeKind
  anchorSeq: number
  time: number
  data: Record<string, unknown>
  sourceSeqs: number[]
}

export interface DshRemoteTurnProjectionResult {
  turns: DshRemoteTurnProjection[]
  /** A completed Turn is never truncated. Raw HistoryEntry remains authoritative. */
  oversizedTurnRefs: string[]
  /** A retained window ending a Turn without its start cannot be projected safely. */
  unmatchedTurnEndSeqs: number[]
}

export interface DshCompletedTurnWindows {
  completed: DshRemoteHistoryEntry[][]
  pending: DshRemoteHistoryEntry[]
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isAppendSurface(entry: DshRemoteHistoryEntry): boolean {
  return entry.event.surfaceOp === 'append'
}

function isReplacementSurface(entry: DshRemoteHistoryEntry): boolean {
  const operation = record(entry.event.surfaceOp)
  return operation.op === 'replace'
    && Number.isSafeInteger(operation.start) && Number(operation.start) >= 0
    && Number.isSafeInteger(operation.end) && Number(operation.end) >= 0
}

function isCompactionCheckpoint(entry: DshRemoteHistoryEntry): boolean {
  if (entry.event.type !== 'user/message' || !isReplacementSurface(entry)) return false
  const source = record(record(entry.event.data).source)
  return source.kind === 'plugin' && source.plugin === 'compact'
}

function stepKey(data: Record<string, unknown>, fallback: number): string {
  return `${String(data.turn ?? 'unknown')}:${String(data.step ?? fallback)}`
}

function applyAssistantChunk(blocks: Array<Record<string, unknown>>, chunk: Record<string, unknown>): void {
  const index = typeof chunk.index === 'number' && Number.isInteger(chunk.index) ? chunk.index : -1
  if (index < 0) return
  while (blocks.length <= index) blocks.push({})
  const previous = blocks[index] ?? {}
  switch (chunk.type) {
    case 'block-start':
      blocks[index] = { type: chunk.blockType ?? 'unknown' }
      break
    case 'text-delta':
      blocks[index] = { type: 'text', text: `${String(previous.text ?? '')}${String(chunk.text ?? '')}` }
      break
    case 'reasoning-delta':
      blocks[index] = { type: 'reasoning', text: `${String(previous.text ?? '')}${String(chunk.text ?? '')}` }
      break
    case 'tool-call-delta':
      blocks[index] = {
        type: 'tool-call',
        id: previous.id ?? chunk.id,
        name: chunk.name ?? previous.name,
        arguments: `${String(previous.arguments ?? '')}${String(chunk.argumentsDelta ?? '')}`,
      }
      break
    case 'block-end':
      blocks[index] = record(chunk.block)
      break
  }
}

function visibleAssistantContent(blocks: Array<Record<string, unknown>>): boolean {
  return blocks.some(block => block.type !== 'tool-call' && String(block.text ?? '').trim() !== '')
}

function upsert(nodes: Map<string, MutableNode>, value: MutableNode): void {
  nodes.set(value.ref, value)
}

function foldLifecycle(
  nodes: Map<string, MutableNode>,
  entry: DshRemoteHistoryEntry,
  ref: string,
  kind: DshRemoteTimelineNodeKind,
): void {
  const previous = nodes.get(ref)
  upsert(nodes, {
    ref,
    kind,
    anchorSeq: previous?.anchorSeq ?? entry.event.seq,
    time: previous?.time ?? entry.event.time,
    data: {
      ...previous?.data,
      events: [...list(previous?.data.events), entry.event],
    },
    sourceSeqs: [...(previous?.sourceSeqs ?? []), entry.event.seq],
  })
}

function turnStatus(entry: DshRemoteHistoryEntry): DshRemoteTurnProjection['status'] {
  const rawReason = record(entry.event.data).reason
  const reason = typeof rawReason === 'string' ? rawReason : String(record(rawReason).kind ?? '')
  if (reason === 'error') return 'error'
  if (reason === 'max-tokens' || reason === 'max_tokens') return 'max_tokens'
  if (['interrupted', 'cancelled', 'canceled', 'aborted'].includes(reason)) return 'interrupted'
  return 'completed'
}

function projectNodes(entries: DshRemoteHistoryEntry[]): DshRemoteTimelineNode[] {
  const nodes = new Map<string, MutableNode>()
  const assistantBlocks = new Map<string, Array<Record<string, unknown>>>()
  for (const entry of entries) {
    const event = entry.event
    const data = record(event.data)
    switch (event.type) {
      case 'user/message': {
        if (isCompactionCheckpoint(entry)) {
          const source = record(data.source)
          const ref = `compaction:${String(source.compactionId ?? event.seq)}`
          const previous = nodes.get(ref)
          upsert(nodes, {
            ref,
            kind: 'compaction',
            anchorSeq: event.seq,
            time: event.time,
            data: { ...previous?.data, checkpoint: data },
            sourceSeqs: [...(previous?.sourceSeqs ?? []), event.seq],
          })
          break
        }
        if (!isAppendSurface(entry)) break
        const sourceKind = String(record(data.source).kind ?? '')
        const ref = `message:${String(data.id ?? event.seq)}`
        upsert(nodes, {
          ref,
          kind: sourceKind === 'user' ? 'user' : 'context',
          anchorSeq: event.seq,
          time: event.time,
          data,
          sourceSeqs: [event.seq],
        })
        break
      }
      case 'assistant/chunk': {
        const key = stepKey(data, event.seq)
        const blocks = assistantBlocks.get(key) ?? []
        assistantBlocks.set(key, blocks)
        applyAssistantChunk(blocks, record(data.chunk))
        if (!visibleAssistantContent(blocks)) break
        const ref = `assistant:${key}`
        const previous = nodes.get(ref)
        upsert(nodes, {
          ref,
          kind: 'assistant',
          anchorSeq: previous?.anchorSeq ?? event.seq,
          time: previous?.time ?? event.time,
          data: {
            status: 'running',
            turn: data.turn,
            step: data.step,
            blocks: blocks.map(block => ({ ...block })),
          },
          sourceSeqs: [...(previous?.sourceSeqs ?? []), event.seq],
        })
        break
      }
      case 'assistant/message': {
        if (!isAppendSurface(entry)) break
        const key = stepKey(data, event.seq)
        const message = record(data.message)
        const content = list(message.content ?? data.content).map(record)
        assistantBlocks.set(key, content)
        const ref = `assistant:${key}`
        const previous = nodes.get(ref)
        upsert(nodes, {
          ref,
          kind: 'assistant',
          anchorSeq: event.seq,
          time: event.time,
          data: {
            status: data.interrupted === true ? 'interrupted' : 'settled',
            turn: data.turn,
            step: data.step,
            message,
            blocks: content,
            ...(Object.hasOwn(data, 'usage') ? { usage: data.usage } : {}),
          },
          sourceSeqs: [...(previous?.sourceSeqs ?? []), event.seq],
        })
        break
      }
      case 'llm/retry': {
        const key = stepKey(data, event.seq)
        assistantBlocks.delete(key)
        nodes.delete(`assistant:${key}`)
        foldLifecycle(nodes, entry, `retry:${String(data.retryId ?? event.seq)}`, 'retry')
        break
      }
      case 'llm/retry-started':
        foldLifecycle(nodes, entry, `retry:${String(data.retryId ?? event.seq)}`, 'retry')
        break
      case 'tool/call': {
        const ref = `tool:${String(data.callId ?? event.seq)}`
        upsert(nodes, {
          ref,
          kind: 'tool',
          anchorSeq: event.seq,
          time: event.time,
          data: {
            status: 'running',
            call: data,
            ...(entry.view?.for === 'call' ? { callView: entry.view.view } : {}),
          },
          sourceSeqs: [event.seq],
        })
        break
      }
      case 'tool/result': {
        if (!isAppendSurface(entry)) break
        const message = record(data.message)
        const resultSource = record(message.source)
        const ref = `tool:${String(resultSource.callId ?? data.callId ?? event.seq)}`
        const previous = nodes.get(ref)
        upsert(nodes, {
          ref,
          kind: 'tool',
          anchorSeq: previous?.anchorSeq ?? event.seq,
          time: previous?.time ?? event.time,
          data: {
            status: data.error === null || data.error === undefined ? 'completed' : 'failed',
            ...(previous?.data.call !== undefined ? { call: previous.data.call } : {}),
            result: data,
            ...(previous?.data.callView !== undefined ? { callView: previous.data.callView } : {}),
            ...(entry.view?.for === 'result' ? { resultView: entry.view.view } : {}),
          },
          sourceSeqs: [...(previous?.sourceSeqs ?? []), event.seq],
        })
        break
      }
      case 'tool/code-dispatch-start':
      case 'tool/code-dispatch': {
        const root = String(data.rootCallId ?? '')
        const previous = nodes.get(`tool:${root}`)
        if (root !== '' && previous !== undefined) {
          upsert(nodes, {
            ...previous,
            data: { ...previous.data, dispatches: [...list(previous.data.dispatches), data] },
            sourceSeqs: [...previous.sourceSeqs, event.seq],
          })
        }
        break
      }
      case 'command/run':
      case 'command/done':
        foldLifecycle(nodes, entry, `command:${String(data.commandId ?? event.seq)}`, 'command')
        break
      case 'compaction/start':
      case 'compaction/summary':
      case 'compaction/end':
        foldLifecycle(nodes, entry, `compaction:${String(data.compactionId ?? event.seq)}`, 'compaction')
        break
      case 'turn/end': {
        const reason = record(data.reason)
        const turn = String(data.turn ?? event.seq)
        if (reason.kind === 'error') {
          upsert(nodes, {
            ref: `turn-error:${turn}`,
            kind: 'turn_error',
            anchorSeq: event.seq,
            time: event.time,
            data: reason,
            sourceSeqs: [event.seq],
          })
        } else if (reason.kind === 'max-tokens') {
          upsert(nodes, {
            ref: `max-tokens:${turn}`,
            kind: 'max_tokens',
            anchorSeq: event.seq + 0.05,
            time: event.time,
            data: reason,
            sourceSeqs: [event.seq],
          })
        }
        break
      }
      case 'turn/start':
      case 'step/start':
      case 'step/end':
        break
      default:
        if (isAppendSurface(entry)) {
          upsert(nodes, {
            ref: `unknown:${event.seq}`,
            kind: 'unknown',
            anchorSeq: event.seq,
            time: event.time,
            data: {
              type: event.type,
              data: event.data,
              ...(entry.view === undefined ? {} : { view: entry.view }),
            },
            sourceSeqs: [event.seq],
          })
        }
    }
  }
  return [...nodes.values()]
    .sort((left, right) => left.anchorSeq - right.anchorSeq || left.ref.localeCompare(right.ref))
    .map((node, ordinal): DshRemoteTimelineNode => ({
      node_ref: node.ref,
      kind: node.kind,
      ordinal,
      anchor_seq: node.anchorSeq,
      time: node.time,
      source_seq_start: Math.min(...node.sourceSeqs),
      source_seq_end: Math.max(...node.sourceSeqs),
      data: node.data,
    }))
}

/**
 * Projects only explicit, stable turn/start ... turn/end intervals. Any active
 * tail stays in raw Realtime/HistoryEntry form and is deliberately excluded.
 */
export function projectCompletedTurns(source: Iterable<DshRemoteHistoryEntry>): DshRemoteTurnProjectionResult {
  const entries = [...source].sort((left, right) => left.event.seq - right.event.seq)
  const turns: DshRemoteTurnProjection[] = []
  const oversizedTurnRefs: string[] = []
  const unmatchedTurnEndSeqs: number[] = []
  let active: DshRemoteHistoryEntry[] | undefined
  for (const entry of entries) {
    if (entry.event.type === 'turn/start') active = [entry]
    else if (active !== undefined) active.push(entry)
    if (entry.event.type !== 'turn/end') continue
    if (active === undefined) {
      unmatchedTurnEndSeqs.push(entry.event.seq)
      continue
    }
    const startSeq = active[0]!.event.seq
    const endSeq = entry.event.seq
    const projection: DshRemoteTurnProjection = {
      // SessionRef is part of Backend's collection key; the canonical DSH seq
      // interval is therefore sufficient and avoids trusting an unbounded
      // version-specific turn label as an external resource ref.
      turn_ref: `turn:${startSeq}:${endSeq}`,
      start_seq: startSeq,
      end_seq: endSeq,
      status: turnStatus(entry),
      nodes: projectNodes(active),
    }
    if (Buffer.byteLength(JSON.stringify(projection)) > MAX_TURN_PROJECTION_BYTES) {
      oversizedTurnRefs.push(projection.turn_ref)
    } else {
      turns.push(projection)
    }
    active = undefined
  }
  return { turns, oversizedTurnRefs, unmatchedTurnEndSeqs }
}

/**
 * Extracts explicit complete intervals while retaining only page-boundary
 * fragments. Pages may be supplied newest-first by prepending them to
 * [pending]; complete historical sessions therefore do not need to be held in
 * memory during Host reconciliation.
 */
export function extractCompletedTurnWindows(
  source: Iterable<DshRemoteHistoryEntry>,
): DshCompletedTurnWindows {
  const bySeq = new Map<number, DshRemoteHistoryEntry>()
  for (const entry of source) bySeq.set(entry.event.seq, entry)
  const entries = [...bySeq.values()].sort((left, right) => left.event.seq - right.event.seq)
  const consumed = new Set<number>()
  const completed: DshRemoteHistoryEntry[][] = []
  let activeStart = -1
  for (let index = 0; index < entries.length; index += 1) {
    const type = entries[index]!.event.type
    if (type === 'turn/start') activeStart = index
    if (type !== 'turn/end' || activeStart < 0) continue
    const window = entries.slice(activeStart, index + 1)
    completed.push(window)
    for (const entry of window) consumed.add(entry.event.seq)
    activeStart = -1
  }
  // A start with no later end is the active newest Turn. Older pages cannot
  // complete it, so it must not accumulate during full-history traversal.
  if (activeStart >= 0) {
    for (let index = activeStart; index < entries.length; index += 1) {
      consumed.add(entries[index]!.event.seq)
    }
  }
  return {
    completed,
    pending: entries.filter(entry => !consumed.has(entry.event.seq)),
  }
}
