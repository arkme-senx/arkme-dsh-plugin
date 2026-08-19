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

function normalizeText(value: string): string {
  const text = value.trim()
  if (text === '') throw new Error('发送给 Arko 的内容不能为空')
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
      text: { type: 'string', required: true, description: 'Exact user request to send to Arko.' },
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
      const result = await service.arkoAsk(normalizeText(args.text), {
        ...(sessionId === undefined ? {} : { sessionId }),
        waitMillis: normalizeWaitMillis(args.wait_seconds),
        clientTurnUid: arkoTurnUidForToolCall(String(exec.callId)),
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

export const arkoToolModules = [
  arkoProfileToolModule,
  arkoSessionToolModule,
  arkoAskToolModule,
  arkoRunStatusToolModule,
  arkoCancelToolModule,
] as const
