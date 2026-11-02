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
const available: ModelChoice = { id: 'arko-one', name: '模型 A', channel: 'Arkme 托管', identifier: 'internal-model-a', arko: 'managed-ai/a', billing: 'arkme-points', pricing: '每千 Token 输入 0.2 积分' }
const other: ModelChoice = { id: 'recording-two', name: '模型 B', channel: '百炼', identifier: 'model-b', recording: 'dashscope/b' }
const alternative: ModelChoice = { id: 'shared-three', name: '模型 C', channel: 'Arkme 托管', identifier: 'model-c', arko: 'managed-ai/c', recording: 'dashscope/c', billing: 'arkme-points' }
const reasoningModel: ModelChoice = { ...available, recording: 'dashscope/a', reasoning: { defaultEffort: 'high', efforts: [
  { id: 'off', name: '关闭' }, { id: 'low', name: '低' }, { id: 'high', name: '高' }, { id: 'max', name: '最高' },
] } }
let host: HTMLDivElement, root: Root
function button(text: string) { const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text || b.getAttribute('aria-label') === text); if (!b) throw Error('missing ' + text); return b }
const click = (text: string) => act(async () => button(text).click())
const option = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(b => b.textContent?.includes(name))!
const choose = (name: string) => act(async () => option(name).click())
const slider = () => document.querySelector<HTMLInputElement>('input[type="range"]')!
const rangeInput = (value: number) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider(), String(value))
  slider().dispatchEvent(new Event('input', { bubbles: true }))
})
const pointer = (type: string) => act(async () => slider().dispatchEvent(new Event(type, { bubbles: true })))
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  unifiedModelStore.activate(undefined); arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'production', userId: 42 })
  mocks.callArkme.mockReset().mockImplementation(async (op: string) => {
    if (op === 'models.directory') return { accountScope: 'production:42', observedAt: 1, models: [available, other, alternative], failures: [] }
    if (op === 'account.points.query') return { accountScope: 'production:42', unit: 'ai_points', availablePoints: '123.45', reservedPoints: '7.9' }
    if (op === 'billing.quota') return { availableNanoCny: '1234500000', totalNanoCny: '1234500000', reservedNanoCny: '0', currency: 'CNY' }
    if (op === 'billing.products') return { items: [] }
    throw Error('Unexpected ' + op)
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); unifiedModelStore.activate(undefined); arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'production' }); vi.unstubAllGlobals() })

