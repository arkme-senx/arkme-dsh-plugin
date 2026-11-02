// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))
import { UnifiedModelPicker } from '../src/client/UnifiedModelPicker.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { unifiedModelStore } from '../src/client/use-unified-models.js'
import type { ModelChoice } from '../src/model-directory.js'
const available: ModelChoice = { id: 'arko-one', name: '模型 A', channel: 'Arkme 托管', identifier: 'model-a', arko: 'managed-ai/a', pricing: '每千 Token 输入 0.2 积分' }
const other: ModelChoice = { id: 'recording-two', name: '模型 B', channel: '百炼', identifier: 'model-b', recording: 'dashscope/b' }
let host: HTMLDivElement, root: Root
function button(text: string) { const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text); if (!b) throw Error(`missing ${text}`); return b }
const click = (text: string) => act(async () => button(text).click())
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  unifiedModelStore.activate(undefined); arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'production', userId: 42 })
  mocks.callArkme.mockReset().mockImplementation(async (op: string) => {
    if (op === 'models.directory') return { accountScope: 'production:42', observedAt: 1, models: [available, other], failures: [] }
    if (op === 'account.points.query') return { accountScope: 'production:42', unit: 'ai_points', availablePoints: '123.45', reservedPoints: '7.9' }
    if (op === 'billing.quota') return { availableNanoCny: '1234500000', totalNanoCny: '1234500000', reservedNanoCny: '0', currency: 'CNY' }
    if (op === 'billing.products') return { items: [] }
    throw Error(`Unexpected ${op}`)
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); unifiedModelStore.activate(undefined); arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'production' }); vi.unstubAllGlobals() })
it('shows all connected models and real points while keeping unconfirmed scene routes selectable without invoking them', async () => {
  const apply = vi.fn(async () => true), close = vi.fn()
  await act(async () => root.render(<UnifiedModelPicker scene="arko" scopeLabel="Arko 后续新任务" models={[available]} currentId={available.id} onApply={apply} onClose={close}/>))
  expect(document.body.textContent).toContain('123.45'); expect(document.body.textContent).toContain('7.9')
  const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
  expect(options).toHaveLength(2)
  await act(async () => options.find(b => b.textContent?.includes('模型 B'))!.click())
  expect(document.querySelector('[aria-selected="true"]')?.textContent).toContain('模型 B')
  await click('使用此模型')
  expect(apply).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('执行路由尚未接通')
  await act(async () => options.find(b => b.textContent?.includes('模型 A'))!.click())
  await click('使用此模型'); expect(apply).toHaveBeenCalledWith(available, undefined); expect(close).toHaveBeenCalledOnce()
})
it('preserves model choice when recharge is opened and closed, without creating a payment order', async () => {
  await act(async () => root.render(<UnifiedModelPicker scene="arko" scopeLabel="Arko" models={[available]} currentId={available.id} onApply={async () => true} onClose={() => {}}/>))
  await click('充值')
  expect(document.querySelector('[aria-label="关闭充值弹窗"]')).not.toBeNull()
  await act(async () => (document.querySelector('[aria-label="关闭充值弹窗"]') as HTMLButtonElement).click())
  expect(document.querySelector('[aria-selected="true"]')?.textContent).toContain('模型 A')
  expect(mocks.callArkme.mock.calls.some(([op]) => op === 'billing.order.create')).toBe(false)
})
it('keeps the selector and recharge entry usable when points fail and retains a rejected choice', async () => {
  const original = mocks.callArkme.getMockImplementation()!
  mocks.callArkme.mockImplementation(async (op, ...args) => op === 'account.points.query' ? Promise.reject(Error('积分暂时不可读')) : original(op, ...args))
  const close = vi.fn()
  await act(async () => root.render(<UnifiedModelPicker scene="arko" scopeLabel="Arko" models={[available]} currentId={available.id} onApply={async () => { throw Error('服务端拒绝切换') }} onClose={close}/>))
  expect(button('充值').disabled).toBe(false); expect(document.querySelectorAll('[role="option"]')).toHaveLength(2)
  await click('使用此模型'); expect(close).not.toHaveBeenCalled(); expect(document.querySelector('[role="alert"]')?.textContent).toContain('拒绝切换')
})
