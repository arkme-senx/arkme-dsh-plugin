import { expect, it, vi } from 'vitest'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import type { ArkmeService } from '../src/arkme-service.js'
it('passes the account fence, bounded query input and cancellation to the read-only owner', async () => {
  const result = { accountScope: 'production:42', items: [] }, signal = new AbortController().signal
  const service = { recordThoughts: vi.fn(async () => result) } as unknown as ArkmeService
  const value = await dispatchArkmeHostOperation(service, 'record.thoughts.query', {
    expectedAccountScope: 'production:42', recordUids: ['note'], userId: 7, generate: true,
  }, undefined, undefined, undefined, undefined, signal)
  expect(value).toBe(result)
  expect(service.recordThoughts).toHaveBeenCalledExactlyOnceWith('production:42', ['note'], signal)
})
it('passes only the signed conversation references to the chat thought reader', async () => {
  const result = { accountScope: 'production:42', items: [] }, signal = new AbortController().signal
  const service = { chatThoughts: vi.fn(async () => result) } as unknown as ArkmeService
  expect(await dispatchArkmeHostOperation(service, 'chat.thoughts.query', {
    expectedAccountScope: 'production:42', sourceRef: 'signed-source', messageActionRefs: ['signed-message'], chatSessionUid: 'untrusted', rel_uid: 'untrusted',
  }, undefined, undefined, undefined, undefined, signal)).toBe(result)
  expect(service.chatThoughts).toHaveBeenCalledExactlyOnceWith('production:42', 'signed-source', ['signed-message'], signal)
})
