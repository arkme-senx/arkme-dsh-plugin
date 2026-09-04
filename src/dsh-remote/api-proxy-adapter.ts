import { createHash, randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import {
  DSH_REMOTE_MAX_FRAGMENTED_PAYLOAD_BYTES,
  DSH_REMOTE_MAX_PAGE_ITEMS,
  DSH_REMOTE_MAX_PAGE_RESULT_BYTES,
  DSH_REMOTE_MAX_MODEL_OPTIONS,
  DSH_REMOTE_MAX_SNAPSHOT_BYTES,
  DSH_REMOTE_MAX_TEXT_CODE_POINTS,
  type DshRemoteCapability,
  type DshRemoteModelCatalog,
  type DshRemoteModelOption,
  type DshRemoteModelSelection,
  type DshRemotePendingInteraction,
  type DshRemoteSessionSummary,
  type DshRemoteSnapshot,
  type DshRemoteWorkspaceView,
} from './types.js'
import { DshRemoteError } from './errors.js'
import {
  dshHistoryEntryUserRpcId,
  snapshotDshHistoryEntry,
  type DshRemoteHistoryEntry,
} from './dsh-event-contract.js'
import { DshRemoteEventPresenter } from './presentation.js'

export type { DshRemoteHistoryEntry } from './dsh-event-contract.js'

interface RpcSuccess<T> { rpcId: string; result: { ok: true; value: T } }
interface RpcFailure { rpcId: string; result: { ok: false; error: { code: string; message: string; details?: unknown } } }
type RpcResponse<T> = RpcSuccess<T> | RpcFailure

interface ModelCatalogApiValue {
  default?: { provider: string; model: string; reasoningEffort?: string }
  routableProviders?: string[]
  groups: Array<{
    id: string
    name: string
    models: Array<{
      id: string
      name: string
      description?: string
      reasoning?: {
        efforts: Array<{ id: string; name: string; description?: string }>
        defaultEffort?: string
      }
    }>
  }>
  failures: Array<{ id: string; name: string; message: string }>
}

interface WorkspaceApiLike {
  list?(request: { rpcId: string; payload: Record<string, never> }): Promise<RpcResponse<{
    items: Array<{ workspaceId: string; path: string; title: string; sessionIds: string[] }>
    archivedSessionIds?: string[]
  }>>
}

interface DshRemoteWorkspaceInventory {
  items: DshRemoteWorkspaceView[]
  archivedSessionIds: string[]
}

interface SessionsApiLike {
  list?(request: { rpcId: string; payload: { cursor?: string } }): Promise<RpcResponse<{ items: Array<{
    sessionId: string
    updatedAt: number
    running: boolean
    blank: boolean
    parentSessionId?: string
    origin?: 'subagent'
    cwd?: string
    projections?: { asOfSeq: number; values: Record<string, unknown> }
  }> }>>
  create?(request: { rpcId: string; payload: { workspaceId: string; sessionId: string } }): Promise<RpcResponse<{ sessionId: string }>>
  modelCatalog?(request: { rpcId: string; payload: Record<string, never> }): Promise<RpcResponse<ModelCatalogApiValue>>
  models?(request: { rpcId: string; payload: { sessionId: string } }): Promise<RpcResponse<{
    current: { provider: string; model: string; reasoningEffort?: string }
    routable: boolean
    groups: unknown[]
    failures: unknown[]
  }>>
  selectModel?(request: { rpcId: string; payload: {
    sessionId: string
    provider: string
    model: string
    reasoningEffort?: string
  } }): Promise<RpcResponse<{ selected: { provider: string; model: string; reasoningEffort?: string } }>>
  history?(request: { rpcId: string; payload: { sessionId: string; beforeSeq?: number; maxMessages: number } }): Promise<RpcResponse<{
    events: Array<{ event: {
      type: string
      seq: number
      time: number
      data: unknown
      sourceEventSeqs?: number[]
      surfaceOp?: unknown
      ignorable?: true
    }; view?: unknown }>
    hasMore: boolean
    projections?: { asOfSeq: number; values: Record<string, unknown> }
  }>>
  prompt?(request: { rpcId: string; payload: {
    sessionId: string
    mode: 'queue' | 'steer'
    content: Array<{ type: 'text'; text: string }>
  } }): Promise<RpcResponse<{ accepted: true }>>
  cancel?(request: { rpcId: string; payload: { sessionId: string } }): Promise<RpcResponse<{ accepted: true }>>
}

interface LlmApiLike {
  models?(request: { rpcId: string; payload: Record<string, never> }): Promise<RpcResponse<ModelCatalogApiValue>>
}

interface EventsApiLike {
  mux?(request: { rpcId: string; payload: { since?: Record<string, number> } }, signal: AbortSignal): AsyncIterable<{
    rpcId: string
    payload: Record<string, unknown>
  }>
}

export type DshRemoteApiProjectionEvent =
  | {
      kind: 'session-event'
      sessionId: string
      entry: DshRemoteHistoryEntry
    }
  | {
      kind: 'session-projection'
      sessionId: string
      key: 'goal'
      value: unknown
      seq: number
    }
  | {
      kind: 'interactions'
      pendingInteractions: DshRemotePendingInteraction[]
    }
  | {
      kind: 'mux-baseline'
      sessionId: string
      lastSeq: number
      pendingInteractions: DshRemotePendingInteraction[]
    }

export interface DshPublicApiProxyLike {
  workspace?: WorkspaceApiLike
  sessions?: SessionsApiLike
  llm?: LlmApiLike
  events?: EventsApiLike
  respond?(message: {
    type: 'client-response'
    rpcId: string
    result: { ok: true; value: unknown }
  }): Promise<{ accepted: true } | { accepted: false; reason: string }>
}

function rpcId(prefix: string): string { return `${prefix}-${randomUUID()}` }

function unwrap<T>(response: RpcResponse<T>): T {
  if (response.result.ok) return response.result.value
  const error = response.result.error
  switch (error.code) {
    case 'session-not-found': throw new DshRemoteError('SESSION_NOT_FOUND', 'DSH 会话不存在')
    case 'workspace-not-found':
    case 'workspace-invalid-path': throw new DshRemoteError('WORKSPACE_UNAVAILABLE', 'DSH 工作目录不可用')
    case 'agent-busy':
    case 'steer-unavailable':
    case 'queue-item-not-found': throw new DshRemoteError('SESSION_STATE_CHANGED', 'DSH 会话状态已经变化', true)
    default: throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', error.message || 'DSH 操作失败', true, {
      dshCode: error.code, dshRejected: true,
    })
  }
}

function offsetCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ v: 1, o: offset })).toString('base64url')
}

function readOffset(cursor?: string): number {
  if (cursor === undefined || cursor === '') return 0
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { v?: unknown; o?: unknown }
    if (value.v === 1 && Number.isSafeInteger(value.o) && Number(value.o) >= 0) return Number(value.o)
  } catch { /* Invalid cursors fail below. */ }
  throw new DshRemoteError('REMOTE_REQUEST_INVALID', '分页游标无效')
}

export function stableDshRemoteSessionId(requestRef: string): string {
  const bytes = createHash('sha256').update(`dsh-remote-session-v1\n${requestRef}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function codePointLength(value: string): number { return [...value].length }

function jsonBytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value)) }

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function modelSelection(value: unknown, field: string): DshRemoteModelSelection | undefined {
  if (value === undefined || value === null) return undefined
  const source = objectValue(value)
  if (source === undefined
    || typeof source.provider !== 'string' || source.provider.trim() === '' || source.provider.length > 256
    || typeof source.model !== 'string' || source.model.trim() === '' || source.model.length > 256
    || (source.reasoningEffort !== undefined
      && (typeof source.reasoningEffort !== 'string'
        || source.reasoningEffort.trim() === '' || source.reasoningEffort.length > 128))) {
    throw new DshRemoteError('REMOTE_INVALID_RESPONSE', `DSH ${field} 模型选择无效`)
  }
  return {
    provider: source.provider.trim(),
    model: source.model.trim(),
    ...(typeof source.reasoningEffort === 'string'
      ? { reasoningEffort: source.reasoningEffort.trim() }
      : {}),
  }
}

function modelReasoning(value: unknown): Pick<DshRemoteModelOption, 'reasoningEfforts' | 'defaultReasoningEffort'> {
  if (value === undefined || value === null) return {}
  const source = objectValue(value)
  if (source === undefined || !Array.isArray(source.efforts) || source.efforts.length === 0
    || source.efforts.length > 16) {
    throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH 模型推理等级无效')
  }
  const reasoningEfforts = source.efforts.map((raw) => {
    const effort = objectValue(raw)
    if (effort === undefined || typeof effort.id !== 'string' || effort.id.trim() === ''
      || typeof effort.name !== 'string' || effort.name.trim() === '') {
      throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH 模型推理等级条目无效')
    }
    return {
      id: boundedUtf8(effort.id.trim(), 128),
      displayName: boundedUtf8(effort.name.trim(), 256),
      ...(typeof effort.description === 'string' && effort.description.trim() !== ''
        ? { description: boundedUtf8(effort.description.trim(), 512) }
        : {}),
    }
  })
  const ids = new Set(reasoningEfforts.map(effort => effort.id))
  if (ids.size !== reasoningEfforts.length) {
    throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH 模型推理等级包含重复 ID')
  }
  const defaultReasoningEffort = typeof source.defaultEffort === 'string'
    ? boundedUtf8(source.defaultEffort.trim(), 128) : undefined
  if (defaultReasoningEffort !== undefined && !ids.has(defaultReasoningEffort)) {
    throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH 默认推理等级不在可选列表中')
  }
  return {
    reasoningEfforts,
    ...(defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort }),
  }
}

// A live session event or one pending interaction is not itself pageable. Keep
// each atomic projection well below the 40 KiB page-result budget so the
// authorized event and both Realtime wrappers remain below 60 KiB.
const MAX_ATOMIC_PROJECTION_BYTES = 24 * 1024

function boundedUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value
  let result = ''
  let used = 0
  for (const point of value) {
    const bytes = Buffer.byteLength(point)
    if (used + bytes > maxBytes) break
    result += point
    used += bytes
  }
  return result
}

function pageLimit(value?: number): number {
  return Math.min(DSH_REMOTE_MAX_PAGE_ITEMS, Math.max(1, Math.trunc(value ?? DSH_REMOTE_MAX_PAGE_ITEMS)))
}

function pageByBytes<T, R>(input: {
  all: readonly T[]
  offset: number
  limit: number
  build: (items: T[], nextCursor?: string) => R
}): R {
  const items: T[] = []
  while (input.offset + items.length < input.all.length && items.length < input.limit) {
    const candidate = [...items, input.all[input.offset + items.length]!]
    const consumed = input.offset + candidate.length
    const nextCursor = consumed < input.all.length ? offsetCursor(consumed) : undefined
    const result = input.build(candidate, nextCursor)
    if (jsonBytes(result) > DSH_REMOTE_MAX_PAGE_RESULT_BYTES || jsonBytes(result) > DSH_REMOTE_MAX_SNAPSHOT_BYTES) break
    items.push(candidate.at(-1)!)
  }
  if (items.length === 0 && input.offset < input.all.length) {
    throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '单个 DSH 投影超过远控帧容量')
  }
  const consumed = input.offset + items.length
  return input.build(items, consumed < input.all.length ? offsetCursor(consumed) : undefined)
}

function projectQuestions(value: unknown[]): unknown[] | undefined {
  const result: unknown[] = []
  for (const raw of value.slice(0, 16)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const source = raw as Record<string, unknown>
    if (typeof source.id !== 'string' || typeof source.question !== 'string') continue
    const options = Array.isArray(source.options) ? source.options.slice(0, 16).flatMap(option => {
      if (option === null || typeof option !== 'object' || Array.isArray(option)) return []
      const item = option as Record<string, unknown>
      if (typeof item.label !== 'string') return []
      return [{
        label: boundedUtf8(item.label, 512),
        ...(typeof item.description === 'string' ? { description: boundedUtf8(item.description, 2 * 1024) } : {}),
      }]
    }) : undefined
    const projected = {
      id: boundedUtf8(source.id, 256),
      question: boundedUtf8(source.question, 4 * 1024),
      ...(typeof source.header === 'string' ? { header: boundedUtf8(source.header, 512) } : {}),
      ...(typeof source.detail === 'string' ? { detail: boundedUtf8(source.detail, 8 * 1024) } : {}),
      ...(options === undefined ? {} : { options }),
      ...(typeof source.multiSelect === 'boolean' ? { multiSelect: source.multiSelect } : {}),
      ...(source.intent !== null && typeof source.intent === 'object' && !Array.isArray(source.intent)
        && (source.intent as Record<string, unknown>).kind === 'plan-review'
        && typeof (source.intent as Record<string, unknown>).approve === 'string'
        ? { intent: { kind: 'plan-review', approve: boundedUtf8((source.intent as { approve: string }).approve, 512) } }
        : {}),
    }
    if (jsonBytes([...result, projected]) > MAX_ATOMIC_PROJECTION_BYTES) return undefined
    result.push(projected)
  }
  return result
}

export class DshApiProxyAdapter {
  private readonly pendingInteractions = new Map<string, DshRemotePendingInteraction>()
  private readonly interactionListeners = new Set<(interactions: DshRemotePendingInteraction[]) => void>()
  private readonly projectionListeners = new Set<(event: DshRemoteApiProjectionEvent) => void>()
  private eventController: AbortController | undefined
  private eventLoop: Promise<void> | undefined
  private readonly eventPresenter = new DshRemoteEventPresenter()

  constructor(
    private readonly api: DshPublicApiProxyLike,
    private readonly options: {
      eventRetryBaseMillis?: number
      defaultModelSelection?: () => unknown
    } = {},
  ) {}

  capabilities(): DshRemoteCapability[] {
    const result: DshRemoteCapability[] = []
    if (typeof this.api.workspace?.list === 'function') result.push('workspace.list')
    if (typeof this.api.sessions?.list === 'function') result.push('session.list')
    if (typeof this.api.sessions?.create === 'function') result.push('session.create')
    if (typeof this.api.sessions?.create === 'function'
      && typeof this.api.sessions?.selectModel === 'function') result.push('session.create.model')
    if (this.hasModelCatalog()) result.push('model.list')
    if (typeof this.api.sessions?.models === 'function'
      || (typeof this.api.sessions?.list === 'function'
        && typeof this.api.sessions?.modelCatalog === 'function')) result.push('session.model.get')
    if (typeof this.api.sessions?.selectModel === 'function') result.push('session.model.select')
    if (typeof this.api.sessions?.history === 'function') result.push('session.history')
    if (typeof this.api.sessions?.prompt === 'function') {
      result.push('session.prompt', 'session.prompt.queue', 'session.prompt.steer')
    }
    if (typeof this.api.sessions?.cancel === 'function') result.push('session.cancel')
    if (typeof this.api.events?.mux === 'function') result.push('session.events')
    if (typeof this.api.events?.mux === 'function' && typeof this.api.respond === 'function') {
      result.push('interaction.question.respond', 'interaction.approval.respond')
    }
    return result
  }

  async workspaces(): Promise<DshRemoteWorkspaceView[]> {
    return (await this.workspaceInventory()).items
  }

  async workspaceInventory(): Promise<DshRemoteWorkspaceInventory> {
    const list = this.api.workspace?.list
    if (typeof list !== 'function') this.unsupported('workspace.list')
    const value = unwrap(await list.call(this.api.workspace, { rpcId: rpcId('remote-workspaces'), payload: {} }))
    const items = await Promise.all(value.items.map(async item => {
      let available = false
      let path = item.path
      try {
        path = await realpath(item.path)
        available = (await stat(path)).isDirectory()
      } catch { available = false }
      return {
        workspaceId: item.workspaceId,
        title: boundedUtf8(item.title, 512),
        path,
        available,
        sessionIds: [...item.sessionIds],
      }
    }))
    return {
      items,
      archivedSessionIds: [...new Set(value.archivedSessionIds ?? [])],
    }
  }

  async workspacePage(input: { limit?: number; cursor?: string } = {}): Promise<{
    items: DshRemoteWorkspaceView[]
    nextCursor?: string
  }> {
    const all = (await this.workspaces()).map(item => ({
      ...item,
      // Session membership is projected through session.list. Keeping the
      // potentially unbounded raw ID array out of workspace.list prevents one
      // workspace from bypassing byte pagination.
      sessionIds: [],
    }))
    const offset = readOffset(input.cursor)
    if (offset > all.length) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '分页游标超出工作目录投影')
    return pageByBytes({
      all, offset, limit: pageLimit(input.limit),
      build: (items, nextCursor) => ({ items, ...(nextCursor === undefined ? {} : { nextCursor }) }),
    })
  }

  async sessions(input: {
    workspaceId?: string
    limit?: number
    cursor?: string
    workspaceInventory?: DshRemoteWorkspaceInventory
  } = {}): Promise<{
    items: DshRemoteSessionSummary[]
    nextCursor?: string
  }> {
    const list = this.api.sessions?.list
    if (typeof list !== 'function') this.unsupported('session.list')
    const workspaceInventory = input.workspaceInventory ?? await this.workspaceInventory()
    const workspaces = workspaceInventory.items
    const archived = new Set(workspaceInventory.archivedSessionIds)
    const workspaceBySession = new Map<string, string>()
    for (const workspace of workspaces) {
      for (const sessionId of workspace.sessionIds) workspaceBySession.set(sessionId, workspace.workspaceId)
    }
    const value = unwrap(await list.call(this.api.sessions, { rpcId: rpcId('remote-sessions'), payload: {} }))
    const all = value.items.flatMap<DshRemoteSessionSummary>(item => {
      const workspaceId = workspaceBySession.get(item.sessionId)
      if (workspaceId === undefined || (input.workspaceId !== undefined && workspaceId !== input.workspaceId)) return []
      const titleValue = item.projections?.values.title
      return [{
        sessionId: item.sessionId,
        workspaceId,
        ...(typeof titleValue === 'string' && titleValue.trim() !== '' ? { title: titleValue.trim().slice(0, 200) } : {}),
        updatedAt: item.updatedAt,
        running: item.running,
        blank: item.blank,
        archived: archived.has(item.sessionId),
        ...(item.origin === undefined ? {} : { origin: item.origin }),
        ...(item.parentSessionId === undefined ? {} : { parentSessionId: item.parentSessionId }),
        ...(item.projections === undefined ? {} : { projectionAsOfSeq: item.projections.asOfSeq }),
        ...(item.projections !== undefined && Object.hasOwn(item.projections.values, 'goal')
          ? { goal: item.projections.values.goal }
          : {}),
      }]
    }).sort((left, right) => right.updatedAt - left.updatedAt)
    const offset = readOffset(input.cursor)
    if (offset > all.length) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '分页游标超出会话投影')
    return pageByBytes({
      all, offset, limit: pageLimit(input.limit),
      build: (items, nextCursor) => ({ items, ...(nextCursor === undefined ? {} : { nextCursor }) }),
    })
  }

  async history(input: { sessionId: string; beforeSeq?: number; limit?: number }): Promise<{
    entries: DshRemoteHistoryEntry[]
    hasMore: boolean
    nextCursor?: number
    projectionAsOfSeq?: number
  }> {
    await this.requireSession(input.sessionId, false)
    const history = this.api.sessions?.history
    if (typeof history !== 'function') this.unsupported('session.history')
    const limit = pageLimit(input.limit)
    const value = unwrap(await history.call(this.api.sessions, {
      rpcId: rpcId('remote-history'),
      payload: {
        sessionId: input.sessionId,
        maxMessages: limit,
        ...(input.beforeSeq === undefined ? {} : { beforeSeq: input.beforeSeq }),
      },
    }))
    const presenter = new DshRemoteEventPresenter()
    const entries = value.events
      .map(snapshotDshHistoryEntry)
      .map(entry => presenter.present(input.sessionId, entry))
    let truncatedByBudget = false
    while (entries.length > 0) {
      const firstSeq = value.events[0]?.event.seq
      const candidate = {
        entries,
        hasMore: value.hasMore || truncatedByBudget,
        ...(firstSeq === undefined || (!value.hasMore && !truncatedByBudget) ? {} : { nextCursor: firstSeq }),
        ...(value.projections === undefined ? {} : { projectionAsOfSeq: value.projections.asOfSeq }),
      }
      if (jsonBytes(candidate) <= DSH_REMOTE_MAX_FRAGMENTED_PAYLOAD_BYTES) break
      entries.shift()
      truncatedByBudget = true
    }
    if (entries.length === 0 && truncatedByBudget) throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '单条 DSH 历史投影超过 64MiB 安全上限')
    const firstSeq = truncatedByBudget ? entries[0]?.event.seq : value.events[0]?.event.seq
    return {
      entries,
      hasMore: value.hasMore || truncatedByBudget,
      ...(firstSeq === undefined || (!value.hasMore && !truncatedByBudget) ? {} : { nextCursor: firstSeq }),
      ...(value.projections === undefined ? {} : { projectionAsOfSeq: value.projections.asOfSeq }),
    }
  }

  async models(): Promise<DshRemoteModelCatalog> {
    const value = await this.modelCatalog()
    const defaultSelection = this.options.defaultModelSelection === undefined
      ? undefined
      : modelSelection(
          this.options.defaultModelSelection(),
          'agentDefaultModel.currentSelection',
        )
    const result: DshRemoteModelCatalog = {
      items: [],
      failedProviders: value.failures.map(failure => ({
        provider: boundedUtf8(failure.id, 128),
        providerName: boundedUtf8(failure.name, 256),
      })),
      truncated: false,
      ...(defaultSelection === undefined ? {} : { defaultSelection }),
    }
    outer: for (const group of value.groups) {
      const provider = boundedUtf8(group.id, 128)
      const providerName = boundedUtf8(group.name, 256)
      for (const model of group.models) {
        const item = {
          provider,
          providerName,
          model: boundedUtf8(model.id, 128),
          displayName: boundedUtf8(model.name, 256),
          ...(model.description === undefined
            ? {}
            : { description: boundedUtf8(model.description, 512) }),
          ...modelReasoning(model.reasoning),
        }
        if (result.items.length >= DSH_REMOTE_MAX_MODEL_OPTIONS
          || jsonBytes({ ...result, items: [...result.items, item] }) > DSH_REMOTE_MAX_PAGE_RESULT_BYTES) {
          result.truncated = true
          break outer
        }
        result.items.push(item)
      }
    }
    return result
  }

  async sessionModel(input: { sessionId: string }): Promise<{ current: DshRemoteModelSelection }> {
    await this.requireSession(input.sessionId, false)
    const legacyModels = this.api.sessions?.models
    if (typeof legacyModels === 'function') {
      const value = unwrap(await legacyModels.call(this.api.sessions, {
        rpcId: rpcId('remote-session-model'),
        payload: { sessionId: input.sessionId },
      }))
      const current = modelSelection(value.current, 'session.models.current')
      if (current === undefined) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH 未返回当前模型')
      return { current }
    }

    const list = this.api.sessions?.list
    if (typeof list !== 'function' || typeof this.api.sessions?.modelCatalog !== 'function') {
      this.unsupported('session.model.get')
    }
    const listed = unwrap(await list.call(this.api.sessions, {
      rpcId: rpcId('remote-session-model-projection'),
      payload: {},
    })).items.find(item => item.sessionId === input.sessionId)
    if (listed === undefined) throw new DshRemoteError('SESSION_NOT_FOUND', 'DSH 会话不存在')
    const projection = objectValue(listed.projections?.values.modelSelection)
    const current = modelSelection(projection?.next, 'modelSelection.next')
      ?? modelSelection(projection?.lastUsed, 'modelSelection.lastUsed')
      ?? modelSelection((await this.modelCatalog()).default, 'modelCatalog.default')
    if (current === undefined) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH 未返回当前或默认模型')
    return { current }
  }

  async selectSessionModel(input: {
    sessionId: string
    provider: string
    model: string
    reasoningEffort?: string
    dshRpcId: string
  }): Promise<{ selected: DshRemoteModelSelection }> {
    await this.requireSession(input.sessionId, false)
    const selectModel = this.api.sessions?.selectModel
    if (typeof selectModel !== 'function') this.unsupported('session.model.select')
    const selected = modelSelection(unwrap(await selectModel.call(this.api.sessions, {
      rpcId: input.dshRpcId,
      payload: {
        sessionId: input.sessionId,
        provider: input.provider,
        model: input.model,
        ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
      },
    })).selected, 'session.selectModel.selected')
    if (selected === undefined
      || selected.provider !== input.provider || selected.model !== input.model
      || (input.reasoningEffort !== undefined && selected.reasoningEffort !== input.reasoningEffort)) {
      throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH 返回了与请求不一致的模型')
    }
    return { selected }
  }

  async sessionModelMatches(input: {
    sessionId: string
    provider: string
    model: string
    reasoningEffort?: string
  }): Promise<boolean> {
    const current = (await this.sessionModel({ sessionId: input.sessionId })).current
    return current.provider === input.provider && current.model === input.model
      && (input.reasoningEffort === undefined || current.reasoningEffort === input.reasoningEffort)
  }

  historyContainsRpcId(entries: readonly DshRemoteHistoryEntry[], rpcIdValue: string): boolean {
    return entries.some(entry => dshHistoryEntryUserRpcId(entry) === rpcIdValue)
  }

  async createSession(input: {
    workspaceId: string
    dshRpcId: string
    modelSelection?: DshRemoteModelSelection
    beforeCreate?: (sessionId: string) => Promise<void>
  }): Promise<{ sessionId: string; modelSelection?: DshRemoteModelSelection }> {
    const workspace = (await this.workspaces()).find(item => item.workspaceId === input.workspaceId)
    if (workspace === undefined || !workspace.available) throw new DshRemoteError('WORKSPACE_UNAVAILABLE', '工作目录已经删除或不可访问')
    const create = this.api.sessions?.create
    if (typeof create !== 'function') this.unsupported('session.create')
    // request_ref is only controller-scoped. The Host ledger's rpc id also
    // binds account+Runtime, so two trusted phones cannot collide on a Session.
    const sessionId = stableDshRemoteSessionId(input.dshRpcId)
    await input.beforeCreate?.(sessionId)
    const created = unwrap(await create.call(this.api.sessions, {
      rpcId: input.dshRpcId,
      payload: { workspaceId: input.workspaceId, sessionId },
    }))
    if (created.sessionId !== sessionId) {
      throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH 返回了与预分配值不一致的 SessionId')
    }
    if (input.modelSelection === undefined) return created
    const selectModel = this.api.sessions?.selectModel
    if (typeof selectModel !== 'function') this.unsupported('session.create.model')
    const selected = modelSelection(unwrap(await selectModel.call(this.api.sessions, {
      rpcId: `${input.dshRpcId}-model`,
      payload: { sessionId, ...input.modelSelection },
    })).selected, 'session.selectModel.selected')
    if (selected === undefined || selected.provider !== input.modelSelection.provider
      || selected.model !== input.modelSelection.model
      || (input.modelSelection.reasoningEffort !== undefined
        && selected.reasoningEffort !== input.modelSelection.reasoningEffort)) {
      throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH 返回了与请求不一致的模型')
    }
    return { sessionId, modelSelection: selected }
  }

  async reconcileCreatedSession(input: {
    workspaceId: string
    dshRpcId: string
    modelSelection?: DshRemoteModelSelection
  }): Promise<{ sessionId: string; modelSelection?: DshRemoteModelSelection } | undefined> {
    const expected = stableDshRemoteSessionId(input.dshRpcId)
    let cursor: string | undefined
    do {
      const page = await this.sessions({
        workspaceId: input.workspaceId,
        limit: DSH_REMOTE_MAX_PAGE_ITEMS,
        ...(cursor === undefined ? {} : { cursor }),
      })
      if (page.items.some(item => item.sessionId === expected)) {
        if (input.modelSelection === undefined) return { sessionId: expected }
        return await this.sessionModelMatches({ sessionId: expected, ...input.modelSelection })
          ? { sessionId: expected, modelSelection: input.modelSelection }
          : undefined
      }
      cursor = page.nextCursor
    } while (cursor !== undefined)
    return undefined
  }

  async prompt(input: {
    sessionId: string
    mode: 'queue' | 'steer'
    content: unknown
    dshRpcId: string
  }): Promise<{ accepted: true }> {
    const text = this.textContent(input.content)
    const session = await this.requireSession(input.sessionId, true)
    if (input.mode === 'steer' && !session.running) throw new DshRemoteError('SESSION_STATE_CHANGED', '会话当前未运行，不能立即引导')
    const prompt = this.api.sessions?.prompt
    if (typeof prompt !== 'function') this.unsupported('session.prompt')
    return unwrap(await prompt.call(this.api.sessions, {
      rpcId: input.dshRpcId,
      payload: { sessionId: input.sessionId, mode: input.mode, content: [{ type: 'text', text }] },
    }))
  }

  async cancel(input: { sessionId: string; dshRpcId: string }): Promise<{ accepted: true }> {
    const session = await this.requireSession(input.sessionId, false)
    if (!session.running) return { accepted: true }
    const cancel = this.api.sessions?.cancel
    if (typeof cancel !== 'function') this.unsupported('session.cancel')
    return unwrap(await cancel.call(this.api.sessions, { rpcId: input.dshRpcId, payload: { sessionId: input.sessionId } }))
  }

  async answerQuestion(input: { interactionRpcRef: string; sessionId: string; answer: unknown }): Promise<void> {
    const pending = this.pendingInteractions.get(input.interactionRpcRef)
    if (pending?.kind !== 'question' || pending.sessionId !== input.sessionId) this.resolved()
    await this.respond(input.interactionRpcRef, { sessionId: input.sessionId, answer: input.answer })
  }

  async answerApproval(input: {
    interactionRpcRef: string
    sessionId: string
    approvalId: string
    outcome: 'allowed-once' | 'rejected'
  }): Promise<void> {
    const pending = this.pendingInteractions.get(input.interactionRpcRef)
    if (pending?.kind !== 'approval' || pending.sessionId !== input.sessionId || pending.approvalId !== input.approvalId) this.resolved()
    if (input.outcome === 'allowed-once' && !pending.canAllowOnce) {
      throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '审批上下文不完整，只能在桌面端处理或拒绝')
    }
    await this.respond(input.interactionRpcRef, {
      sessionId: input.sessionId, approvalId: input.approvalId, outcome: input.outcome,
    })
  }

  pending(): DshRemotePendingInteraction[] { return [...this.pendingInteractions.values()] }

  subscribeInteractions(listener: (interactions: DshRemotePendingInteraction[]) => void): () => void {
    this.interactionListeners.add(listener)
    return () => { this.interactionListeners.delete(listener) }
  }

  subscribeProjectionEvents(listener: (event: DshRemoteApiProjectionEvent) => void): () => void {
    this.projectionListeners.add(listener)
    return () => { this.projectionListeners.delete(listener) }
  }

  startEvents(): () => void {
    if (this.eventLoop !== undefined) return () => { this.stopEvents() }
    const mux = this.api.events?.mux
    if (typeof mux !== 'function') return () => undefined
    const controller = new AbortController()
    this.eventController = controller
    const loop = this.maintainEvents(mux.bind(this.api.events), controller.signal)
    this.eventLoop = loop
    void loop.finally(() => {
      if (this.eventLoop === loop) this.eventLoop = undefined
      if (this.eventController === controller) this.eventController = undefined
    })
    return () => { this.stopEvents() }
  }

  stopEvents(): void { this.eventController?.abort() }

  private async maintainEvents(
    mux: (request: { rpcId: string; payload: {} }, signal: AbortSignal) => AsyncIterable<{ rpcId: string; payload: Record<string, unknown> }>,
    signal: AbortSignal,
  ): Promise<void> {
    const baseDelay = Math.min(5_000, Math.max(10, this.options.eventRetryBaseMillis ?? 250))
    let delay = baseDelay
    while (!signal.aborted) {
      try {
        await this.consumeEvents(mux, signal)
        if (signal.aborted) return
      } catch (error) {
        if (signal.aborted) return
        console.warn('dsh-arkme: DSH remote mux disconnected:', error instanceof Error ? error.message : String(error))
      }
      // A new public ApiProxy mux subscription replays current pending
      // interactions. Drop the stale local set before that replay so a resolve
      // that happened during the gap cannot remain actionable on mobile.
      this.pendingInteractions.clear()
      this.emitInteractions()
      await new Promise<void>(resolve => {
        const done = () => { signal.removeEventListener('abort', onAbort); resolve() }
        const timer = setTimeout(done, delay)
        timer.unref()
        const onAbort = () => { clearTimeout(timer); done() }
        signal.addEventListener('abort', onAbort, { once: true })
      })
      delay = Math.min(5_000, delay * 2)
    }
  }

  async snapshot(input: { limit?: number; cursor?: string } = {}): Promise<DshRemoteSnapshot> {
    const workspaceInventory = await this.workspaceInventory()
    const workspaces = workspaceInventory.items
    const sessions: DshRemoteSessionSummary[] = []
    let cursor: string | undefined
    do {
      const page = await this.sessions({
        limit: DSH_REMOTE_MAX_PAGE_ITEMS,
        workspaceInventory,
        ...(cursor === undefined ? {} : { cursor }),
      })
      sessions.push(...page.items)
      cursor = page.nextCursor
    } while (cursor !== undefined)
    const flattened: Array<
      | { kind: 'workspace'; value: DshRemoteWorkspaceView }
      | { kind: 'session'; value: DshRemoteSessionSummary }
      | { kind: 'interaction'; value: DshRemotePendingInteraction }
    > = [
      ...workspaces.map(value => ({ kind: 'workspace' as const, value: { ...value, sessionIds: [] } })),
      ...sessions.map(value => ({ kind: 'session' as const, value })),
      ...this.pending().map(value => ({ kind: 'interaction' as const, value })),
    ]
    const offset = readOffset(input.cursor)
    if (offset > flattened.length) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '分页游标超出快照投影')
    const projectionAsOfMillis = Date.now()
    return pageByBytes({
      all: flattened, offset, limit: pageLimit(input.limit),
      build: (items, nextCursor) => ({
        projectionAsOfMillis,
        workspaces: items.flatMap(item => item.kind === 'workspace' ? [item.value] : []),
        sessions: items.flatMap(item => item.kind === 'session' ? [item.value] : []),
        pendingInteractions: items.flatMap(item => item.kind === 'interaction' ? [item.value] : []),
        ...(nextCursor === undefined ? {} : { nextCursor }),
      }),
    })
  }

  private async consumeEvents(
    mux: (request: { rpcId: string; payload: {} }, signal: AbortSignal) => AsyncIterable<{ rpcId: string; payload: Record<string, unknown> }>,
    signal: AbortSignal,
  ): Promise<void> {
    this.eventPresenter.reset()
    for await (const frame of mux({ rpcId: rpcId('remote-mux'), payload: {} }, signal)) {
      if (signal.aborted) return
      const payload = frame.payload
      const type = payload.type
      let interactionsChanged = false
      if (type === 'session/event' && typeof payload.sessionId === 'string'
        && payload.event !== null && typeof payload.event === 'object' && !Array.isArray(payload.event)) {
        const event = payload.event as Record<string, unknown>
        if (typeof event.type === 'string' && typeof event.seq === 'number' && Number.isSafeInteger(event.seq) && event.seq >= 0
          && typeof event.time === 'number' && Number.isSafeInteger(event.time) && event.time >= 0) {
          const entry = this.eventPresenter.present(
            payload.sessionId,
            snapshotDshHistoryEntry({ event, view: payload.view }),
          )
          this.emitProjection({ kind: 'session-event', sessionId: payload.sessionId, entry })
        }
      } else if (type === 'session/projection' && typeof payload.sessionId === 'string'
        && payload.key === 'goal' && typeof payload.seq === 'number'
        && Number.isSafeInteger(payload.seq) && payload.seq >= 0) {
        this.emitProjection({
          kind: 'session-projection', sessionId: payload.sessionId,
          key: 'goal', value: payload.value, seq: payload.seq,
        })
      } else if (type === 'session/subscribed' && typeof payload.sessionId === 'string'
        && typeof payload.lastSeq === 'number' && Number.isSafeInteger(payload.lastSeq) && payload.lastSeq >= -1) {
        this.emitProjection({
          kind: 'mux-baseline', sessionId: payload.sessionId, lastSeq: payload.lastSeq,
          pendingInteractions: this.pending(),
        })
      } else if (type === 'question/requested' && typeof payload.sessionId === 'string' && Array.isArray(payload.questions)) {
        const questions = projectQuestions(payload.questions)
        if (questions !== undefined && questions.length > 0) {
          this.pendingInteractions.set(frame.rpcId, {
            kind: 'question', interactionRpcRef: frame.rpcId, sessionId: payload.sessionId, questions,
          })
          interactionsChanged = true
        }
      } else if (type === 'approval/requested' && typeof payload.sessionId === 'string'
        && typeof payload.approvalId === 'string' && typeof payload.toolName === 'string') {
        const reason = typeof payload.reason === 'string' && payload.reason.trim() !== '' ? payload.reason.trim().slice(0, 500) : undefined
        this.pendingInteractions.set(frame.rpcId, {
          kind: 'approval', interactionRpcRef: frame.rpcId, sessionId: payload.sessionId,
          approvalId: payload.approvalId, toolName: payload.toolName,
          ...(reason === undefined ? {} : { reason }),
          // rc.7 does not carry a complete workspace + operation summary. Fail closed for allow-once.
          canAllowOnce: false,
        })
        interactionsChanged = true
      } else if (type === 'question/resolved' && typeof payload.questionRpcId === 'string') {
        interactionsChanged = this.pendingInteractions.delete(payload.questionRpcId)
      } else if (type === 'approval/resolved') {
        for (const [key, pending] of this.pendingInteractions) {
          if (pending.kind === 'approval' && pending.sessionId === payload.sessionId && pending.approvalId === payload.approvalId) {
            this.pendingInteractions.delete(key)
            interactionsChanged = true
          }
        }
      }
      if (interactionsChanged) this.emitInteractions()
    }
  }

  private async requireSession(sessionId: string, requireWorkspaceAvailable: boolean): Promise<DshRemoteSessionSummary> {
    const workspaces = await this.workspaces()
    const workspace = workspaces.find(item => item.sessionIds.includes(sessionId))
    if (workspace === undefined) throw new DshRemoteError('SESSION_NOT_FOUND', '会话不属于当前 Runtime 的已登记工作目录')
    if (requireWorkspaceAvailable && !workspace.available) throw new DshRemoteError('WORKSPACE_UNAVAILABLE', '工作目录已经删除或不可访问')
    let cursor: string | undefined
    do {
      const page = await this.sessions({
        workspaceId: workspace.workspaceId, limit: DSH_REMOTE_MAX_PAGE_ITEMS,
        ...(cursor === undefined ? {} : { cursor }),
      })
      const session = page.items.find(item => item.sessionId === sessionId)
      if (session !== undefined) return session
      cursor = page.nextCursor
    } while (cursor !== undefined)
    throw new DshRemoteError('SESSION_NOT_FOUND', 'DSH 会话不存在')
  }

  private textContent(content: unknown): string {
    if (!Array.isArray(content) || content.length !== 1) {
      throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '首版远控只支持单个文本消息')
    }
    const block = content[0]
    if (block === null || typeof block !== 'object' || Array.isArray(block)
      || (block as Record<string, unknown>).type !== 'text' || typeof (block as Record<string, unknown>).text !== 'string') {
      throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '首版远控不支持图片、文件或附件')
    }
    const text = (block as { text: string }).text
    if (text.trim() === '' || codePointLength(text) > DSH_REMOTE_MAX_TEXT_CODE_POINTS) {
      throw new DshRemoteError('REMOTE_REQUEST_INVALID', '远控文本必须为 1 至 20000 个字符')
    }
    if (text.trimStart().startsWith('/')) {
      throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '首版远控不执行 DSH slash command')
    }
    return text
  }

  private async respond(rpcIdValue: string, value: unknown): Promise<void> {
    if (typeof this.api.respond !== 'function') this.unsupported('interaction response')
    const receipt = await this.api.respond({ type: 'client-response', rpcId: rpcIdValue, result: { ok: true, value } })
    if (!receipt.accepted) this.resolved()
    this.pendingInteractions.delete(rpcIdValue)
    this.emitInteractions()
  }

  private emitInteractions(): void {
    const snapshot = this.pending()
    for (const listener of this.interactionListeners) listener(snapshot)
    this.emitProjection({ kind: 'interactions', pendingInteractions: snapshot })
  }

  private emitProjection(event: DshRemoteApiProjectionEvent): void {
    for (const listener of this.projectionListeners) listener(event)
  }

  private unsupported(capability: string): never {
    throw new DshRemoteError('CAPABILITY_UNSUPPORTED', `当前 DSH 版本不支持 ${capability}`)
  }

  private resolved(): never { throw new DshRemoteError('INTERACTION_RESOLVED', '问题或审批已在其他端处理') }

  private hasModelCatalog(): boolean {
    return typeof this.api.sessions?.modelCatalog === 'function'
      || typeof this.api.llm?.models === 'function'
  }

  private async modelCatalog(): Promise<ModelCatalogApiValue> {
    const official = this.api.sessions?.modelCatalog
    if (typeof official === 'function') {
      return unwrap(await official.call(this.api.sessions, {
        rpcId: rpcId('remote-model-catalog'),
        payload: {},
      }))
    }
    const legacy = this.api.llm?.models
    if (typeof legacy === 'function') {
      return unwrap(await legacy.call(this.api.llm, {
        rpcId: rpcId('remote-models'),
        payload: {},
      }))
    }
    return this.unsupported('model.list')
  }
}
