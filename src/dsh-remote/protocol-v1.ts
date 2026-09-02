import { DshRemoteError } from './errors.js'
import {
  DSH_REMOTE_MAX_FRAME_BYTES,
  DSH_REMOTE_PROTOCOL,
  DSH_REMOTE_PROTOCOL_MAJOR,
  type DshRemoteOperation,
  type DshRemoteRequest,
} from './types.js'

const OPERATIONS = new Set<DshRemoteOperation>([
  'workspace.list', 'model.list', 'session.model.get', 'session.model.select',
  'session.create', 'session.list', 'session.history', 'session.prompt', 'session.cancel',
  'interaction.question.respond', 'interaction.approval.respond', 'snapshot.get', 'capabilities.get',
])
const REQUEST_KEYS = new Set([
  'protocol', 'protocol_major', 'kind', 'request_ref', 'host_generation', 'issued_at', 'execute_before', 'operation', 'body',
])

export interface DshRemoteRequestIdentity {
  requestRef: string
  hostGeneration: number
  operation: DshRemoteOperation
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DshRemoteError('REMOTE_REQUEST_INVALID', '远控请求必须为对象')
  }
  return value as Record<string, unknown>
}

function ref(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new DshRemoteError('REMOTE_REQUEST_INVALID', `${name} 无效`)
  }
  return value
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new DshRemoteError('REMOTE_REQUEST_INVALID', `${name} 无效`)
  }
  return value
}

function assertOnly(source: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys)
  if (Object.keys(source).some(key => !allowed.has(key))) {
    throw new DshRemoteError('REMOTE_REQUEST_INVALID', '远控操作 body 包含未定义字段')
  }
}

function bodyRef(source: Record<string, unknown>, key: string, required = true): void {
  const value = source[key]
  if (value === undefined && !required) return
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
    throw new DshRemoteError('REMOTE_REQUEST_INVALID', `${key} 无效`)
  }
}

function pageFields(source: Record<string, unknown>): void {
  if (source.cursor !== undefined && (typeof source.cursor !== 'string' || source.cursor.length < 1 || source.cursor.length > 512)) {
    throw new DshRemoteError('REMOTE_REQUEST_INVALID', 'cursor 无效')
  }
  if (source.limit !== undefined && (!Number.isSafeInteger(source.limit) || Number(source.limit) < 1 || Number(source.limit) > 100)) {
    throw new DshRemoteError('REMOTE_REQUEST_INVALID', 'limit 无效')
  }
}

function validateOperationBody(operation: DshRemoteOperation, source: Record<string, unknown>): void {
  switch (operation) {
    case 'capabilities.get': assertOnly(source, []); return
    case 'snapshot.get':
    case 'workspace.list': assertOnly(source, ['cursor', 'limit']); pageFields(source); return
    case 'session.list':
      assertOnly(source, ['workspace_ref', 'cursor', 'limit']); bodyRef(source, 'workspace_ref', false); pageFields(source); return
    case 'model.list': assertOnly(source, []); return
    case 'session.model.get':
      assertOnly(source, ['session_ref']); bodyRef(source, 'session_ref'); return
    case 'session.model.select':
      assertOnly(source, ['session_ref', 'model_provider', 'model_id', 'reasoning_effort'])
      bodyRef(source, 'session_ref')
      bodyRef(source, 'model_provider', false)
      bodyRef(source, 'model_id', false)
      bodyRef(source, 'reasoning_effort', false)
      if ((source.model_provider === undefined) !== (source.model_id === undefined)) {
        throw new DshRemoteError('REMOTE_REQUEST_INVALID', '模型 Provider 和模型 ID 必须同时提供')
      }
      if (source.model_provider === undefined) {
        throw new DshRemoteError('REMOTE_REQUEST_INVALID', '必须提供模型 Provider 和模型 ID')
      }
      return
    case 'session.create': {
      assertOnly(source, ['workspace_ref', 'model_provider', 'model_id', 'reasoning_effort'])
      bodyRef(source, 'workspace_ref')
      bodyRef(source, 'model_provider', false)
      bodyRef(source, 'model_id', false)
      bodyRef(source, 'reasoning_effort', false)
      if ((source.model_provider === undefined) !== (source.model_id === undefined)) {
        throw new DshRemoteError('REMOTE_REQUEST_INVALID', '模型 Provider 和模型 ID 必须同时提供')
      }
      if (source.reasoning_effort !== undefined && source.model_provider === undefined) {
        throw new DshRemoteError('REMOTE_REQUEST_INVALID', '推理等级必须与模型选择同时提供')
      }
      return
    }
    case 'session.history':
      assertOnly(source, ['session_ref', 'before_seq', 'limit']); bodyRef(source, 'session_ref');
      if (source.before_seq !== undefined && (!Number.isSafeInteger(source.before_seq) || Number(source.before_seq) < 1)) {
        throw new DshRemoteError('REMOTE_REQUEST_INVALID', 'before_seq 无效')
      }
      pageFields(source); return
    case 'session.prompt': {
      assertOnly(source, ['session_ref', 'mode', 'content']); bodyRef(source, 'session_ref')
      if (source.mode !== 'queue' && source.mode !== 'steer') throw new DshRemoteError('REMOTE_REQUEST_INVALID', 'mode 无效')
      const content = object(source.content)
      if (content.type !== 'text') throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '首版远控只支持有界普通文本')
      assertOnly(content, ['type', 'text'])
      if (typeof content.text !== 'string' || content.text.length < 1 || content.text.length > 16_000) {
        throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '首版远控只支持有界普通文本')
      }
      return
    }
    case 'session.cancel': assertOnly(source, ['session_ref']); bodyRef(source, 'session_ref'); return
    case 'interaction.question.respond':
      assertOnly(source, ['session_ref', 'interaction_rpc_ref', 'answer']); bodyRef(source, 'session_ref');
      bodyRef(source, 'interaction_rpc_ref')
      if (!Object.hasOwn(source, 'answer')) throw new DshRemoteError('REMOTE_REQUEST_INVALID', 'answer 缺失')
      return
    case 'interaction.approval.respond':
      assertOnly(source, ['session_ref', 'interaction_rpc_ref', 'approval_id', 'outcome']); bodyRef(source, 'session_ref')
      bodyRef(source, 'interaction_rpc_ref'); bodyRef(source, 'approval_id')
      if (source.outcome !== 'allowed-once' && source.outcome !== 'rejected') {
        throw new DshRemoteError('REMOTE_REQUEST_INVALID', 'outcome 无效')
      }
  }
}

