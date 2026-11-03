// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ExploreModelModule, ExploreSettings } from '../src/explore-contract.js'
import { exploreModelChoices } from '../src/explore-models.js'
import { mergeModelChoices } from '../src/model-directory.js'
import { ExploreModelControl } from '../src/client/explore/ExploreModelControl.js'
import { ExploreSettingsDialog } from '../src/client/explore/ExploreSettingsDialog.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { unifiedModelStore } from '../src/client/use-unified-models.js'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
let root: Root, host: HTMLDivElement, current: string, failRead: boolean, failSave: boolean
function settings(module: ExploreModelModule, scope = 'production:42'): ExploreSettings {
  return { ref: JSON.stringify({ module, scope }), accountScope: scope, sources: [], models: ['a', 'b'].map(key => ({ key, ref: `${module}/${key}`, label: `分析模型 ${key.toUpperCase()}`, selected: current === key, provider: 'dashscope' })) }
}
const options = () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === name || item.getAttribute('aria-label') === name)!
const click = (name: string) => act(async () => button(name).click())
const choose = (name: string) => act(async () => options().find(option => option.textContent?.includes(name))!.click())
async function render(module: ExploreModelModule = 'profile', onChanged = vi.fn(), scope = 'production:42') {
  await act(async () => root.render(<ExploreModelControl key={scope + module} accountScope={scope} module={module} onChanged={onChanged}/>))
  return onChanged
}
async function open() { await act(async () => host.querySelector<HTMLButtonElement>('.explore-model-trigger')!.click()) }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  unifiedModelStore.activate(undefined); arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'production', userId: 42 })
  current = 'a'; failRead = false; failSave = false
  mock.call.mockReset().mockImplementation(async (op, input) => {
    if (op === 'explore.settings') { if (failRead) throw Error('模型目录暂不可用'); return settings(input.module, input.expectedAccountScope) }
    if (op === 'explore.settings.save') {
      if (failSave) throw Error('服务端拒绝切换')
      const { module, scope } = JSON.parse(input.ref); current = input.modelRef.endsWith('/b') ? 'b' : 'a'
      return { saved: true, settings: settings(module, scope), message: '新模型已排队分析' }
    }
    if (op === 'models.directory') return { accountScope: input.expectedAccountScope, observedAt: 1, failures: [], models: [{ id: 'dsh-only', identifier: 'dsh-only', name: '系统对话模型', channel: 'Arkme 托管', billing: 'arkme-points', dsh: { provider: 'arkme-managed', model: 'dsh-only' } }] }
    if (op === 'account.points.query') return { accountScope: input.expectedAccountScope, unit: 'ai_points', availablePoints: '123.45', reservedPoints: '0' }
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); unifiedModelStore.activate(undefined)
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'production' }); vi.unstubAllGlobals()
})
it.each(['profile', 'events', 'goals', 'anniversaries'] as const)('shows %s models in the shared full directory and submits only after confirmation', async module => {
  const changed = await render(module)
  expect(host.textContent).toContain('分析模型 A'); await open()
  expect(options()).toHaveLength(3); expect(document.body.textContent).toContain('123.45 积分')
  expect(button('应用并重新分析').disabled).toBe(true)
  await choose('系统对话模型')
  expect(document.body.textContent).toContain('支持情况待确认')
  expect(mock.call.mock.calls.some(([op]) => op === 'explore.settings.save')).toBe(false)
  await choose('分析模型 B')
  expect(mock.call.mock.calls.some(([op]) => op === 'explore.settings.save')).toBe(false)
  expect(document.body.textContent).toContain('已有结果会保留')
  await click('应用并重新分析')
  expect(mock.call.mock.calls.filter(([op]) => op === 'explore.settings.save')).toHaveLength(1)
  expect(mock.call.mock.calls.find(([op]) => op === 'explore.settings.save')?.[1].modelRef).toBe(`${module}/b`)
  expect(host.textContent).toContain('分析模型 B'); expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(changed).toHaveBeenCalledExactlyOnceWith('新模型已排队分析')
})
it('retains the real selection and dialog on a rejected activation, then allows retry', async () => {
  const changed = await render(); await open(); failSave = true
  await choose('分析模型 B'); await click('应用并重新分析')
  expect(document.body.textContent).toContain('服务端拒绝切换'); expect(host.textContent).toContain('分析模型 A')
  expect(options().find(option => option.getAttribute('aria-selected') === 'true')?.textContent).toContain('分析模型 A')
  expect(changed).not.toHaveBeenCalled(); failSave = false
  await choose('分析模型 B'); await click('应用并重新分析')
  expect(changed).toHaveBeenCalledOnce()
})
it('allows a failed model read to be retried without submitting analysis', async () => {
  failRead = true; await render(); await open()
  expect(document.body.textContent).toContain('模型目录暂不可用'); failRead = false
  await click('重新读取模型')
  expect(options()).toHaveLength(3); expect(host.textContent).toContain('分析模型 A')
  expect(mock.call.mock.calls.some(([op]) => op === 'explore.settings.save')).toBe(false)
})
it('aborts an old-account activation and never publishes its late result to the new account', async () => {
  const changed = await render(); await open(); await choose('分析模型 B')
  let finish!: (value: unknown) => void
  const original = mock.call.getMockImplementation()!
  mock.call.mockImplementation((op, ...args) => op === 'explore.settings.save' ? new Promise(resolve => { finish = resolve }) : original(op, ...args))
  await click('应用并重新分析')
  const signal = mock.call.mock.calls.find(([op]) => op === 'explore.settings.save')?.[2] as AbortSignal
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'production', userId: 43 })
  await render('profile', changed, 'production:43'); expect(signal.aborted).toBe(true)
  current = 'b'; await act(async () => finish({ saved: true, settings: settings('profile'), message: '旧账号结果' }))
  expect(changed).not.toHaveBeenCalled(); expect(host.textContent).toContain('分析模型 A')
})
it('keeps data-source settings readable without a model catalog and removes the legacy model select', async () => {
  mock.call.mockImplementation(async (op, input) => {
    if (op === 'explore.settings' && input.part === 'sources') return { ref: 'sources', models: [], sources: [{ key: 'personal_record', label: '个人记录', description: '', enabled: true }] }
    throw Error('模型目录不可用')
  })
  await act(async () => root.render(<ExploreSettingsDialog module="profile" onClose={() => {}} onChanged={() => {}}/>))
  expect(document.body.textContent).toContain('个人记录'); expect(document.querySelector('select')).toBeNull()
  expect(mock.call).toHaveBeenCalledExactlyOnceWith('explore.settings', { module: 'profile', part: 'sources' }, expect.any(AbortSignal))
})
it('does not infer common routes or billing from identical model names', () => {
  const data = settings('profile'); data.models[1]!.label = data.models[0]!.label
  const models = exploreModelChoices('profile', data)
  expect(models[0]!.id).not.toBe(models[1]!.id); expect(models[0]!.billing).toBeUndefined()
  expect(models[0]!.version).toBeUndefined(); expect(models[0]!.dsh).toBeUndefined()
})
it('reuses an existing catalog row only for the exact public Intelligent route', async () => {
  const data = settings('profile'); data.models[0]!.routeKey = 'dashscope/a'
  const local = exploreModelChoices('profile', data)
  const existing = { id: 'recording-a', name: '原目录名称', channel: '百炼', identifier: 'a', recording: 'dashscope/a' }
  const combined = mergeModelChoices([existing], local)
  expect(combined).toHaveLength(2); expect(combined[0]).toMatchObject({ ...existing, explore: 'profile/a' })
  expect(mergeModelChoices([{...existing,channel:'分析模型',recording:undefined,exploreRouteKey:'dashscope/a'} as never],local)[0]?.channel).toBe('百炼')
  const original = mock.call.getMockImplementation()!
  mock.call.mockImplementation((op, ...args) => op === 'explore.settings' ? Promise.resolve(data)
    : op === 'models.directory' ? Promise.resolve({ accountScope: 'production:42', observedAt: 1, models: [existing], failures: [] }) : original(op, ...args))
  await render(); await open()
  expect(options()).toHaveLength(2)
  expect(options().find(option => option.getAttribute('aria-selected') === 'true')?.textContent).toBe('原目录名称')
  expect(document.activeElement).toBe(options().find(option => option.getAttribute('aria-selected') === 'true'))
  expect(button('应用并重新分析').disabled).toBe(true)
})
