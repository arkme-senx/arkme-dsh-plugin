import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call,
  ArkmeClientError: class extends Error { constructor(readonly body: { code: string }) { super(body.code) } },
}))
const policy = { version: 1, textMessagesVersion: 1, admissionRecoveryVersion: 1,
  maxFileBytes: 100, maxImageBytes: 100, maxAttachments: 9 } as const
afterEach(() => { vi.resetModules(); mocks.call.mockReset() })

it('uses bootstrap capabilities immediately without another request', async () => {
  const { fileSendPolicySnapshot } = await import('../src/client/file-send-admission.js')
  expect(fileSendPolicySnapshot('test:1', policy)).toBe(policy)
  expect(mocks.call).not.toHaveBeenCalled()
})

it('keeps an unresolved legacy probe off the synchronous sending path', async () => {
  let resolve!: (value: typeof policy) => void
  mocks.call.mockImplementation(() => new Promise(done => { resolve = done }))
  const owner = await import('../src/client/file-send-admission.js')
  const first = owner.fileSendPolicy('test:1')
  expect(owner.fileSendPolicy('test:1')).toBe(first)
  expect(owner.fileSendPolicySnapshot('test:1')).toBeUndefined()
  expect(owner.fileSendPolicySnapshot('test:1', policy)).toBe(policy)
  resolve(policy); await first
  expect(owner.fileSendPolicySnapshot('test:1')).toBe(policy)
  expect(owner.fileSendPolicySnapshot('test:2')).toBeUndefined()
  expect(mocks.call).toHaveBeenCalledOnce()
})

it('does not let a late previous-account probe replace the current capability', async () => {
  let first!: (value: typeof policy) => void
  const legacy = { ...policy, textMessagesVersion: undefined }
  mocks.call.mockImplementationOnce(() => new Promise(done => { first = done })).mockResolvedValueOnce(legacy)
  const owner = await import('../src/client/file-send-admission.js')
  const pending = owner.fileSendPolicy('test:1')
  await owner.fileSendPolicy('test:2')
  first(policy); await pending
  expect(owner.fileSendPolicySnapshot('test:2')).toBe(legacy)
  expect(owner.fileSendPolicySnapshot('test:1')).toBeUndefined()
})

it('retains explicit recovery negotiation and the original frozen submission', async () => {
  mocks.call.mockImplementation(async operation => operation === 'files.capabilities' ? policy : { accepted: true })
  const { retryFileSendAdmission } = await import('../src/client/file-send-admission.js')
  const params = { recordUid: 'original', relationUid: 'original-relation', sourceRef: 'source', textContent: 'original body' }
  await retryFileSendAdmission({ scope: 'scope', params, task: {} as never }, 'test:1')
  expect(mocks.call).toHaveBeenLastCalledWith('files.send', { ...params, recoverAdmission: true })
})

it('does not replay an uncertain submission when the old Host cannot reconcile it', async () => {
  mocks.call.mockResolvedValue({ version: 1 })
  const { retryFileSendAdmission } = await import('../src/client/file-send-admission.js')
  await expect(retryFileSendAdmission({ scope: 'scope', params: {}, task: {} as never }, 'test:1')).rejects.toThrow('无法安全核对')
  expect(mocks.call).toHaveBeenCalledOnce()
})
