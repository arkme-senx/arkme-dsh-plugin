import type { DshRemoteHistoryEntry } from './dsh-event-contract.js'
import type {
  DshRemoteNodePresentation,
  DshRemoteTimelineNodeKind,
} from './types.js'

export const DSH_REMOTE_PRESENTATION_VERSION = 1 as const

const MAX_PRESENTATION_DETAILS = 64 * 1024
const MAX_OPEN_CALL_SESSIONS = 128
const MAX_OPEN_CALLS_PER_SESSION = 512

interface OpenCall {
  data: Record<string, unknown>
  view?: Record<string, unknown>
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function firstLine(value: unknown): string {
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  const newline = normalized.indexOf('\n')
  return (newline < 0 ? normalized : normalized.slice(0, newline)).slice(0, 2048)
}

function boundedDetails(value: string): string {
  return value.length <= MAX_PRESENTATION_DETAILS
    ? value
    : `${value.slice(0, MAX_PRESENTATION_DETAILS)}\n…`
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value === '') return {}
  try {
    return record(JSON.parse(value))
  } catch {
    return {}
  }
}

function contentText(value: unknown): string {
  const parts: string[] = []
  const collect = (candidate: unknown): void => {
    for (const raw of list(candidate)) {
      const block = record(raw)
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
        parts.push(block.text.trimEnd())
      } else if (block.type === 'tool-result') {
        collect(block.content)
      }
    }
  }
  collect(value)
  return parts.join('\n')
}

function resultText(result: Record<string, unknown>): string {
  const message = record(result.message)
  return contentText(message.content ?? result.content)
}

function safeArgumentSummary(name: string, args: Record<string, unknown>): string {
  const keys = name === 'arkme_sources_list'
    ? ['directory']
    : ['description', 'query', 'pattern', 'path', 'file_path', 'url']
  for (const key of keys) {
    const value = firstLine(args[key])
    if (value !== '') return value
  }
  return ''
}

function contextPresentation(data: Record<string, unknown>): DshRemoteNodePresentation {
  const source = record(data.source)
  const owner = firstLine(source.plugin) || firstLine(source.kind) || 'Context'
  const sourceSummary = firstLine(source.summary)
  return {
    version: DSH_REMOTE_PRESENTATION_VERSION,
    format: 'summary',
    icon: 'context',
    title: '上下文注入',
    summary: sourceSummary === '' ? owner : `${owner} · ${sourceSummary}`,
    tone: 'muted',
  }
}

function toolPresentation(data: Record<string, unknown>): DshRemoteNodePresentation {
  const call = record(data.call)
  const callView = record(data.callView)
  const resultView = record(data.resultView)
  const result = record(data.result)
  const name = firstLine(call.name)
  const normalizedName = name.toLowerCase()
  const args = parseArguments(call.arguments)
  const failed = data.status === 'failed'
  const card = firstLine(resultView.card) || firstLine(callView.card)
  const title = (() => {
    if (normalizedName === 'web_search') return 'Search'
    if (normalizedName === 'web_fetch') return 'Fetch'
    if (normalizedName === 'bash') return 'Bash'
    if (normalizedName === 'pwsh') return 'Pwsh'
    if (normalizedName === 'read') return 'Read'
    if (normalizedName === 'write') return 'Write'
    if (normalizedName === 'edit') return 'Edit'
    if (normalizedName === 'grep') return 'Grep'
    if (normalizedName === 'glob') return 'Glob'
    if (normalizedName === 'run_code') return 'Code'
    if (normalizedName === 'ask_user_question') return '提问'
    return 'Tool call'
  })()
  const icon: DshRemoteNodePresentation['icon'] = (() => {
    if (normalizedName === 'web_search' || callView.kind === 'search' || card === 'search') return 'search'
    if (normalizedName === 'web_fetch' || callView.kind === 'fetch' || card === 'web') return 'fetch'
    if (normalizedName === 'bash' || normalizedName === 'pwsh' || card === 'terminal') return 'terminal'
    if (normalizedName === 'read' || callView.kind === 'read' || card === 'read') return 'read'
    if (normalizedName === 'write' || normalizedName === 'edit' || callView.kind === 'edit' || card === 'diff') return 'edit'
    if (normalizedName === 'run_code') return 'code'
    if (normalizedName === 'ask_user_question') return 'info'
    return 'tool'
  })()
  const rawResult = resultText(result)
  const errorMessage = firstLine(record(result.error).message)
  const errorSummary = firstLine(rawResult) || (errorMessage === '' ? '' : `Error: ${errorMessage}`)
  let summary = ''
  if (failed && errorSummary !== '') {
    summary = errorSummary
  } else if (normalizedName === 'ask_user_question') {
    const count = list(args.questions).length
    summary = count === 0
      ? ''
      : data.status === 'completed' ? `${count}/${count} 已回答` : `${count} 个问题`
  } else if (typeof resultView.summary === 'string') {
    summary = firstLine(resultView.summary)
  } else if (typeof resultView.title === 'string') {
    summary = firstLine(resultView.title)
  } else if (card === 'terminal') {
    summary = firstLine(callView.description) || firstLine(callView.title)
  } else if (typeof callView.title === 'string') {
    summary = firstLine(callView.title)
  } else if (normalizedName === 'web_search') {
    summary = list(args.queries).filter(value => typeof value === 'string').join(', ')
  } else {
    summary = safeArgumentSummary(normalizedName, args)
  }
  if (title === 'Tool call' && name !== '' && !summary.startsWith(name)) {
    summary = summary === '' ? name : `${name} · ${summary}`
  }
  if (failed && errorSummary !== '') summary = errorSummary
  const viewOutput = typeof resultView.output === 'string'
    ? resultView.output
    : contentText(resultView.content)
  const details = boundedDetails(viewOutput || rawResult)
  return {
    version: DSH_REMOTE_PRESENTATION_VERSION,
    format: 'summary',
    icon,
    title,
    ...(summary === '' ? {} : { summary }),
    ...(details === '' ? {} : { details }),
    tone: failed ? 'error' : 'neutral',
    ...(card === 'terminal' || normalizedName === 'bash' || normalizedName === 'pwsh' || normalizedName === 'run_code'
      ? { monospace: true }
      : {}),
  }
}

