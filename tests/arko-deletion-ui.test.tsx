// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ArkoMessageDeletionDialog } from '../src/client/ArkoMessageDeletion.js'
import { callArkme } from '../src/client/api.js'
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: vi.fn() }))
let root: Root, host: HTMLDivElement
const fact = (state = 'active', version = state === 'active' ? 0 : 1) => ({ messageRef: 'opaque', messageKey: '88:1', version, state, deletedAtMillis: 1000, purgeAtMillis: Date.now() + 2592000000, lastOperationUid: '' })
const click = async (text: string) => { await act(async () => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === text); expect(b, text).toBeDefined(); b!.click() }) }
const writes = () => vi.mocked(callArkme).mock.calls.filter(c => c[0] === 'arko.lifecycle.change')
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.mocked(callArkme).mockReset() })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
it('keeps the original confirmation controls and reads an uncertain outcome without replaying it', async () => {
  const changed = vi.fn(), closed = vi.fn()
  let current = fact()
  vi.mocked(callArkme).mockImplementation(async op => {
    if (op === 'arko.lifecycle.query') return { revision: 0, items: [current] } as never
    if (op === 'arko.lifecycle.change') return { items: [{ ...fact(), result: 'unknown' }] } as never
    throw Error(op)
  })
  await act(async () => root.render(<ArkoMessageDeletionDialog messageRefs={['opaque']} onClose={closed} onFacts={changed} />))
  expect(callArkme).not.toHaveBeenCalled()
  await click('确认删除')
  expect(closed).not.toHaveBeenCalled()
  expect([...document.querySelectorAll('button')].map(b => b.textContent)).toEqual(['取消', '确认删除'])
  expect(document.body.textContent).not.toMatch(/核对状态|同步删除|重新尝试未删除项/)
  await click('确认删除')
  expect(writes()).toHaveLength(1)
  expect(closed).not.toHaveBeenCalled()
  expect(changed).toHaveBeenLastCalledWith([expect.objectContaining({ state: 'active', version: 0 })])
  current = fact('deleted')
  await click('确认删除')
  expect(writes()).toHaveLength(1)
  expect(closed).toHaveBeenCalledOnce()
})
it('cancel does not query or write', async () => {
  const closed = vi.fn()
  await act(async () => root.render(<ArkoMessageDeletionDialog messageRefs={['opaque']} onClose={closed} onFacts={vi.fn()} />))
  await click('取消')
  expect(closed).toHaveBeenCalledOnce(); expect(callArkme).not.toHaveBeenCalled()
})
it('does not partially delete a selection blocked by a running message', async () => {
  vi.mocked(callArkme).mockResolvedValue({ revision: 0, items: [fact(), { ...fact(), messageRef: 'running', deleteBlockedReason: 'generating' }] } as never)
  await act(async () => root.render(<ArkoMessageDeletionDialog messageRefs={['opaque', 'running']} onClose={vi.fn()} onFacts={vi.fn()} />))
  await click('确认删除')
  expect(writes()).toHaveLength(0)
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('仍在生成')
})
it('closes after deleting remaining active targets when another selected message was already deleted', async () => {
  const closed = vi.fn()
  vi.mocked(callArkme).mockImplementation(async op => op === 'arko.lifecycle.query'
    ? { revision: 0, items: [fact(), { ...fact('deleted'), messageRef: 'already-deleted' }] } as never
    : { items: [{ ...fact('deleted'), result: 'applied' }] } as never)
  await act(async () => root.render(<ArkoMessageDeletionDialog messageRefs={['opaque', 'already-deleted']} onClose={closed} onFacts={vi.fn()} />))
  await click('确认删除')
  expect(writes()[0]![1]).toMatchObject({ targets: [{ messageRef: 'opaque', expectedVersion: 0 }] })
  expect(closed).toHaveBeenCalledOnce()
})
it('aborts pending work on unmount and never applies late facts', async () => {
  const changed = vi.fn(), closed = vi.fn()
  let finish!: (value: unknown) => void
  vi.mocked(callArkme).mockImplementation(() => new Promise(resolve => { finish = resolve }) as never)
  await act(async () => root.render(<ArkoMessageDeletionDialog messageRefs={['opaque']} onClose={closed} onFacts={changed} />))
  await click('确认删除')
  expect(document.querySelector<HTMLButtonElement>('[data-arkme-confirm-dialog] button')!.disabled).toBe(true)
  const signal = vi.mocked(callArkme).mock.calls[0]![2]!
  await act(async () => root.render(null))
  expect(signal.aborted).toBe(true)
  await act(async () => finish({ revision: 1, items: [fact('deleted')] }))
  expect(changed).not.toHaveBeenCalled(); expect(closed).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0)
})
