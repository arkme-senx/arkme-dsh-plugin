import { beforeEach, expect, it, vi } from 'vitest'
const call = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
import { createNativeTextMarkTransport } from '../src/client/harness-text-marks.js'
const source = JSON.stringify(['dsh-native', 42, 'arkme:runtime:session'])
const ref = JSON.stringify([source, 'key', '正文', { eventSeq: 2, role: 'user' }])
const mark = (id: string) => ({ id, mine: true, actorId: 42, actorName: '你', anchor: {}, state: 'available' })
beforeEach(() => { call.mockReset() })
it('keeps cloud marks when removing a legacy local mark and orders both owner revisions', async () => {
  const transport = createNativeTextMarkTransport()
  let local = { revision: 1, accessible: true, items: [mark('local:old')] }
  call.mockImplementation(async (op, args) => {
    if (op === 'native-chat.local-mark.list') return [{ actionRef: ref, snapshot: local }]
    if (op === 'native-chat.local-mark.change') { local = { revision: 2, accessible: true, items: [] }; return local }
    if (args.request.action === 'capabilities') return { supported: true, maxLength: 2000 }
    if (args.request.action === 'contexts') return [{ messageRef: 'remote', canonicalText: '正文' }]
    if (args.request.action === 'changes') return []
    return [{ messageRef: 'remote', revision: 10, accessible: true, items: [mark('cloud')] }]
  })
  const signal = new AbortController().signal
  await transport.capabilities(source, signal)
  const before = await transport.list(source, [ref], signal)
  expect(before[0]!.snapshot.revision).toBe(11)
  const removed = await transport.change(source, ref, { kind: 'remove', annotationId: 'local:old', operationId: 'remove' }, signal)
  expect(removed.revision).toBe(12)
  expect(removed.items.map(m => m.id)).toEqual(['cloud'])
  expect((await transport.list(source, [ref], signal))[0]!.snapshot).toEqual(removed)
})
it('does not silently write local marks when cloud capability discovery fails', async () => {
  call.mockRejectedValue(new Error('offline'))
  await expect(createNativeTextMarkTransport().capabilities(source, new AbortController().signal)).rejects.toThrow('offline')
  expect(call).toHaveBeenCalledTimes(1)
})
