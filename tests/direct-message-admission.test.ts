import { describe, expect, it, vi } from 'vitest'
import { DirectMessageAdmissionService, projectDirectMessageAdmission, postChatMessageCreation } from '../src/services/direct-message-admission-service.js'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { ArkmeUpstreamResponseError, type ServiceRuntime } from '../src/services/service.js'

const body = { chat_session_uid: 'internal-chat', admission_state: 3, can_send: false, refusal_creation_enabled: true,
  own_refusal_status: 2, own_revision: 0, counterpart_refusal_status: 1, counterpart_revision: 1, updated_at: 1 }

describe('direct message admission boundary', () => {
  it('rejects a missing rollout permission instead of implicitly enabling creation', () => {
    expect(() => projectDirectMessageAdmission({ ...body, refusal_creation_enabled: undefined }, 'internal-chat')).toThrow()
  })
  it('keeps rollout permission separate from message admission and generic permission errors', async () => {
    const closed = { ...body, counterpart_refusal_status: 2, counterpart_revision: 0,
      admission_state: 1, can_send: true, refusal_creation_enabled: false }
    expect(projectDirectMessageAdmission(closed, 'internal-chat')).toMatchObject({ canSend: true, refusalCreationEnabled: false })
    const error = new ArkmeUpstreamResponseError('arkme-code-1004', 'permission', false, 502, closed)
    const runtime = { requireSession: async () => ({ userId: 42 }), authenticatedChatPost: vi.fn().mockRejectedValue(error) } as unknown as ServiceRuntime
    const service = new DirectMessageAdmissionService(runtime, { openSourceRef: async () => ({ kind: 'private_chat', ownerRef: 'internal-chat' }) } as never)
    await expect(service.setDirectMessageRefusal('source', true, 0)).rejects.toMatchObject({
      code: 'arkme-code-1004', retryable: false, admission: { canSend: true, refusalCreationEnabled: false },
    })
    const other = new ArkmeUpstreamResponseError('arkme-code-1004', 'account permission', false, 502, {})
    vi.mocked(runtime.authenticatedChatPost).mockRejectedValue(other)
    await expect(service.setDirectMessageRefusal('source', true, 0)).rejects.toBe(other)
  })
  it.each([[0, 0, 1, true], [1, 0, 2, false], [0, 1, 3, false], [1, 1, 4, false]])('projects directional facts %s/%s', (own, peer, state, canSend) => {
    expect(projectDirectMessageAdmission({ ...body, own_refusal_status: own === 0 ? 2 : 1, counterpart_refusal_status: peer === 0 ? 2 : 1,
      own_revision: own, counterpart_revision: peer, admission_state: state, can_send: canSend }, 'internal-chat').canSend).toBe(canSend)
  })
  it('projects only validated business facts without internal identifiers', () => {
    const result = projectDirectMessageAdmission(body, 'internal-chat')
    expect(result).toEqual({ state: 'refused_by_counterpart', canSend: false,
      ownRefused: false, counterpartRefused: true, ownRevision: 0, counterpartRevision: 1, refusalCreationEnabled: true })
    expect(JSON.stringify(result)).not.toContain('internal-chat')
    expect(() => projectDirectMessageAdmission(body, 'other-chat')).toThrow()
    expect(() => projectDirectMessageAdmission({ ...body, can_send: true }, 'internal-chat')).toThrow()
    expect(() => projectDirectMessageAdmission({ ...body, own_revision: -1 }, 'internal-chat')).toThrow()
  })

  it('keeps permission code, returns safe business data and never retries', async () => {
    const upstream = new ArkmeUpstreamResponseError('arkme-code-1004', 'denied', false, 502, body)
    const runtime = { authenticatedChatPost: async () => { throw upstream } } as unknown as ServiceRuntime
    await expect(postChatMessageCreation(runtime, '/api/v1/chats/records/send', { chat_session_uid: 'internal-chat' }))
      .rejects.toMatchObject({ code: 'arkme-code-1004', retryable: false,
        admission: { state: 'refused_by_counterpart' } })
    await expect(postChatMessageCreation(runtime, '/api/v1/chats/records/send', { chat_session_uid: 'other-chat' }))
      .rejects.toBe(upstream)
  })

  it('resolves the current-account source and delegates own revision to Chat, including CAS conflicts', async () => {
    const openSourceRef = vi.fn(async () => ({ kind: 'private_chat', ownerRef: 'internal-chat' }))
    const authenticatedChatPost = vi.fn().mockResolvedValue(body)
    const owner = new DirectMessageAdmissionService({ requireSession: async () => ({ userId: 42 }), authenticatedChatPost } as never, { openSourceRef } as never)
    const snapshot = await owner.directMessageAdmission('opaque-source')
    expect(openSourceRef).toHaveBeenCalledWith('opaque-source', 42)
    const service = { directMessageAdmission: owner.directMessageAdmission.bind(owner), setDirectMessageRefusal: owner.setDirectMessageRefusal.bind(owner) }
    await expect(dispatchArkmeHostOperation(service as never, 'chat.direct-message-admission', { sourceRef: 'opaque-source' })).resolves.toEqual(snapshot)
    await expect(owner.setDirectMessageRefusal('opaque-source', true, 0)).resolves.toEqual(snapshot)
    expect(authenticatedChatPost).toHaveBeenLastCalledWith('/api/v1/chats/direct-message-refusal/set',
      { chat_session_uid: 'internal-chat', status: 1, expected_revision: 0 }, { userId: 42 }, undefined)
    authenticatedChatPost.mockRejectedValueOnce(new ArkmeUpstreamResponseError('arkme-code-2002', 'conflict', true, 502, body))
    await expect(owner.setDirectMessageRefusal('opaque-source', true, 0)).rejects.toMatchObject({ code: 'arkme-code-2002', retryable: false, admission: snapshot })
    await expect(dispatchArkmeHostOperation(service as never, 'chat.direct-message-refusal.set', { sourceRef: 'opaque-source', refused: 'true', expectedRevision: 0 })).rejects.toThrow()
    await expect(owner.setDirectMessageRefusal('opaque-source', true, -1)).rejects.toThrow()
    openSourceRef.mockResolvedValueOnce({ kind: 'group_chat', ownerRef: 'internal-chat' })
    await expect(owner.directMessageAdmission('opaque-group')).rejects.toThrow(/真人私聊/)
  })

  it('provides public SDK discovery and rejects unsupported providers without making a mutation', async () => {
    const calls: string[] = []
    let supported = true
    const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
      const request = JSON.parse(String(init?.body))
      calls.push(request.operation)
      return new Response(JSON.stringify({ ok: true, value: request.operation === 'provider.capabilities'
        ? { contractVersion: 1, features: { directMessageAdmission: supported } }
        : projectDirectMessageAdmission(body, 'internal-chat') }))
    } })
    await expect(sdk.directMessageAdmission('opaque')).resolves.toMatchObject({ canSend: false })
    await sdk.setDirectMessageRefusal('opaque', false, 0)
    supported = false
    await expect(sdk.setDirectMessageRefusal('opaque', true, 0)).rejects.toMatchObject({ body: { code: 'CAPABILITY_UNSUPPORTED', retryable: false } })
    expect(calls.filter(name => name === 'chat.direct-message-refusal.set')).toHaveLength(1)
  })
})