/** Correlation-only parse used to return a typed rejection for a valid envelope identity. */
export function dshRemoteRequestIdentity(value: unknown): DshRemoteRequestIdentity | undefined {
  try {
    const source = object(value)
    if (source.protocol !== DSH_REMOTE_PROTOCOL || source.protocol_major !== DSH_REMOTE_PROTOCOL_MAJOR
      || source.kind !== 'request' || typeof source.operation !== 'string'
      || !OPERATIONS.has(source.operation as DshRemoteOperation)) return undefined
    return {
      requestRef: ref(source.request_ref, 'request_ref'),
      hostGeneration: positiveInteger(source.host_generation, 'host_generation'),
      operation: source.operation as DshRemoteOperation,
    }
  } catch {
    return undefined
  }
}

export function parseDshRemoteRequest(
  value: unknown,
  options: { expectedHostGeneration: number; nowMillis?: number },
): DshRemoteRequest {
  const encoded = Buffer.from(JSON.stringify(value))
  if (encoded.length > DSH_REMOTE_MAX_FRAME_BYTES) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '远控请求超过 60KiB')
  const source = object(value)
  if (Object.keys(source).some(key => !REQUEST_KEYS.has(key))) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '远控请求包含未定义字段')
  if (source.protocol !== DSH_REMOTE_PROTOCOL || source.protocol_major !== DSH_REMOTE_PROTOCOL_MAJOR) {
    throw new DshRemoteError('REMOTE_PROTOCOL_UNSUPPORTED', '远控协议版本不受支持')
  }
  if (source.kind !== 'request') throw new DshRemoteError('REMOTE_REQUEST_INVALID', '远控消息类型无效')
  const hostGeneration = positiveInteger(source.host_generation, 'host_generation')
  if (hostGeneration !== options.expectedHostGeneration) {
    throw new DshRemoteError('HOST_GENERATION_STALE', '请求指向的 Host 实例已经失效', true)
  }
  const issuedAt = positiveInteger(source.issued_at, 'issued_at')
  const executeBefore = positiveInteger(source.execute_before, 'execute_before')
  const now = options.nowMillis ?? Date.now()
  if (executeBefore < now) throw new DshRemoteError('COMMAND_EXPIRED', '远控命令已经过期')
  if (issuedAt > now + 30_000 || executeBefore > now + 5 * 60_000 || executeBefore < issuedAt) {
    throw new DshRemoteError('REMOTE_REQUEST_INVALID', '远控命令时间窗口无效')
  }
  if (typeof source.operation !== 'string' || !OPERATIONS.has(source.operation as DshRemoteOperation)) {
    throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '远控操作不受支持')
  }
  const body = object(source.body)
  validateOperationBody(source.operation as DshRemoteOperation, body)
  return {
    protocol: DSH_REMOTE_PROTOCOL,
    protocol_major: DSH_REMOTE_PROTOCOL_MAJOR,
    kind: 'request',
    request_ref: ref(source.request_ref, 'request_ref'),
    host_generation: hostGeneration,
    issued_at: issuedAt,
    execute_before: executeBefore,
    operation: source.operation as DshRemoteOperation,
    body,
  }
}
