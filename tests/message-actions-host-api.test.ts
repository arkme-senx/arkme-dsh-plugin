import { once } from 'node:events'
import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { ArkmeService } from '../src/arkme-service.js'
import { createArkmeHostApi, dispatchArkmeHostOperation } from '../src/host-api.js'

describe('owner-neutral message action Host operations', () => {
  it('passes only opaque conversation and message references to the owner service', async () => {
    const service = {
      copyMessageActionsLink: vi.fn(async () => ({ sid: 'sid-1', url: 'https://jotmo.example/s/sid-1' })),
      forwardMessageActions: vi.fn(async () => ({ sourceRef: 'target-ref', itemUid: 'record-1', status: 1, localState: 'synced' })),
    } as unknown as ArkmeService
    const signal = new AbortController().signal
    const browserOwnerGuess = { ownerKind: 'agent', sessionId: 88, chatSessionUid: 'must-not-cross' }

    await dispatchArkmeHostOperation(service, 'message-actions.copy-link', {
      conversationRef: ' conversation-ref ', actionRefs: [' action-1 ', 'action-2'], ...browserOwnerGuess,
    }, undefined, undefined, undefined, undefined, signal)
    await dispatchArkmeHostOperation(service, 'message-actions.forward', {
      conversationRef: ' conversation-ref ', actionRefs: [' action-1 '], targetSourceRef: ' target-ref ',
      requestId: ' request-1 ', recordUid: ' record-1 ', commentRecordUid: ' comment-1 ', commentText: ' 附言 ',
      sendAtMillis: 1_786_000_123_000,
      ...browserOwnerGuess,
    }, undefined, undefined, undefined, undefined, signal)

    expect(service.copyMessageActionsLink).toHaveBeenCalledWith(
      'conversation-ref', ['action-1', 'action-2'], { signal },
    )
    expect(service.forwardMessageActions).toHaveBeenCalledWith(
      'conversation-ref', ['action-1'], {
        targetSourceRef: 'target-ref', requestId: 'request-1', recordUid: 'record-1',
        commentRecordUid: 'comment-1', commentText: '附言', sendAtMillis: 1_786_000_123_000, signal,
      },
    )
  })

  it('requires the current DSH Browser origin before creating links or forwarding', async () => {
    const service = {
      copyMessageActionsLink: vi.fn(async () => ({ sid: 'sid-1', url: 'https://jotmo.example/s/sid-1' })),
      forwardMessageActions: vi.fn(async () => ({ sourceRef: 'target-ref', itemUid: 'record-1', status: 1, localState: 'synced' })),
    } as unknown as ArkmeService
    const server = createServer(createArkmeHostApi(service, { expectedPort: 3080, allowNonLoopback: false }))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server address missing')
    try {
      const copyResponse = await fetch(`http://127.0.0.1:${String(address.port)}/arkme-self/api`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'message-actions.copy-link', params: { conversationRef: 'conversation', actionRefs: ['action'] } }),
      })
      const forwardResponse = await fetch(`http://127.0.0.1:${String(address.port)}/arkme-self/api`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'message-actions.forward', params: {
          conversationRef: 'conversation', actionRefs: ['action'], targetSourceRef: 'target',
          requestId: 'request', recordUid: 'record', sendAtMillis: 1_786_000_123_000,
        } }),
      })
      expect(copyResponse.status).toBe(403)
      expect(forwardResponse.status).toBe(403)
      expect(service.copyMessageActionsLink).not.toHaveBeenCalled()
      expect(service.forwardMessageActions).not.toHaveBeenCalled()
    } finally {
      server.close()
      await once(server, 'close')
    }
  })

  it('accepts a valid owner capability batch beyond the unrelated standard request limit', async () => {
    const service = {
      copyMessageActionsLink: vi.fn(async () => ({ sid: 'sid-1', url: 'https://jotmo.example/s/sid-1' })),
    } as unknown as ArkmeService
    const server = createServer(createArkmeHostApi(service, { expectedPort: 3080, allowNonLoopback: false }))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server address missing')
    try {
      const prefix = 'arkme-owner-message-action-v1.'
      const actionRef = `${prefix}${'a'.repeat((1024 * 1024) - prefix.length)}`
      const response = await fetch(`http://127.0.0.1:${String(address.port)}/arkme-self/api`, {
        method: 'POST', headers: { Origin: 'http://127.0.0.1:3080', 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'message-actions.copy-link', params: { conversationRef: 'conversation', actionRefs: [actionRef] } }),
      })
      expect(response.status).toBe(200)
      expect(service.copyMessageActionsLink).toHaveBeenCalledWith('conversation', [actionRef], { signal: expect.any(AbortSignal) })
    } finally {
      server.close()
      await once(server, 'close')
    }
  })

  it('rejects an oversized owner capability ref before copy or forward reaches the owner service', async () => {
    const service = {
      copyMessageActionsLink: vi.fn(async () => ({ sid: 'sid-1', url: 'https://jotmo.example/s/sid-1' })),
      forwardMessageActions: vi.fn(async () => ({ sourceRef: 'target-ref', itemUid: 'record-1', status: 1, localState: 'synced' })),
    } as unknown as ArkmeService
    const server = createServer(createArkmeHostApi(service, { expectedPort: 3080, allowNonLoopback: false }))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server address missing')
    const oversizedRef = 'a'.repeat((1024 * 1024) + 1)
    try {
      const copyResponse = await fetch(`http://127.0.0.1:${String(address.port)}/arkme-self/api`, {
        method: 'POST', headers: { Origin: 'http://127.0.0.1:3080', 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'message-actions.copy-link', params: { conversationRef: 'conversation', actionRefs: [oversizedRef] } }),
      })
      const forwardResponse = await fetch(`http://127.0.0.1:${String(address.port)}/arkme-self/api`, {
        method: 'POST', headers: { Origin: 'http://127.0.0.1:3080', 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'message-actions.forward', params: {
          conversationRef: 'conversation', actionRefs: [oversizedRef], targetSourceRef: 'target',
          requestId: 'request', recordUid: 'record', sendAtMillis: 1_786_000_123_000,
        } }),
      })

      expect(copyResponse.status).toBe(400)
      await expect(copyResponse.json()).resolves.toMatchObject({
        ok: false, error: { code: 'message-action-ref-invalid', retryable: false },
      })
      expect(forwardResponse.status).toBe(400)
      await expect(forwardResponse.json()).resolves.toMatchObject({
        ok: false, error: { code: 'message-action-ref-invalid', retryable: false },
      })
      expect(service.copyMessageActionsLink).not.toHaveBeenCalled()
      expect(service.forwardMessageActions).not.toHaveBeenCalled()
    } finally {
      server.close()
      await once(server, 'close')
    }
  })
})
