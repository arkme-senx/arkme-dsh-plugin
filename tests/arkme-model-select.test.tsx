// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))
import { ArkmeModelSelect, type ArkmeModelDirectory } from '../src/client/ArkmeModelSelect.js'

let root: Root
let host: HTMLDivElement
let state: ReturnType<ArkmeModelDirectory['store']['getSnapshot']>
let directory: ArkmeModelDirectory
const listeners = new Set<() => void>()
const quota = { availableNanoCny: '123450000000', totalNanoCny: '123450000000', reservedNanoCny: '0', currency: 'CNY' }
function button(text: string) {
  const found = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(text))
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}
const click = async (text: string) => { await act(async () => { button(text).click() }) }
const render = async (available = true, locked = false) => {
  await act(async () => { root.render(<ArkmeModelSelect directory={directory} available={available} locked={locked} />) })
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  state = { current: { provider: 'deepseek', model: 'flash' }, groups: [
    { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'flash', name: 'DeepSeek-V4-Flash' }] },
    { id: 'arkme-managed', name: 'Arkme', models: [{ id: 'pro', name: 'DeepSeek V4 Pro', reasoning: {
      efforts: [{ id: 'high', name: '高' }, { id: 'low', name: '低' }], defaultEffort: 'high',
    } }] },
  ], failures: [], status: 'ready', error: null }
  directory = {
    store: { getSnapshot: () => state, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, update: vi.fn() },
    load: vi.fn(async () => undefined),
    select: vi.fn(async selection => { state = { ...state, current: selection }; listeners.forEach(listener => listener()) }),
  }
  mocks.callArkme.mockReset().mockImplementation(async operation => {
    if (operation === 'billing.quota') return quota
    if (operation === 'billing.products') return { items: [] }
    throw new Error('Unexpected operation: ' + operation)
  })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); listeners.clear(); vi.unstubAllGlobals() })

it('loads balance only on opening, shows the blue recharge entry, and opens existing checkout without selecting a model', async () => {
  await render()
  expect(mocks.callArkme).not.toHaveBeenCalled()
  await click('DeepSeek-V4-Flash')
  expect(host.textContent).toContain('Arkme · ¥123.45')
  expect(host.textContent).not.toContain('余额计费')
  expect(button('去充值').closest('.arkme-model-balance-actions')).not.toBeNull()
  expect(mocks.callArkme.mock.calls.filter(call => call[0] === 'billing.quota')).toHaveLength(1)
  await click('去充值')
  expect(directory.select).not.toHaveBeenCalled()
  expect(host.querySelector('[role="menu"]')).toBeNull()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('当前余额¥123.45')
  expect(mocks.callArkme).toHaveBeenCalledWith('billing.products')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭充值弹窗')
  await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(host.querySelector('.arkme-model-trigger'))
})

it('uses the shared model owner for selection and advertised reasoning effort; Escape restores focus', async () => {
  await render(); await click('DeepSeek-V4-Flash'); await click('DeepSeek V4 Pro')
  expect(directory.select).toHaveBeenCalledWith({ provider: 'arkme-managed', model: 'pro' })
  await click('DeepSeek V4 Pro'); await click('思考强度'); await click('低')
  expect(directory.select).toHaveBeenLastCalledWith({ provider: 'arkme-managed', model: 'pro', reasoningEffort: 'low' })
  await click('DeepSeek V4 Pro')
  await act(async () => { button('去充值').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(host.querySelector('[role="menu"]')).toBeNull()
  expect(document.activeElement).toBe(host.querySelector('.arkme-model-trigger'))
})

it('keeps recharge usable on quota failure, retries quota, and retains the selected model on selection failure', async () => {
  mocks.callArkme.mockRejectedValueOnce(new Error('offline'))
  await render(); await click('DeepSeek-V4-Flash')
  expect(host.textContent).toContain('余额读取失败'); expect(button('去充值')).toBeDefined()
  await click('重试'); expect(host.textContent).toContain('¥123.45')
  directory.select = vi.fn(async () => {
    state = { ...state, error: '选择失败', status: 'error' }; listeners.forEach(listener => listener()); throw new Error('failed')
  })
  await click('DeepSeek V4 Pro')
  expect(host.querySelector('[role="menu"]')).not.toBeNull()
  expect(host.textContent).toContain('选择失败')
  expect(state.current?.provider).toBe('deepseek')
})

it('does not load unavailable sessions, honors locked state, and cancels quota work on unmount', async () => {
  await render(false); expect(directory.load).not.toHaveBeenCalled(); expect(host.querySelector('button')).toBeNull()
  await render(true, true); expect(button('DeepSeek-V4-Flash').disabled).toBe(true)
  await render(); await click('DeepSeek-V4-Flash')
  const signal = mocks.callArkme.mock.calls.find(call => call[0] === 'billing.quota')?.[2] as AbortSignal
  await act(async () => root.unmount()); root = createRoot(host)
  expect(signal.aborted).toBe(true); expect(listeners.size).toBe(0)
})
