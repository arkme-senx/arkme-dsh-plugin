import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {
  ArkmeArkoAskResult,
  ArkmeArkoCancelResult,
  ArkmeArkoHistoryItem,
  ArkmeArkoRunStatus,
} from '../../../types.js'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import type { ArkmeArkoToolPort } from '../../ports/arko.js'
import { stableUidForToolCall } from '../../shared/stable-id.js'

const ARKO_DEFAULT_WAIT_MILLIS = 25_000
const ARKO_MAX_WAIT_MILLIS = 55_000
const ARKO_MAX_TEXT_LENGTH = 60 * 1024
const ARKO_HISTORY_LOOKUP_PAGE_SIZE = 50
const ARKO_HISTORY_LOOKUP_MAX_PAGES = 20
const ARKO_ACTIVE_RUN_STATUSES = new Set(['accepted', 'queued', 'running', 'stream_timeout', 'waiting_tool'])

const ARKO_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{
    type: 'text' as const,
    text: `<data_from_arkme_arko>\n${value.replaceAll(
      '</data_from_arkme_arko>',
      '<\\/data_from_arkme_arko>',
    )}\n</data_from_arkme_arko>`,
  }],
}

function normalizePositiveInteger(value: number | undefined, label: string): number | undefined {
  if (value === undefined || value === 0) return undefined
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} 必须是正整数`)
  return value
}

function normalizeWaitMillis(value: number | undefined): number {
  if (value === undefined || value === 0) return ARKO_DEFAULT_WAIT_MILLIS
  if (!Number.isFinite(value) || value < 1 || value > 55) {
    throw new Error('等待 Arko 回答的秒数需要在 1-55 之间')
  }
  return Math.min(ARKO_MAX_WAIT_MILLIS, Math.trunc(value * 1000))
}

function normalizeText(value: string, hasImages=false): string {
  const text = value.trim()
  if (text === '' && !hasImages) throw new Error('发送给 Arko 的内容不能为空')
  if ([...text].length > ARKO_MAX_TEXT_LENGTH) throw new Error('发送给 Arko 的内容过长')
  return text
}

function arkoTurnUidForToolCall(callId: string): string {
  return stableUidForToolCall('arko-turn', callId)
}

function arkoSummary(result: ArkmeArkoAskResult): Record<string, unknown> {
  const continuation = result.status === 'waiting_user' && result.runUid !== undefined
    ? {
        action: 'continue_with_arkme_arko_ask',
        reply_to_run_uid: result.runUid,
        reply_to_assistant_msg_id: result.assistantMsgId,
      }
    : result.status === 'waiting_tool'
      ? { action: 'client_action_required', supported_by_dsh: false }
      : undefined
  return {
    session_id: result.sessionId,
    user_msg_id: result.userMsgId,
    assistant_msg_id: result.assistantMsgId,
    ...(result.runUid === undefined ? {} : { run_uid: result.runUid }),
    status: result.status,
    terminal: result.terminal,
    timed_out: result.timedOut,
    ...(result.errorMessage === undefined ? {} : { error_message: result.errorMessage }),
    text: result.text,
    ...(result.reasoning === '' ? {} : { reasoning: result.reasoning }),
    ...(result.createdRecordUids.length === 0 ? {} : { created_record_uids: result.createdRecordUids }),
    ...(result.profile === undefined ? {} : {
      arko_profile: {
        display_name: result.profile.displayName,
        version: result.profile.version,
      },
    }),
    ...(result.run === undefined ? {} : { run: arkoRunProjectionJson(result.run) }),
    ...(continuation === undefined ? {} : { next_action: continuation }),
  }
}

function arkoRunProjectionJson(run: NonNullable<ArkmeArkoAskResult['run']>): Record<string, unknown> {
  return {
    run_uid: run.runUid,
    status: run.status,
    retryable: run.retryable,
    ...(run.errorCode === undefined ? {} : { error_code: run.errorCode }),
    ...(run.retryOfRunUid === undefined ? {} : { retry_of_run_uid: run.retryOfRunUid }),
    ...(run.clientAction === undefined ? {} : { client_action: run.clientAction }),
  }
}

function runStatusJson(result: ArkmeArkoRunStatus): Record<string, unknown> {
  return {
    session_id: result.sessionId,
    run_uid: result.runUid,
    status: result.status,
    sequence: result.sequence,
    surface_assistant_msg_id: result.surfaceAssistantMsgId,
    retryable: result.retryable,
    ...(result.errorCode === undefined ? {} : { error_code: result.errorCode }),
    ...(result.retryOfRunUid === undefined ? {} : { retry_of_run_uid: result.retryOfRunUid }),
    ...(result.clientAction === undefined ? {} : { client_action: result.clientAction }),
  }
}

function historyResultJson(item: ArkmeArkoHistoryItem): Record<string, unknown> {
  return {
    session_id: item.sessionId,
    assistant_msg_id: item.messageId,
    text: item.text,
    ...(item.reasoning === '' ? {} : { reasoning: item.reasoning }),
    ...(item.runStatus === undefined ? {} : { run_status: item.runStatus }),
    ...(item.createdRecordUids.length === 0 ? {} : { created_record_uids: item.createdRecordUids }),
  }
}

async function recoverRunResult(
  service: ArkmeArkoToolPort,
  status: ArkmeArkoRunStatus,
  signal: AbortSignal,
): Promise<ArkmeArkoHistoryItem | undefined> {
  if (ARKO_ACTIVE_RUN_STATUSES.has(status.status)) return undefined
  let offset = 0
  for (let pageIndex = 0; pageIndex < ARKO_HISTORY_LOOKUP_MAX_PAGES; pageIndex += 1) {
    const page = await service.arkoHistoryPage(ARKO_HISTORY_LOOKUP_PAGE_SIZE, offset, signal)
    const found = page.items.find(item => item.sessionId === status.sessionId
      && item.role === 'assistant'
      && item.messageId === status.surfaceAssistantMsgId)
    if (found !== undefined) return found
    if (!page.hasMore || page.nextOffset === undefined) return undefined
    offset = page.nextOffset
  }
  return undefined
}

async function recoverableRunStatusJson(
  service: ArkmeArkoToolPort,
  status: ArkmeArkoRunStatus,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const base = runStatusJson(status)
  if (ARKO_ACTIVE_RUN_STATUSES.has(status.status)) return base
  try {
    const result = await recoverRunResult(service, status, signal)
    return {
      ...base,
      result_available: result !== undefined,
      ...(result === undefined ? {
        next_action: { action: 'retry_arkme_arko_run_status' },
      } : {
        result: historyResultJson(result),
        ...(status.status === 'waiting_user' ? {
          next_action: {
            action: 'continue_with_arkme_arko_ask',
            reply_to_run_uid: status.runUid,
            reply_to_assistant_msg_id: status.surfaceAssistantMsgId,
          },
        } : {}),
      }),
    }
  } catch (error) {
    if (signal.aborted) throw error
    return {
      ...base,
      result_available: false,
      next_action: { action: 'retry_arkme_arko_run_status' },
    }
  }
}

function cancelJson(result: ArkmeArkoCancelResult): Record<string, unknown> {
  return {
    session_id: result.sessionId,
    assistant_msg_id: result.assistantMsgId,
    run_uid: result.runUid,
    status: result.status,
  }
}

export function createArkmeArkoProfileToolDefinition(service: ArkmeArkoToolPort): ToolDefinition {
  return defineTool({
    name: 'arkme_arko_profile',
    description: 'Read the signed-in user\'s Arko AI profile. Arko is Arkme\'s conversational cloud AI agent; user custom display names are owned by Arkme cloud AgentDirect.',
    parameters: {},
    output: ARKO_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const profile = await service.arkoProfile(exec.signal)
      return JSON.stringify({
        display_name: profile.displayName,
        version: profile.version,
      }, undefined, 2)
    },
  })
}

export function createArkmeArkoSessionToolDefinition(service: ArkmeArkoToolPort): ToolDefinition {
  return defineTool({
    name: 'arkme_arko_session',
    description: 'Open or restore the current Arko AI conversation session for the signed-in Arkme user. This does not send a message.',
    parameters: {},
    output: ARKO_OUTPUT,
    isConcurrencySafe: () => false,
    async execute(_args, exec) {
      const session = await service.arkoEnsureSession(exec.signal)
      return JSON.stringify({
        session_id: session.sessionId,
        created: session.created,
        name: session.name,
      }, undefined, 2)
    },
  })
}

export function createArkmeArkoAskToolDefinition(service: ArkmeArkoToolPort): ToolDefinition {
  return defineTool({
    name: 'arkme_arko_ask',
    description: 'Ask Arko, Arkme\'s conversational cloud AI agent, to answer or perform Arkme business operations for the signed-in user. When a previous result is waiting_user, continue that same run with both reply_to fields from next_action. This may trigger remote business effects, so call only after an explicit current human request.',
    parameters: {
      text: { type: 'string', description: 'Exact user request; may be empty only with images.' },
      image_file_refs:{type:'array',items:{type:'string'},description:'Ordered opaque image file_refs staged through Arkme Files. Never local paths or URLs; at most 9.'},
      client_turn_uid:{type:'string',description:'Only when retrying an unresolved turn returned by arkme_arko_pending: preserve its exact identity and input.'},
      session_id: { type: 'integer', description: 'Optional existing Arko session_id. When omitted, the latest Arko session is restored or created.' },
      wait_seconds: { type: 'number', description: 'How long to wait for the streamed answer, 1-55 seconds. Defaults to 25. If it times out, use arkme_arko_run_status later.' },
      model_route_key: { type: 'string', description: 'Optional exact Arko model route key. Omit unless it came from a trusted Arkme model selection surface.' },
      reply_to_run_uid: { type: 'string', description: 'For waiting_user only: exact run_uid returned in next_action.' },
      reply_to_assistant_msg_id: { type: 'integer', description: 'For waiting_user only: exact assistant_msg_id returned in next_action.' },
    },
    output: ARKO_OUTPUT,
    async execute(args, exec) {
      const sessionId = normalizePositiveInteger(args.session_id, 'session_id')
      const modelRouteKey = args.model_route_key?.trim() ?? ''
      const replyToRunUid = args.reply_to_run_uid?.trim() ?? ''
      const replyToAssistantMsgId = normalizePositiveInteger(
        args.reply_to_assistant_msg_id,
        'reply_to_assistant_msg_id',
      )
      if ((replyToRunUid === '') !== (replyToAssistantMsgId === undefined)) {
        throw new Error('继续 Arko 任务时必须同时提供 reply_to_run_uid 和 reply_to_assistant_msg_id')
      }
      const result = await service.arkoAsk(normalizeText(args.text ?? '',Boolean(args.image_file_refs?.length)), {
        ...(args.image_file_refs?.length ? {imageFileRefs:args.image_file_refs} : {}),
        ...(sessionId === undefined ? {} : { sessionId }),
        waitMillis: normalizeWaitMillis(args.wait_seconds),
        clientTurnUid: args.client_turn_uid ?? arkoTurnUidForToolCall(String(exec.callId)),
        ...(modelRouteKey === '' ? {} : { modelRouteKey }),
        ...(replyToRunUid === '' ? {} : { replyToRunUid }),
        ...(replyToAssistantMsgId === undefined ? {} : { replyToAssistantMsgId }),
        signal: exec.signal,
      })
      return JSON.stringify(arkoSummary(result), undefined, 2)
    },
  })
}

export function createArkmeArkoRunStatusToolDefinition(service: ArkmeArkoToolPort): ToolDefinition {
  return defineTool({
    name: 'arkme_arko_run_status',
    description: 'Read the status of an Arko AI run returned by arkme_arko_ask. Use this after a timeout, waiting state, or when the user asks for progress. Terminal and waiting_user states also include the recovered Arko result when available.',
    parameters: {
      session_id: { type: 'integer', required: true, description: 'Exact Arko session_id returned by arkme_arko_ask or arkme_arko_session.' },
      run_uid: { type: 'string', required: true, description: 'Exact run_uid returned by arkme_arko_ask.' },
    },
    output: ARKO_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const sessionId = normalizePositiveInteger(args.session_id, 'session_id')
      if (sessionId === undefined) throw new Error('查询 Arko 运行状态时 session_id 不能为空')
      const runUid = args.run_uid.trim()
      if (runUid === '') throw new Error('查询 Arko 运行状态时 run_uid 不能为空')
      const status = await service.arkoRunStatus(sessionId, runUid, exec.signal)
      return JSON.stringify(await recoverableRunStatusJson(service, status, exec.signal), undefined, 2)
    },
  })
}

export function createArkmeArkoCancelToolDefinition(service: ArkmeArkoToolPort): ToolDefinition {
  return defineTool({
    name: 'arkme_arko_cancel',
    description: 'Cancel one active Arko AI run. Call only after the human explicitly asks to stop that Arko task.',
    parameters: {
      session_id: { type: 'integer', required: true, description: 'Exact Arko session_id returned by arkme_arko_ask or arkme_arko_session.' },
      assistant_msg_id: { type: 'integer', required: true, description: 'Exact assistant_msg_id returned by arkme_arko_ask.' },
      run_uid: { type: 'string', required: true, description: 'Exact run_uid returned by arkme_arko_ask.' },
    },
    output: ARKO_OUTPUT,
    async execute(args, exec) {
      const sessionId = normalizePositiveInteger(args.session_id, 'session_id')
      const assistantMsgId = normalizePositiveInteger(args.assistant_msg_id, 'assistant_msg_id')
      if (sessionId === undefined) throw new Error('取消 Arko 任务时 session_id 不能为空')
      if (assistantMsgId === undefined) throw new Error('取消 Arko 任务时 assistant_msg_id 不能为空')
      const runUid = args.run_uid.trim()
      if (runUid === '') throw new Error('取消 Arko 任务时 run_uid 不能为空')
      return JSON.stringify(cancelJson(await service.arkoCancel(sessionId, assistantMsgId, runUid, exec.signal)), undefined, 2)
    },
  })
}

export const arkoProfileToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.arko.profile.v1',
    toolName: 'arkme_arko_profile',
    kind: 'business',
    phase: 'core',
    effect: 'read',
    profiles: ['business', 'hybrid'],
  },
  create: createArkmeArkoProfileToolDefinition,
})

export const arkoSessionToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.arko.session.v1',
    toolName: 'arkme_arko_session',
    kind: 'business',
    phase: 'core',
    effect: 'write',
    grant: 'explicit-user-write',
    profiles: ['business', 'hybrid'],
  },
  create: createArkmeArkoSessionToolDefinition,
})

export const arkoAskToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.arko.ask.v1',
    toolName: 'arkme_arko_ask',
    kind: 'business',
    phase: 'core',
    effect: 'write',
    grant: 'explicit-user-write',
    profiles: ['business', 'hybrid'],
  },
  create: createArkmeArkoAskToolDefinition,
})

export const arkoRunStatusToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.arko.run-status.v1',
    toolName: 'arkme_arko_run_status',
    kind: 'business',
    phase: 'core',
    effect: 'read',
    profiles: ['business', 'hybrid'],
  },
  create: createArkmeArkoRunStatusToolDefinition,
})

export const arkoCancelToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.arko.cancel.v1',
    toolName: 'arkme_arko_cancel',
    kind: 'business',
    phase: 'core',
    effect: 'write',
    grant: 'explicit-user-write',
    profiles: ['business', 'hybrid'],
  },
  create: createArkmeArkoCancelToolDefinition,
})

/** All history modes share the Host owner. Snippets and tool previews are
 * explicitly bounded; export is the complete-original-text transport. */
export function createArkmeArkoHistoryToolDefinition(service: ArkmeArkoToolPort): ToolDefinition {
  return defineTool({
    name: 'arkme_arko_history',
    description: 'Read owned Arko history without changing the active conversation or resuming a run. action=query/search/context/export. Search is literal body text; empty pages can still have a next cursor. Use message_ref from results for original context. Export produces a verified complete Markdown download reference. Body previews may be explicitly truncated; export retains full text.',
    parameters: {
      action: { type: 'string', required: true, description: 'query, search, context or export' },
      keyword: { type: 'string', description: 'Literal keyword for search; not regex or semantic search.' },
      cursor: { type: 'string', description: 'Exact opaque nextCursor. Keep all filters unchanged.' },
      message_ref: { type: 'string', description: 'Opaque messageRef returned by query/search; required for context.' },
      role: { type: 'string', description: 'Optional user or assistant filter.' },
      start_at_ms: { type: 'integer', description: 'Inclusive history order time in Unix milliseconds.' },
      end_at_ms: { type: 'integer', description: 'Exclusive history order time in Unix milliseconds.' },
    },
    output: ARKO_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.action === 'export') return JSON.stringify(await service.arkoExport(exec.signal))
      const compact = (item: ArkmeArkoHistoryItem) => ({ messageRef: item.messageRef, role: item.role,
        text: item.text.slice(0, 2000), textTruncated: item.text.length > 2000, createdAtMillis: item.createdAtMillis,
        orderAtMillis: item.orderAtMillis, status: item.status, runStatus: item.runStatus, createdRecordUids: item.createdRecordUids,
        ...(item.contentBlocks?.some(block => block.kind === 'image') ? { images: item.contentBlocks.filter(block => block.kind === 'image').map(block => ({ fileName: block.fileName, mimeType: block.mimeType, size: block.size })) } : {}) })
      if (args.action === 'context') {
        const window = await service.arkoContext({ messageRef: args.message_ref ?? '', before: 2, after: 2 }, exec.signal)
        return JSON.stringify({ ...window, items: window.items.map(compact) })
      }
      if (args.action !== 'query' && args.action !== 'search') throw new Error('action 必须为 query/search/context/export')
      if (args.role !== undefined && args.role !== 'user' && args.role !== 'assistant') throw new Error('role 必须为 user 或 assistant')
      const query = { limit: 10, ...(args.cursor ? { cursor: args.cursor } : {}), ...(args.role ? { role: args.role as 'user' | 'assistant' } : {}),
        ...(args.start_at_ms === undefined ? {} : { startAtMillis: args.start_at_ms }), ...(args.end_at_ms === undefined ? {} : { endAtMillis: args.end_at_ms }) }
      if (args.action === 'search') return JSON.stringify(await service.arkoSearch({ ...query, keyword: args.keyword ?? '' }, exec.signal))
      const page = await service.arkoMessages(query, exec.signal)
      return JSON.stringify({ ...page, items: page.items.map(compact) })
    },
  })
}
export const arkoHistoryToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.arko.history.v1', toolName: 'arkme_arko_history', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: createArkmeArkoHistoryToolDefinition,
})
export const arkoModelsToolModule=defineArkmeCoreToolModule({
 meta:{id:'business.arko.models.v1',toolName:'arkme_arko_models',kind:'business',phase:'core',effect:'read',profiles:['business','hybrid']},
 create:(service:ArkmeArkoToolPort)=>defineTool({name:'arkme_arko_models',description:'Read published Arko model routes and their actual image input capability before selecting a model.',parameters:{},output:ARKO_OUTPUT,isConcurrencySafe:()=>true,
 async execute(_args,exec){return JSON.stringify(await service.arkoModelCatalog(exec.signal))}}),
})
export const arkoPendingToolModule=defineArkmeCoreToolModule({
 meta:{id:'business.arko.pending.v1',toolName:'arkme_arko_pending',kind:'business',phase:'core',effect:'read',profiles:['business','hybrid']},
 create:(service:ArkmeArkoToolPort)=>defineTool({name:'arkme_arko_pending',description:'Read unresolved Arko turns in the current account. To confirm one, call arkme_arko_ask with the original text, file_refs, model or reply target and client_turn_uid; never create a replacement turn.',parameters:{},output:ARKO_OUTPUT,isConcurrencySafe:()=>true,
 async execute(){return JSON.stringify((await service.arkoPendingTurns()).map(turn=>({client_turn_uid:turn.clientTurnUid,session_id:turn.sessionId,text:turn.text,image_file_refs:turn.images?.map(file=>file.fileRef) ?? [],model_route_key:turn.modelRouteKey,reply_to_run_uid:turn.replyToRunUid,reply_to_assistant_msg_id:turn.replyToAssistantMsgId})))}}),
})

export const arkoToolModules = [
 arkoModelsToolModule,arkoPendingToolModule,
  arkoProfileToolModule,
  arkoHistoryToolModule,
  arkoSessionToolModule,
  arkoAskToolModule,
  arkoRunStatusToolModule,
  arkoCancelToolModule,
] as const
