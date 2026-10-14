// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeAutomaticAiSettings } from '../src/client/ArkmeAutomaticAiSettings.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
let root: Root, host: HTMLDivElement, enabled: boolean, version: number
const result = (scope = 'prod:1') => ({ accountScope: scope, settings: [{ key: 'personal_profile', title: '个人档案', enabled, version, enabledAt: enabled ? 100 : 0 }] })
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  enabled = false; version = 0
  mocks.call.mockReset().mockImplementation(async (operation, params) => {
    if (operation.endsWith('update')) {
      if (params.expectedVersion !== version) throw new Error('conflict')
      if (enabled !== params.enabled) version++
      enabled = params.enabled
    }
    return result(params.expectedAccountScope)
  })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const render = async (scope = 'prod:1') => { await act(async () => root.render(<ArkmeAutomaticAiSettings accountScope={scope} />)) }
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent === label)!
const click = async (node: HTMLButtonElement) => { await act(async () => node.click()) }
const writes = () => mocks.call.mock.calls.filter(([op]) => op === 'account.capabilities.update')

it('requires human billing consent, carries the observed version, and closes directly', async () => {
  await render(); expect(writes()).toHaveLength(0)
  expect(host.querySelector('.arkme-automatic-ai > p')?.textContent).toBe('开启后自动分析，消耗 AI 额度。')
  const help = host.querySelector('details')!
  expect(help.open).toBe(false)
  await act(async () => help.querySelector('summary')!.click())
  expect(help.open).toBe(true)
  expect(help.textContent).toContain('手机「探索 → 个人档案」')
  expect(help.textContent).not.toContain('额度规则')
  expect(help.textContent).not.toContain('已开始的分析')
  expect(writes()).toHaveLength(0)
  await act(async () => help.querySelector('summary')!.click())
  expect(help.open).toBe(false)
  await click(host.querySelector('[role="switch"]')!)
  expect(writes()).toHaveLength(0); expect(document.querySelector('[role="dialog"]')?.textContent).toContain('首次开启会分析所选来源的历史材料'); expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('AI 额度')
  await click(button('同意并开启'))
  expect(writes()[0]?.[1]).toMatchObject({ enabled: true, expectedVersion: 0, billingConsent: true, expectedAccountScope: 'prod:1' })
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
  await click(host.querySelector('[role="switch"]')!)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(writes()[1]?.[1]).toMatchObject({ enabled: false, expectedVersion: 1 })
})
it('does not overwrite a newer cross-device close with stale consent', async () => {
  await render(); await click(host.querySelector('[role="switch"]')!)
  version = 2
  await click(button('同意并开启'))
  expect(enabled).toBe(false); expect(writes()).toHaveLength(1)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('操作未完成')
})
it('can retry profile initialization after authorization succeeded without toggling it off', async () => {
  await render(); await click(host.querySelector('[role="switch"]')!)
  mocks.call.mockImplementationOnce(async () => { enabled = true; version = 1; throw new Error('profile unavailable') })
  await click(button('同意并开启'))
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
  await click(button('个人档案已授权，重试启动分析'))
  expect(writes()[1]?.[1]).toMatchObject({ enabled: true, expectedVersion: 1 })
  expect(button('个人档案已授权，重试启动分析')).toBeUndefined()
})
it('drops consent and ignores old writes after an account change', async () => {
  await render(); await click(host.querySelector('[role="switch"]')!)
  await render('prod:2')
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(writes()).toHaveLength(0)
  await click(host.querySelector('[role="switch"]')!)
  let release!: () => void
  mocks.call.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  await click(button('同意并开启'))
  await render('prod:3')
  const reads = mocks.call.mock.calls.length
  await act(async () => release())
  expect(mocks.call.mock.calls.length).toBe(reads)
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
})
it('reads cross-device changes on focus and does not save twice', async () => {
  await render(); enabled = true; version = 1
  await act(async () => window.dispatchEvent(new Event('focus')))
  let release!: () => void
  mocks.call.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  await click(host.querySelector('[role="switch"]')!); await click(host.querySelector('[role="switch"]')!)
  expect(writes()).toHaveLength(1)
  await act(async () => release())
})
it('clears a transient read error after a successful focus refresh', async () => {
  mocks.call.mockRejectedValueOnce(new Error('offline'))
  await render()
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(host.querySelector('[role="switch"]')).not.toBeNull()
  expect(host.querySelector('[role="alert"]')).toBeNull()
})
