import { beforeEach, expect, it, vi } from 'vitest'
import { arkoLifecycleOperation } from '../src/client/arko-lifecycle-operation.js'
import { callArkme } from '../src/client/api.js'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const command = { action: 'delete' as const, operationUid: 'intent', targets: [{ messageRef: 'message', expectedVersion: 3 }] }
const fact = (state = 'active', version = 3) => ({ messageRef: 'message', messageKey: '1:2', state, version, lastOperationUid: '', deletedAtMillis: 0, purgeAtMillis: 0 })
const signal = new AbortController().signal
beforeEach(() => vi.mocked(callArkme).mockReset())
it('reconciles a transport failure read-only; the original version cannot prove success', async () => {
  const run = arkoLifecycleOperation(command)
  vi.mocked(callArkme).mockRejectedValueOnce(Error('timeout'))
    .mockResolvedValueOnce({ items: [fact()] } as never)
    .mockResolvedValueOnce({ items: [fact('deleted', 4)] } as never)
  await expect(run(signal)).rejects.toThrow('timeout')
  expect((await run(signal)).complete).toBe(false)
  expect((await run(signal)).complete).toBe(true)
  expect(vi.mocked(callArkme).mock.calls.map(c => c[0])).toEqual(['arko.lifecycle.change', 'arko.lifecycle.query', 'arko.lifecycle.query'])
})
it('does not report success for a later opposite intent or silently adopt its version', async () => {
  const run = arkoLifecycleOperation(command)
  vi.mocked(callArkme).mockResolvedValueOnce({ items: [{ ...fact(), result: 'unknown' }] } as never)
    .mockResolvedValueOnce({ items: [fact('active', 5)] } as never)
    .mockResolvedValueOnce({ items: [{ ...fact('active', 5), result: 'version_conflict' }] } as never)
  expect((await run(signal)).complete).toBe(false)
  expect((await run(signal)).complete).toBe(false)
  expect((await run(signal)).complete).toBe(false)
  expect(vi.mocked(callArkme).mock.calls[2]).toEqual(['arko.lifecycle.change', command, signal])
})
it('keeps missing targets unresolved instead of treating partial results as success', async () => {
  const run = arkoLifecycleOperation({ ...command, targets: [...command.targets, { messageRef: 'other', expectedVersion: 0 }] })
  vi.mocked(callArkme).mockResolvedValueOnce({ items: [{ ...fact('deleted', 4), result: 'applied' }] } as never)
    .mockResolvedValueOnce({ items: [fact('deleted', 4)] } as never)
  expect((await run(signal)).complete).toBe(false)
  expect((await run(signal)).complete).toBe(false)
  expect(vi.mocked(callArkme).mock.calls.filter(c => c[0] === 'arko.lifecycle.change')).toHaveLength(1)
})
it('does not confirm a late result after cancellation', async () => {
  const controller = new AbortController(), run = arkoLifecycleOperation(command)
  vi.mocked(callArkme).mockImplementation(async () => { controller.abort(); return { items: [{ ...fact('deleted', 4), result: 'applied' }] } as never })
  await expect(run(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})
