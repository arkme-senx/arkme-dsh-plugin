// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
const api = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: api }))
import { ArkmeArrangementRecognitionSettings } from '../src/client/ArkmeArrangementRecognitionInspector.js'

it('can authorize and disable recognition independently of an unavailable model-settings endpoint', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let enabled = false, version = 0
  api.mockReset().mockImplementation(async (operation, params) => {
    if (operation === 'account.capabilities.update') {
      expect(params.expectedVersion).toBe(version)
      enabled = params.enabled; version++
    } else if (operation !== 'account.capabilities.query') throw new Error('识别模型配置接口不可用')
    return { accountScope: 'test:42', settings: [{ key: 'arrangement_recognition', title: '安排', enabled, version, enabledAt: 0 }] }
  })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const toggle = () => document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="自动识别安排"]')!
  const writes = () => api.mock.calls.filter(([operation]) => operation === 'account.capabilities.update')
  try {
    await act(async () => root.render(<ArkmeArrangementRecognitionSettings accountScope="test:42" onClose={() => {}} />))
    expect(document.body.textContent).toContain('识别模型配置接口不可用')
    expect(toggle().getAttribute('aria-checked')).toBe('false')
    await act(async () => toggle().click())
    expect(writes()).toHaveLength(0)
    const consent = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '同意并开启')!
    await act(async () => consent.click())
    expect(writes()[0]![1]).toMatchObject({ expectedAccountScope:'test:42', key:'arrangement_recognition', enabled:true, expectedVersion:0, billingConsent:true })
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    await act(async () => toggle().click())
    expect(writes()[1]![1]).toMatchObject({ enabled:false, expectedVersion:1, billingConsent:false })
    expect(toggle().getAttribute('aria-checked')).toBe('false')
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals()
  }
})