export function presentationForTimelineNode(
  kind: DshRemoteTimelineNodeKind,
  data: Record<string, unknown>,
): DshRemoteNodePresentation {
  switch (kind) {
    case 'user':
    case 'steering':
      return { version: 1, format: 'message', tone: 'neutral' }
    case 'assistant':
      return { version: 1, format: 'content', tone: 'neutral' }
    case 'context':
      return contextPresentation(data)
    case 'tool':
      return toolPresentation(data)
    case 'command': {
      const events = list(data.events)
      const latest = record(record(events.at(-1)).data)
      const name = firstLine(latest.name)
      return {
        version: 1, format: 'summary', icon: 'command',
        title: name === '' ? 'Command' : `/${name}`, tone: 'muted',
      }
    }
    case 'compaction':
      return { version: 1, format: 'summary', icon: 'compact', title: 'Context compacted', tone: 'muted' }
    case 'retry':
      return { version: 1, format: 'summary', icon: 'retry', title: 'Retry', summary: '模型正在重试', tone: 'muted' }
    case 'turn_error': {
      const message = firstLine(record(data.error).message) || firstLine(data.message) || '本轮运行失败'
      return { version: 1, format: 'summary', icon: 'error', title: 'Error', summary: message, tone: 'error' }
    }
    case 'max_tokens':
      return { version: 1, format: 'summary', icon: 'info', title: 'Max tokens', summary: '已达到本轮上下文上限', tone: 'muted' }
    case 'unknown':
      return { version: 1, format: 'summary', icon: 'info', title: firstLine(data.type) || 'DSH event', tone: 'muted' }
  }
}

function eventNode(entry: DshRemoteHistoryEntry, call?: OpenCall): { kind: DshRemoteTimelineNodeKind; data: Record<string, unknown> } | undefined {
  const data = record(entry.event.data)
  switch (entry.event.type) {
    case 'user/message':
      if (entry.event.surfaceOp !== 'append') return undefined
      return { kind: record(data.source).kind === 'user' ? 'user' : 'context', data }
    case 'assistant/chunk':
    case 'assistant/message':
      return { kind: 'assistant', data }
    case 'tool/call':
      return {
        kind: 'tool',
        data: {
          status: 'running', call: data,
          ...(entry.view?.for === 'call' ? { callView: entry.view.view } : {}),
        },
      }
    case 'tool/result':
      return {
        kind: 'tool',
        data: {
          status: data.error === null || data.error === undefined ? 'completed' : 'failed',
          ...(call === undefined ? {} : { call: call.data }),
          result: data,
          ...(call?.view === undefined ? {} : { callView: call.view }),
          ...(entry.view?.for === 'result' ? { resultView: entry.view.view } : {}),
        },
      }
    case 'llm/retry':
    case 'llm/retry-started':
      return { kind: 'retry', data }
    case 'command/run':
    case 'command/done':
      return { kind: 'command', data: { events: [entry.event] } }
    case 'compaction/start':
    case 'compaction/summary':
    case 'compaction/end':
      return { kind: 'compaction', data }
    case 'turn/end': {
      const reason = record(data.reason)
      if (reason.kind === 'error') return { kind: 'turn_error', data: reason }
      if (reason.kind === 'max-tokens') return { kind: 'max_tokens', data: reason }
      return undefined
    }
    default:
      return undefined
  }
}

/** One bounded lifecycle owner for live tool-call/result presentation pairing. */
export class DshRemoteEventPresenter {
  private readonly calls = new Map<string, Map<string, OpenCall>>()

  present(sessionId: string, entry: DshRemoteHistoryEntry): DshRemoteHistoryEntry {
    const data = record(entry.event.data)
    let table = this.calls.get(sessionId)
    let call: OpenCall | undefined
    if (entry.event.type === 'tool/call') {
      if (table === undefined) {
        table = new Map<string, OpenCall>()
        this.calls.set(sessionId, table)
        while (this.calls.size > MAX_OPEN_CALL_SESSIONS) this.calls.delete(this.calls.keys().next().value as string)
      }
      const callId = firstLine(data.callId)
      if (callId !== '') {
        table.set(callId, {
          data,
          ...(entry.view?.for === 'call' ? { view: entry.view.view } : {}),
        })
        while (table.size > MAX_OPEN_CALLS_PER_SESSION) table.delete(table.keys().next().value as string)
      }
    } else if (entry.event.type === 'tool/result') {
      const callId = firstLine(record(record(data.message).source).callId) || firstLine(data.callId)
      call = callId === '' ? undefined : table?.get(callId)
      if (callId !== '') table?.delete(callId)
    }
    const node = eventNode(entry, call)
    const presented = node === undefined
      ? entry
      : { ...entry, presentation: presentationForTimelineNode(node.kind, node.data) }
    if (entry.event.type === 'turn/end') this.calls.delete(sessionId)
    return presented
  }

  reset(): void {
    this.calls.clear()
  }
}

export function canonicalHistoryEntry(entry: DshRemoteHistoryEntry): DshRemoteHistoryEntry {
  return {
    event: entry.event,
    ...(entry.view === undefined ? {} : { view: entry.view }),
  }
}