it('groups the full directory by channel and switches chat models in one click without invoking unconfirmed routes', async () => {
  const apply = vi.fn(async () => true), close = vi.fn()
  await act(async () => root.render(<UnifiedModelPicker scene="arko" scopeLabel="Arko 后续新任务" models={[available]} currentId={available.id} onApply={apply} onClose={close}/>))
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(3)
  expect([...document.querySelectorAll('.arkme-unified-model-list>.arkme-unified-model-group')].map(group => group.getAttribute('aria-label'))).toEqual(['Arkme 托管', '百炼'])
  expect(document.querySelector('input')).toBeNull()
  expect(document.body.textContent).not.toMatch(/刷新|目录更新|当前场景可用|internal-model-a|7.9|使用此模型|取消/)
  const account = document.querySelector('[aria-label="Arkme 积分账户"]')!
  expect(account.parentElement?.className).toBe('arkme-unified-model-group-title')
  expect(account.closest('.arkme-unified-model-group')?.getAttribute('aria-label')).toBe('Arkme 托管')
  expect(account.textContent).toContain('· 123.45 积分')
  expect(document.querySelectorAll('[aria-label="Arkme 积分账户"]')).toHaveLength(1)
  expect(document.querySelector('[aria-label="百炼"] .arkme-unified-model-account')).toBeNull()
  expect(account.closest('[aria-hidden]')).toBeNull()
  expect(account.closest('[role="listbox"]')).toBeNull()
  await choose('模型 B')
  expect(apply).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
  expect(option('模型 A').getAttribute('aria-selected')).toBe('true')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('支持情况待确认')
  await choose('模型 C')
  expect(apply).toHaveBeenCalledExactlyOnceWith(alternative, undefined)
  expect(close).toHaveBeenCalledOnce()
})
it('keeps recording selection separate from the explicit generation action', async () => {
  const apply = vi.fn(async () => true)
  await act(async () => root.render(<UnifiedModelPicker scene="recording" scopeLabel="录音总结与时间轴" models={[other]} currentId={other.id} onApply={apply} onClose={() => {}}/>))
  await choose('模型 C')
  expect(option('模型 C').getAttribute('aria-selected')).toBe('true')
  expect(apply).not.toHaveBeenCalled()
  await click('确认并生成')
  expect(apply).toHaveBeenCalledExactlyOnceWith(alternative, undefined)
})
it('puts pricing, version and reserved points behind their own views without exposing internal identifiers', async () => {
  await act(async () => root.render(<UnifiedModelPicker scene="arko" scopeLabel="Arko 后续新任务" models={[available]} currentId={available.id} onApply={async () => true} onClose={() => {}}/>))
  expect(document.body.textContent).not.toContain('每千 Token')
  await click('计费详情')
  expect(document.querySelector('[role="listbox"]')).toBeNull()
  expect(document.body.textContent).toContain('每千 Token 输入 0.2 积分')
  expect(document.body.textContent).toContain('具体版本')
  expect(document.body.textContent).not.toContain('internal-model-a')
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="返回模型"]')!.click())
  await click('Arkme 积分 123.45')
  expect(document.body.textContent).toContain('已预占 7.9 积分')
})
it('preserves a recording draft when recharge is opened and closed without creating an order', async () => {
  const apply = vi.fn(async () => true)
  await act(async () => root.render(<UnifiedModelPicker scene="recording" scopeLabel="录音" models={[other]} currentId={other.id} onApply={apply} onClose={() => {}}/>))
  await choose('模型 C'); await click('充值')
  expect(document.querySelector('[aria-label="关闭充值弹窗"]')).not.toBeNull()
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭充值弹窗"]')!.click())
  expect(option('模型 C').getAttribute('aria-selected')).toBe('true')
  expect(apply).not.toHaveBeenCalled()
  expect(mocks.callArkme.mock.calls.some(([op]) => op === 'billing.order.create')).toBe(false)
})
it('keeps the actual chat selection on rejection and offers retry only for failed reads', async () => {
  const original = mocks.callArkme.getMockImplementation()!
  mocks.callArkme.mockImplementation(async (op, ...args) => op === 'account.points.query' ? Promise.reject(Error('积分暂时不可读')) : original(op, ...args))
  const close = vi.fn()
  await act(async () => root.render(<UnifiedModelPicker scene="arko" scopeLabel="Arko" models={[available]} currentId={available.id} onApply={async () => { throw Error('服务端拒绝切换') }} onClose={close}/>))
  expect(button('充值').disabled).toBe(false)
  await choose('模型 C')
  expect(close).not.toHaveBeenCalled()
  expect(option('模型 A').getAttribute('aria-selected')).toBe('true')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('拒绝切换')
  const reads = mocks.callArkme.mock.calls.filter(([op]) => op === 'models.directory').length
  await click('重试')
  expect(mocks.callArkme.mock.calls.filter(([op]) => op === 'models.directory')).toHaveLength(reads + 1)
})
it('does not apply while navigating with arrow keys and serializes a pending activation', async () => {
  let complete!: (accepted: boolean) => void
  const apply = vi.fn(() => new Promise<boolean>(resolve => { complete = resolve }))
  const close = vi.fn()
  await act(async () => root.render(<UnifiedModelPicker scene="arko" scopeLabel="Arko" models={[available]} currentId={available.id} onApply={apply} onClose={close}/>))
  expect(document.activeElement).toBe(option('模型 A'))
  await act(async () => option('模型 A').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  expect(document.activeElement).toBe(option('模型 C')); expect(apply).not.toHaveBeenCalled()
  await choose('模型 C'); await choose('模型 C')
  expect(apply).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled()
  await act(async () => complete(true)); expect(close).toHaveBeenCalledOnce()
})

it.each([
  { billing: 'arkme-points' as const, channel: 'Arkme 托管', hint: '使用 Arkme 积分', explanation: '充值增加的是 Arkme 积分账户余额' },
  { billing: 'provider-account' as const, channel: 'DeepSeek Account', hint: '外部账户结算', explanation: '充值 Arkme 积分不会增加该账户余额' },
  { billing: undefined, channel: '百炼', hint: '计费归属待确认', explanation: '不能据 Arkme 积分余额判断是否可用' },
])('distinguishes $hint from the explicitly named Arkme credits account', async ({ billing, channel, hint, explanation }) => {
  const model: ModelChoice = { id: 'billing-example', name: '示例模型', identifier: 'billing-example', channel,
    arko: 'example/model', ...(billing ? { billing } : {}) }
  await act(async () => root.render(<UnifiedModelPicker scene="arko" scopeLabel="Arko" models={[model]} currentId={model.id} onApply={async () => true} onClose={() => {}}/>))
  expect(button('计费详情').textContent).toContain(hint)
  const account = document.querySelector('[aria-label="Arkme 积分账户"]')!
  expect(account.textContent).toContain('· 123.45 积分')
  expect(account.closest('.arkme-unified-model-group')?.getAttribute('aria-label')).toBe('Arkme 托管')
  expect(account.querySelector('[aria-label="充值 Arkme 积分"]')).not.toBeNull()
  await click('计费详情')
  expect(document.body.textContent).toContain(explanation)
})

it('omits Arkme account controls when only external models are present', async () => {
  const original = mocks.callArkme.getMockImplementation()!
  mocks.callArkme.mockImplementation(async (op, ...args) => op === 'models.directory'
    ? { accountScope: 'production:42', observedAt: 1, models: [other], failures: [] } : original(op, ...args))
  await act(async () => root.render(<UnifiedModelPicker scene="recording" scopeLabel="录音" models={[other]} currentId={other.id} onApply={async () => true} onClose={() => {}}/>))
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(1)
  expect(document.querySelector('[aria-label="Arkme 积分账户"]')).toBeNull()
  expect(document.body.textContent).not.toMatch(/123.45|充值|用量/)
})

it('opens usage from the managed header without selecting a model or starting generation', async () => {
  const apply = vi.fn(async () => true)
  await act(async () => root.render(<UnifiedModelPicker scene="recording" scopeLabel="录音" models={[other]} currentId={other.id} onApply={apply} onClose={() => {}}/>))
  await click('Arkme 积分用量')
  expect(document.body.textContent).toContain('Arkme 积分与用量')
  expect(document.body.textContent).toContain('已预占 7.9 积分')
  expect(apply).not.toHaveBeenCalled()
  await click('返回模型')
  expect(option('模型 B').getAttribute('aria-selected')).toBe('true')
  expect(document.querySelectorAll('[aria-label="Arkme 积分账户"]')).toHaveLength(1)
})

it('previews a drag and saves only the released effort while keeping the panel open', async () => {
  const apply = vi.fn(async () => true), close = vi.fn()
  await act(async () => root.render(<UnifiedModelPicker scene="arko" scopeLabel="Arko" models={[reasoningModel]} currentId={available.id} currentEffort="high" onApply={apply} onClose={close}/>))
  expect(document.querySelector('select')).toBeNull()
  expect(slider().getAttribute('aria-valuetext')).toBe('高')
  await pointer('pointerdown'); await rangeInput(1); await rangeInput(3)
  expect(slider().getAttribute('aria-valuetext')).toBe('最高')
  expect(apply).not.toHaveBeenCalled()
  await pointer('pointerup'); await pointer('lostpointercapture')
  expect(apply).toHaveBeenCalledExactlyOnceWith(reasoningModel, 'max')
  expect(close).not.toHaveBeenCalled()
  expect(slider().value).toBe('3')
})

it('cancels a drag without saving or changing the original effort', async () => {
  const apply = vi.fn(async () => true)
  await act(async () => root.render(<UnifiedModelPicker scene="arko" scopeLabel="Arko" models={[reasoningModel]} currentId={available.id} currentEffort="high" onApply={apply} onClose={() => {}}/>))
  await pointer('pointerdown'); await rangeInput(0); await pointer('pointercancel'); await pointer('pointerup')
  expect(slider().value).toBe('2')
  expect(slider().getAttribute('aria-valuetext')).toBe('高')
  expect(apply).not.toHaveBeenCalled()
})

it('saves repeated keyboard adjustments once on key release and supports resetting to default', async () => {
  const apply = vi.fn(async () => true), close = vi.fn()
  await act(async () => root.render(<UnifiedModelPicker scene="arko" scopeLabel="Arko" models={[reasoningModel]} currentId={available.id} currentEffort="high" onApply={apply} onClose={close}/>))
  await act(async () => slider().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
  await rangeInput(1); await rangeInput(0)
  expect(apply).not.toHaveBeenCalled()
  await act(async () => slider().dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true })))
  expect(apply).toHaveBeenCalledExactlyOnceWith(reasoningModel, 'off')
  await click('恢复默认思考强度')
  expect(apply).toHaveBeenLastCalledWith(reasoningModel, undefined)
  expect(slider().getAttribute('aria-valuetext')).toBe('默认')
  expect(slider().value).toBe('2')
  expect(close).not.toHaveBeenCalled()
})

