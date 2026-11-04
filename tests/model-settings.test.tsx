// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeModelSettings } from '../src/client/ArkmeModelSettings.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
vi.mock('../src/client/ArkmeModelCatalogDialog.js', () => ({ ArkmeOfficialModels: ({scope}:{scope:string}) => <div data-catalog={scope}/> }))
let root: Root, host: HTMLDivElement
const tab = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(item => item.textContent === label)!
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  arkmeAuthStore.setAuth({status:'authenticated',environment:'prod',userId:11})
  host=document.createElement('div'); document.body.append(host); root=createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
it('defaults to official and loads the original Host model configuration only on demand, retaining drafts between tabs', async () => {
  await act(async () => root.render(<ArkmeModelSettings/>))
  expect(tab('即我官方').getAttribute('aria-selected')).toBe('true')
  expect(host.querySelector('iframe')).toBeNull()
  await act(async () => tab('自提供模型').click())
  const frame = host.querySelector('iframe')!
  expect(frame.getAttribute('src')).toBe('/arkme-self/harness-frame?arkme-harness-embed=1&arkme-model-settings=1')
  expect(host.textContent).toContain('需要跨场景使用时，请在上方绑定本机连接器')
  await act(async () => tab('即我官方').click())
  expect(frame.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true)
  await act(async () => tab('自提供模型').click())
  expect(host.querySelector('iframe')).toBe(frame)
})
it('supports keyboard tabs and unmounts the configuration document on account changes and logout', async () => {
  await act(async () => root.render(<ArkmeModelSettings initialTab="custom"/>))
  const frame = host.querySelector('iframe')!
  tab('自提供模型').focus()
  await act(async () => tab('自提供模型').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true})))
  expect(document.activeElement).toBe(tab('即我官方'))
  expect(tab('即我官方').getAttribute('aria-selected')).toBe('true')
  await act(async () => arkmeAuthStore.setAuth({status:'authenticated',environment:'prod',userId:22}))
  expect(frame.isConnected).toBe(false)
  expect(host.querySelector('[data-catalog]')).toBeNull()
  await act(async () => tab('即我官方').click())
  expect(host.querySelector('[data-catalog]')?.getAttribute('data-catalog')).toBe('prod:22')
  await act(async () => arkmeAuthStore.setAuth({status:'logged-out',environment:'prod'}))
  expect(host.querySelector('iframe')).toBeNull()
  expect(host.textContent).toContain('登录后查看模型设置')
})
