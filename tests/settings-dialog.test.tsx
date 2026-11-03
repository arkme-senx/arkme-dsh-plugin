// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installArkmeSettingsDialog } from '../src/client/ArkmeSettingsDialog.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import type { Context } from '@deepseek-ai/cordis'
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Modal: ({ children, title, onClose }: { children: ReactNode; title: string; onClose(): void }) => <div role="dialog" aria-label={title}><button onClick={onClose}>关闭</button>{children}</div> }))
vi.mock('../src/client/ArkmeSettingsSurface.js', () => ({ ArkmeSettingsSurface: ({ view = 'account' }: { view?: string }) => <div data-page={view} /> }))
vi.mock('../src/client/ArkmeAccountUsageSettings.js', () => ({ ArkmeAccountUsageSettings: () => <div data-page="usage" /> }))
vi.mock('../src/client/ArkmeDataManagementSettings.js', () => ({ ArkmeDataManagementSettings: () => <div data-page="data" /> }))
let dispose: (() => void) | undefined
const preferences = () => ({
  locale: { subscribe: () => () => {}, getSnapshot: () => language, setLocale: vi.fn() },
  theme: { getTheme: () => appearance, setTheme: vi.fn() },
  on: vi.fn(() => () => {}),
})
const language = { active: 'zh', locales: [{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }], revision: 0 }
const appearance = { preference: 'system' }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 41 })
})
afterEach(async () => { await act(async () => dispose?.()); dispose = undefined; document.body.replaceChildren(); vi.unstubAllGlobals() })
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(n => n.textContent === name)!
it('opens account/data directly, keeps the sidebar mounted, and closes on an account switch', async () => {
  const sidebar = document.createElement('nav'); sidebar.textContent = '原有侧栏'; document.body.append(sidebar)
  await act(async () => { dispose = installArkmeSettingsDialog(preferences() as unknown as Context) })
  await act(async () => arkmeUi.openDshSettings('arkme-data'))
  expect(document.querySelector('[data-page="data"]')).not.toBeNull()
  expect(sidebar.isConnected).toBe(true)
  expect([...document.querySelectorAll('nav[aria-label] button')].map(n => n.textContent)).toEqual(['我的账户', '用量与额度', '数据管理', '通用设置', '关于'])
  expect(button('模型')).toBeUndefined()
  await act(async () => arkmeUi.openDshSettings('arkme-usage'))
  expect(document.querySelector('[data-page="usage"]')).not.toBeNull()
  await act(async () => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 42 }))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(sidebar.isConnected).toBe(true)
})
it('writes global language and appearance through their existing owners', async () => {
  const runtime = preferences()
  await act(async () => { dispose = installArkmeSettingsDialog(runtime as unknown as Context) })
  await act(async () => arkmeUi.openDshSettings())
  await act(async () => button('通用设置').click())
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="语言"]')!
  await act(async () => { select.value = 'en'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(runtime.locale.setLocale).toHaveBeenCalledWith('en')
  await act(async () => button('深色').click())
  expect(runtime.theme.setTheme).toHaveBeenCalledWith('dark')
  await act(async () => button('关闭').click())
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