it('restores the actual effort and shows an error when an effort change is rejected', async () => {
  const apply = vi.fn(async () => false), close = vi.fn()
  await act(async () => root.render(<UnifiedModelPicker scene="arko" scopeLabel="Arko" models={[reasoningModel]} currentId={available.id} currentEffort="high" onApply={apply} onClose={close}/>))
  await click('低')
  expect(apply).toHaveBeenCalledExactlyOnceWith(reasoningModel, 'low')
  expect(slider().value).toBe('2')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('思考强度保存失败')
  expect(close).not.toHaveBeenCalled()
})

it('keeps recording effort changes local until generation is explicitly confirmed', async () => {
  const apply = vi.fn(async () => true)
  await act(async () => root.render(<UnifiedModelPicker scene="recording" scopeLabel="录音" models={[reasoningModel]} currentId={available.id} currentEffort="high" onApply={apply} onClose={() => {}}/>))
  await click('最高')
  expect(slider().value).toBe('3')
  expect(apply).not.toHaveBeenCalled()
  await click('确认并生成')
  expect(apply).toHaveBeenCalledExactlyOnceWith(reasoningModel, 'max')
})

it('shows only advertised effort stops and does not imply an unknown default level', async () => {
  const model: ModelChoice = { ...reasoningModel, reasoning: { efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }] } }
  await act(async () => root.render(<UnifiedModelPicker scene="arko" scopeLabel="Arko" models={[model]} currentId={available.id} onApply={async () => true} onClose={() => {}}/>))
  expect([...document.querySelectorAll('.arkme-unified-model-effort-labels button')].map(button => button.textContent)).toEqual(['低', '高'])
  expect(document.querySelector('.arkme-unified-model-effort-track.is-unresolved')).not.toBeNull()
  expect(slider().getAttribute('aria-valuetext')).toBe('默认')
})

it('serializes pending effort saves and skips unchanged effort', async () => {
  let complete!: (accepted: boolean) => void
  const apply = vi.fn(() => new Promise<boolean>(resolve => { complete = resolve }))
  await act(async () => root.render(<UnifiedModelPicker scene="arko" scopeLabel="Arko" models={[reasoningModel]} currentId={available.id} currentEffort="high" onApply={apply} onClose={() => {}}/>))
  await click('高'); expect(apply).not.toHaveBeenCalled()
  await click('低'); await click('最高')
  expect(slider().disabled).toBe(true)
  expect(apply).toHaveBeenCalledOnce()
  await act(async () => complete(true))
  expect(slider().disabled).toBe(false)
  expect(document.querySelector('.arkme-unified-model-panel')).not.toBeNull()
})
