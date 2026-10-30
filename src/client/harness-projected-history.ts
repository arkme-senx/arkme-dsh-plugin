import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import type { ChatNode, ChatSnapshot, ChatNodeSource, AssistantBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { DshRemoteTimelineNode } from '../dsh-remote/types.js'
import type { DshAccountSessionHistory, DshSessionHistoryCursor } from '../dsh-remote/account-session-types.js'

/** Presentation only: source sequence numbers are preserved, never replayed as a journal. */
export function projectedHistoryNode(item: DshRemoteTimelineNode): ChatNode {
  const data = item.data ?? {}, message = data.message as { content?: unknown } | undefined
  const raw = item.kind === 'user' || item.kind === 'context' || item.kind === 'steering' ? data.content : data.blocks ?? message?.content
  const blocks = Array.isArray(raw) ? raw : []
  const fallback = item.presentation.details || item.presentation.summary || item.presentation.title || ''
  const base = { key: item.node_ref, id: item.node_ref, target: 'chat' as const, anchorSeq: item.anchor_seq,
    location: { kind: 'unresolved' as const }, visibility: 'visible' as const }
  if (item.kind === 'user' || item.kind === 'steering') return { ...base, kind: 'user', groupTree: 'input', data: {
    kind: 'user', seq: item.anchor_seq, time: item.time, source: undefined,
    content: blocks.length ? blocks : [{ type: 'text', text: fallback }],
  } }
  if (item.kind === 'assistant') {
    const text = blocks.flatMap<AssistantBlock>(block => {
      const kind = block?.kind ?? block?.type
      if (kind === 'image' && block.attachment) return [{ kind: 'image', attachment: block.attachment }]
      return (kind === 'text' || kind === 'reasoning') && typeof block.text === 'string' ? [{ kind, text: block.text }] : []
    })
    return { ...base, kind: 'assistant-step', data: { status: data.status === 'interrupted' ? 'interrupted' : 'settled', turn: Number(data.turn) || 0, step: Number(data.step) || 0, time: item.time,
      blocks: text.length ? text : [{ kind: 'text', text: fallback }] } }
  }
  if (item.kind === 'context') {
    const source = record(data.source)
    return { ...base, kind: 'context', data: { kind: 'context', seq: item.anchor_seq, time: item.time,
      content: blocks, source: data.source, producer: { role: source.kind === 'recall' ? 'recall' : 'inject',
        label: typeof source.plugin === 'string' ? source.plugin : typeof source.kind === 'string' ? source.kind : null }, form: null } }
  }
  if (item.kind === 'tool') {
    const call = record(data.call), result = record(data.result), message = record(result.message), source = record(message.source)
    const argsRaw = typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {})
    const args = data.call ? PartialArguments.fromText(argsRaw) : PartialArguments.EMPTY
    const callId = String(call.callId ?? source.callId ?? result.callId ?? item.node_ref)
    const name = typeof call.name === 'string' ? call.name : ''
    if (data.result) return { ...base, kind: 'tool-call', data: { root: { kind: 'tool-result',
      seq: item.anchor_seq, time: item.time, callId, name, args,
      call: data.call ? { name, argsRaw } : null, callTime: null,
      content: Array.isArray(message.content) ? message.content : Array.isArray(result.content) ? result.content : [{ type: 'text', text: fallback }],
      isError: message.isError === true || data.status === 'failed', subCalls: [],
    } } }
    return { ...base, kind: 'tool-call', data: { root: { phase: 'start', callId, name, args, argsRaw,
      turn: Number(call.turn) || 0, step: Number(call.step) || 0, time: item.time, subCalls: [] } } }
  }
  return { ...base, kind: 'unknown', data: { kind: 'unknown', seq: item.anchor_seq, time: item.time,
    type: item.presentation.title || item.kind, data: fallback } }
}

const record = (value: unknown): Record<string, any> => typeof value === 'object' && value !== null ? value as Record<string, any> : {}

