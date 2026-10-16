// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeProductNavigation } from '../src/client/ArkmeProductNavigation.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
let root: Root, host: HTMLDivElement
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  mocks.call.mockReset().mockImplementation(() => new Promise(() => {}))
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 11 })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete (window as any).arkmeDesktop })
const lockButton = () => [...document.querySelectorAll('button')].find(button => button.textContent === '锁定')
it('shows Lock immediately on each menu opening even while all server requests are pending', async () => {
  (window as any).arkmeDesktop = {deviceLock: {version: 1}}
  await act(async () => root.render(<ArkmeProductNavigation compact={false} />))
  const profile = host.querySelector<HTMLButtonElement>('[aria-label="个人资料"]')!
  for (let i = 0; i < 3; i++) {
    await act(async () => profile.click())
    expect(lockButton()).toBeDefined()
    expect(lockButton()?.nextElementSibling?.textContent).toBe('数据管理')
    await act(async () => profile.click())
    expect(lockButton()).toBeUndefined()
  }
  expect(mocks.call.mock.calls.some(([operation]) => operation === 'device.lock.status')).toBe(false)
})
it('does not offer a lock command in a browser or legacy desktop without native support', async () => {
  await act(async () => root.render(<ArkmeProductNavigation compact={false} />))
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="个人资料"]')!.click())
  expect(lockButton()).toBeUndefined()
})
