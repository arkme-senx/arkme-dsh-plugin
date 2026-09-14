import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn(), recordChanged: vi.fn(), chatChanged: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/ui-controller.js', () => ({ arkmeUi: mocks }))
import { recordDeletionClientPort } from '../src/client/record-deletion-port.js'
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.clearAllMocks() })
describe('selection deletion transport lifetime', () => {
 it('keeps a healthy selection alive beyond thirty seconds and returns its result', async () => {
  vi.useFakeTimers()
  const timeout=vi.spyOn(AbortSignal,'timeout')
  const controller=new AbortController()
  const result={items:[{recordUid:'a',version:4,result:'deleted'}]}
  mocks.call.mockImplementation((_op,_args,signal)=>new Promise((resolve,reject)=>{
   signal.addEventListener('abort',()=>reject(signal.reason),{once:true})
   setTimeout(()=>resolve(result),45000)
  }))
  const pending=recordDeletionClientPort.delete('source',['ref'],controller.signal)
  const assertion=expect(pending).resolves.toEqual(result)
  await vi.advanceTimersByTimeAsync(45000)
  await assertion
  expect(timeout).not.toHaveBeenCalled()
  expect(mocks.call.mock.calls[0][2]).toBe(controller.signal)
  expect(mocks.recordChanged).toHaveBeenCalledOnce()
 })
 it('preserves explicit cancellation and invalidates readers',async()=>{
  const controller=new AbortController()
  mocks.call.mockImplementation((_op,_args,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})))
  const pending=recordDeletionClientPort.delete('source',['ref'],controller.signal)
  const assertion=expect(pending).rejects.toThrow('cancelled')
  controller.abort(new Error('cancelled'))
  await assertion
  expect(mocks.call).toHaveBeenCalledOnce();expect(mocks.chatChanged).toHaveBeenCalledOnce()
 })
})