const constant = <T>(value: T) => ({ getSnapshot: () => value, subscribe: (_listener: () => void) => () => {} })
const absent = constant(undefined), notBottom = constant(false), emptyData = constant([])
type Reader = (cursor: DshSessionHistoryCursor | undefined, signal: AbortSignal) => Promise<DshAccountSessionHistory>
export interface ProjectedHistorySnapshot {
  chat: ChatSnapshot
  openState: 'loading' | 'open' | 'error'
  openError: { code: string; message: string; details: Record<string, never> } | null
  hasMore: boolean
  loadingOlder: boolean
}

/** One mounted remote view owns one bounded, cancellable projection window. */
export function createProjectedHistory(read: Reader) {
  const listeners = new Set<() => void>(), nodes = new Map<string, ChatNode>(), sources = new Map<string, ChatNodeSource>()
  const rows = new Map<string, DshRemoteTimelineNode>()
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  const store: ChatSnapshot['nodes'] = {
    get: key => nodes.get(key),
    source(key) {
      if (!nodes.has(key)) return absent
      let value = sources.get(key)
      if (!value) { value = { getSnapshot: () => nodes.get(key), subscribe }; sources.set(key, value) }
      return value
    },
    bottomSource: () => notBottom, processSource: () => absent,
    turnDataSource: () => emptyData, values: () => [...nodes.values()],
  }
  let state: ProjectedHistorySnapshot = { openState: 'loading', openError: null, hasMore: false, loadingOlder: false,
    chat: { order: [], nodes: store, locations: { getTurn: () => [], getStep: () => [] }, navigation: { items: () => [] },
      timeline: { turnOrder: [], turns: new Map() },
      legacy: { nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [] } } }
  let cursor: DshSessionHistoryCursor | undefined, request: AbortController | undefined, disposed = false, loaded = false
  const publish = (patch: Partial<ProjectedHistorySnapshot>) => { state = { ...state, ...patch }; for (const listener of listeners) listener() }
  const load = async () => {
    if (disposed || request || (loaded && !cursor)) return
    const controller = new AbortController(); request = controller
    const timer = setTimeout(() => controller.abort(new Error('历史加载超时，请重试')), 20_000)
    publish({ loadingOlder: loaded, openError: null, ...(!loaded ? { openState: 'loading' as const } : {}) })
    try {
      const page = await read(cursor, controller.signal)
      if (disposed) return
      controller.signal.throwIfAborted()
      if (page.nextCursor && JSON.stringify(page.nextCursor) === JSON.stringify(cursor)) throw new Error('历史分页未前进，请重试')
      const next = new Map(rows)
      for (const item of page.nodes) next.set(item.node_ref, item)
      // No unbounded transcript cache. An exceeded window keeps the last good page and reports failure.
      if (next.size > 5000 || JSON.stringify([...next.values()]).length * 2 > 16 * 1024 * 1024) throw new Error('本次历史查看已达到容量上限，请重新打开会话')
      const ordered = [...next.values()].sort((a, b) => a.anchor_seq - b.anchor_seq || a.ordinal - b.ordinal)
      rows.clear(); for (const item of ordered) { rows.set(item.node_ref, item); nodes.set(item.node_ref, projectedHistoryNode(item)) }
      cursor = page.nextCursor; loaded = true
      publish({ chat: { ...state.chat, order: ordered.map(item => item.node_ref) }, openState: 'open', hasMore: !!cursor })
    } catch (error) {
      if (!disposed) publish({ openState: 'error', openError: { code: 'HISTORY_UNAVAILABLE',
        message: error instanceof Error ? error.message : '历史加载失败，请重试', details: {} } })
    } finally { clearTimeout(timer); if (request === controller) request = undefined; if (!disposed) publish({ loadingOlder: false }) }
  }
  return { subscribe, getSnapshot: () => state, load,
    dispose() { disposed = true; request?.abort(); listeners.clear(); sources.clear(); rows.clear() } }
}
