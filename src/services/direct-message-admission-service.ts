import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { directMessageAdmissionMessage, type ArkmeDirectMessageAdmission, type ArkmeDirectMessageAdmissionPort } from '../direct-message-admission.js'
import type { SourceService } from './source-service.js'
import { ArkmePluginError, ArkmeUpstreamResponseError, objectValue, type ServiceRuntime, type ArkmeRemoteRequestOptions } from './service.js'

export function projectDirectMessageAdmission(value: unknown, chatSessionUid: string): ArkmeDirectMessageAdmission {
  const data = objectValue(value)
  const validStatus = (value: unknown) => value === 1 || value === 2
  const validRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  if (chatSessionUid === '' || data.chat_session_uid !== chatSessionUid
    || !validStatus(data.own_refusal_status) || !validStatus(data.counterpart_refusal_status)
    || !validRevision(data.own_revision) || !validRevision(data.counterpart_revision)
    || (data.own_refusal_status === 1 && data.own_revision === 0)
    || (data.counterpart_refusal_status === 1 && data.counterpart_revision === 0)
    || typeof data.refusal_creation_enabled !== 'boolean') {
    throw new ArkmePluginError('arkme-response-invalid', '私聊发送状态无效，请刷新后重试', false, 502)
  }
  const ownRefused = data.own_refusal_status === 1
  const counterpartRefused = data.counterpart_refusal_status === 1
  const state = ownRefused ? (counterpartRefused ? 4 : 2) : (counterpartRefused ? 3 : 1)
  if (data.admission_state !== state || data.can_send !== (state === 1)) {
    throw new ArkmePluginError('arkme-response-invalid', '私聊发送状态不一致，请刷新后重试', false, 502)
  }
  const states = ['allowed', 'refused_by_self', 'refused_by_counterpart', 'mutually_refused'] as const
  return { state: states[state - 1]!, canSend: state === 1, ownRefused, counterpartRefused,
    ownRevision: data.own_revision, counterpartRevision: data.counterpart_revision,
    refusalCreationEnabled: data.refusal_creation_enabled }
}

export class ArkmeDirectMessageAdmissionError extends ArkmePluginError {
  constructor(code: string, readonly admission: ArkmeDirectMessageAdmission, message?: string) {
    super(code, message ?? (code === 'arkme-code-2002' ? '拒收状态已变化，请确认最新状态后重试' : directMessageAdmissionMessage(admission)), false, 409)
  }
}

function admissionResponseError(error: unknown, chatSessionUid: string, expectedCode: string): unknown {
  if (!(error instanceof ArkmeUpstreamResponseError) || error.code !== expectedCode) return error
  try {
    const projection = projectDirectMessageAdmission(error.responseData, chatSessionUid)
    if (expectedCode === 'arkme-code-1004' && projection.canSend) return error
    return new ArkmeDirectMessageAdmissionError(error.code, projection)
  } catch { return error }
}

/** Only new receiver-visible Chat messages use this adapter, never reads, reedit or historical mirroring. */
export async function postChatMessageCreation<T>(
  runtime: Pick<ServiceRuntime, 'authenticatedChatPost'>,
  path: '/api/v1/chats/records/send' | '/api/v1/chats/records/forward' | '/api/v1/chats/extensions/children/create',
  body: Record<string, unknown>, session?: ArkmeSessionCredentials, signal?: AbortSignal,
  options?: ArkmeRemoteRequestOptions,
): Promise<T> {
  try { return await runtime.authenticatedChatPost<T>(path, body, session, signal, ...(options === undefined ? [] : [options])) }
  catch (error) { throw admissionResponseError(error, String(body.chat_session_uid ?? ''), 'arkme-code-1004') }
}

/** Chat remains the fact and eligibility owner; source references enforce account binding on the Host. */
export class DirectMessageAdmissionService implements ArkmeDirectMessageAdmissionPort {
  constructor(private readonly runtime: Pick<ServiceRuntime, 'requireSession' | 'authenticatedChatPost'>,
    private readonly source: Pick<SourceService, 'openSourceRef'>) {}

  private async context(sourceRef: string) {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'private_chat') throw new ArkmePluginError('source-invalid', '仅真人私聊支持拒收消息', false)
    return { session, source }
  }

  async directMessageAdmission(sourceRef: string, signal?: AbortSignal): Promise<ArkmeDirectMessageAdmission> {
    const { session, source } = await this.context(sourceRef)
    const data = await this.runtime.authenticatedChatPost('/api/v1/chats/direct-message-admission/query',
      { chat_session_uid: source.ownerRef }, session, signal, { lane: 'interactive-read', bypassCache: true })
    return projectDirectMessageAdmission(data, source.ownerRef)
  }

  async setDirectMessageRefusal(sourceRef: string, refused: boolean, expectedRevision: number, signal?: AbortSignal): Promise<ArkmeDirectMessageAdmission> {
    if (typeof refused !== 'boolean' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new ArkmePluginError('request-invalid', '拒收设置参数无效', false)
    }
    const { session, source } = await this.context(sourceRef)
    try {
      const data = await this.runtime.authenticatedChatPost('/api/v1/chats/direct-message-refusal/set',
        { chat_session_uid: source.ownerRef, status: refused ? 1 : 2, expected_revision: expectedRevision }, session, signal)
      return projectDirectMessageAdmission(data, source.ownerRef)
    } catch (error) {
      if (error instanceof ArkmeUpstreamResponseError && error.code === 'arkme-code-1004') {
        let projection: ArkmeDirectMessageAdmission | undefined
        try { projection = projectDirectMessageAdmission(error.responseData, source.ownerRef) } catch { /* Not this Handler's business body. */ }
        if (projection?.refusalCreationEnabled === false) {
          throw new ArkmeDirectMessageAdmissionError(error.code, projection, '新增拒收暂未开放，已有拒收仍可解除')
        }
      }
      throw admissionResponseError(error, source.ownerRef, 'arkme-code-2002')
    }
  }
}
