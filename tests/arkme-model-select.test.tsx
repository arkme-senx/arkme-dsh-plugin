// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))
import { ArkmeModelSelect, type ArkmeModelDirectory } from '../src/client/ArkmeModelSelect.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { unifiedModelStore } from '../src/client/use-unified-models.js'
let root: Root, host: HTMLDivElement, state: ReturnType<ArkmeModelDirectory['store']['getSnapshot']>, directory: ArkmeModelDirectory
const listeners = new Set<() => void>()
function button(text: string) { const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text); if (!found) throw Error(`Missing ${text}`); return found }
const click = (text: string) => act(async () => button(text).click())
const render = (available = true, locked = false) => act(async () => root.render(<ArkmeModelSelect directory={directory} available={available} locked={locked}/>))
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); unifiedModelStore.activate(undefined)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'production', userId: 42 })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  state = { current: { provider: 'deepseek', model: 'flash' }, groups: [
    { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'flash', name: 'DeepSeek Flash' }] },
    { id: 'arkme-managed', name: 'Arkme', models: [{ id: 'pro', name: 'DeepSeek Pro', reasoning: { efforts: [{ id: 'high', name: '高' }, { id: 'low', name: '低' }], defaultEffort: 'high' } }] },
  ], failures: [], status: 'ready', error: null }
  directory = { store: { getSnapshot: () => state, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, update: vi.fn() }, load: vi.fn(async () => undefined),
    select: vi.fn(async selection => {
      state = { ...state, current: selection, status: 'ready', error: null }
      listeners.forEach(listener => listener())
      return { ok: true, value: undefined }
    }) }
  mocks.callArkme.mockReset().mockImplementation(async op => {
    if (op === 'models.directory') return { accountScope: 'production:42', observedAt: 1, models: [], failures: [] }
    if (op === 'account.points.query') return { accountScope: 'production:42', unit: 'ai_points', availablePoints: '123.45', reservedPoints: '0' }
    throw Error(`Unexpected ${op}`)
  })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); listeners.clear(); unifiedModelStore.activate(undefined); arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'production' }); vi.unstubAllGlobals() })
it('keeps credits in the managed model header and applies only an advertised model and reasoning effort', async () => {
  await render(); expect(host.textContent).not.toMatch(/123.45|充值|积分/)
  await click('DeepSeek Flash⌄')
  expect(document.querySelector('.arkme-unified-model-group-title')?.textContent).toContain('即我官方· 123.45 积分')
  expect(button('充值')).toBeDefined()
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(b => b.textContent?.includes('DeepSeek Pro'))!
  await act(async () => option.click())
  expect(directory.select).toHaveBeenCalledExactlyOnceWith({ provider: 'arkme-managed', model: 'pro', reasoningEffort: 'high' })
  expect(document.querySelector('.arkme-unified-model-panel')).toBeNull()
  await act(async () => host.querySelector<HTMLButtonElement>('.arkme-model-trigger')!.click())
  await click('低')
  expect(directory.select).toHaveBeenCalledWith({ provider: 'arkme-managed', model: 'pro', reasoningEffort: 'low' })
  expect(document.querySelector('.arkme-unified-model-panel')).not.toBeNull()
  expect(document.querySelector<HTMLInputElement>('input[type="range"]')?.value).toBe('1')
  await act(async () => document.querySelector('.arkme-unified-model-panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.querySelector('.arkme-unified-model-panel')).toBeNull()
  expect(document.activeElement).toBe(host.querySelector('.arkme-model-trigger'))
})
it('retains the previous owner selection on rejection and restores focus on Escape', async () => {
  directory.select = vi.fn(async () => { throw Error('选择失败') })
  await render(); await click('DeepSeek Flash⌄')
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(b => b.textContent?.includes('DeepSeek Pro'))!.click())
  expect(state.current?.provider).toBe('deepseek'); expect(document.body.textContent).toContain('选择失败')
  await act(async () => document.querySelector('.arkme-unified-model-panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.querySelector('.arkme-unified-model-panel')).toBeNull(); expect(document.activeElement).toBe(host.querySelector('.arkme-model-trigger'))
})
it('keeps the picker open on a rejected DSH result and lets the user retry', async () => {
  directory.select = vi.fn(directory.select).mockImplementationOnce(async () => {
    const error = { code: 'model-unavailable', message: '选择失败' }
    state = { ...state, status: 'error', error: `${error.code}: ${error.message}` }
    listeners.forEach(listener => listener())
    return { ok: false, error }
  })
  await render(); await click('DeepSeek Flash⌄')
  const choosePro = () => act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    .find(option => option.textContent?.includes('DeepSeek Pro'))!.click())
  await choosePro()
  expect(document.querySelector('.arkme-unified-model-panel')).not.toBeNull()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('选择失败')
  expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain('DeepSeek Flash')
  await choosePro()
  expect(directory.select).toHaveBeenCalledTimes(2)
  expect(state.current?.model).toBe('pro')
  expect(document.querySelector('.arkme-unified-model-panel')).toBeNull()
})
it('honors unavailable and locked sessions', async () => {
  await render(false); expect(directory.load).not.toHaveBeenCalled(); expect(host.querySelector('button')).toBeNull()
  await render(true, true); expect(button('DeepSeek Flash⌄').disabled).toBe(true)
})
