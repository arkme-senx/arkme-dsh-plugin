// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { WorldSuggestionsEntry } from '../src/client/WorldSuggestions.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async importOriginal => ({ ...await importOriginal<typeof import('../src/client/api.js')>(), callArkme: (...args: unknown[]) => mocks.call(...args) }))
vi.mock('../src/client/ArkmeWorldSurface.js', () => ({ PublishDialog: ({ origin }: { origin: { kind: string } }) => <div role="dialog" aria-label="选择发布身份" data-origin={origin.kind} /> }))
let root: Root, host: HTMLDivElement
const candidate = { key: 'one', ref: 'opaque-one', title: '独立的个人观察', preview: '原文里的表达', reason: '表达完整，并为读者提供了具体的经验。', occurredAtMillis: 100 }
const state = () => ({ supported: true, candidateCount: 1, unavailableCount: 0, items: [candidate] })
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
const click = (text: string) => act(async () => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text); expect(b, text).toBeDefined(); b!.click() })
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  localStorage.clear(); arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 8 })
  mocks.call.mockReset(); mocks.call.mockImplementation(async (_op, p) => p.action === 'capabilities' ? { version: 1, supported: true } : p.action === 'models' ? { items: [] } : p.action === 'state' ? state() : p.action === 'prepare' ? { origin: { kind: 'suggestion', sourceRef: 'opaque-one', itemUid: 'one' }, draft: { title: '完整标题', textContent: '完整原文', attachments: [] } } : { completed: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<WorldSuggestionsEntry />)); await settle()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.unstubAllGlobals() })
it('does not generate on entry, shows reasons and original, and opens the shared identity-only publisher', async () => {
  expect(mocks.call.mock.calls.some(c => c[1].action === 'create')).toBe(false)
  await click('✨ 分享建议 1'); await settle()
  expect(document.body.textContent).toContain(candidate.reason)
  await click('查看原文'); expect(document.body.textContent).toContain('完整原文')
  await click('返回分享建议'); await click('发到世界')
  expect(document.querySelector('[aria-label="选择发布身份"]')?.getAttribute('data-origin')).toBe('suggestion')
  expect(document.querySelector('textarea')).toBeNull()
})
it('dismisses privately and removes private panel data after switching accounts', async () => {
  await click('✨ 分享建议 1'); await settle(); await click('暂不分享')
  expect(mocks.call.mock.calls.find(c => c[1].action === 'hide')?.[1]).toEqual({ action: 'hide', accountKey: 'test:8', ref: 'opaque-one', confirmed: true })
  mocks.call.mockImplementation(async (_op, p) => p.action === 'capabilities' ? { version: 1, supported: false } : {})
  await act(async () => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 9 }))
  expect(document.body.textContent).not.toContain(candidate.preview)
  expect(document.querySelector('[aria-label="分享建议"]')).toBeNull()
})
it('persists an immutable create request before transport and retries the same request after a lost response', async () => {
  mocks.call.mockImplementation(async (_op, p) => { if (p.action === 'capabilities') return { version: 1, supported: true }; if (p.action === 'models') return { items: [] }; if (p.action === 'state') return { ...state(), items: [], candidateCount: 0 }; if (p.action === 'create') { expect(localStorage.getItem('arkme.world-suggestions.pending.v1:test:8')).toContain(p.requestId); throw new Error('network lost') }; return {} })
  await click('✨ 分享建议 1'); await settle(); await click('开始分析'); await settle()
  await click('核对上次提交'); await settle()
  const attempts = mocks.call.mock.calls.filter(c => c[1].action === 'create')
  expect(attempts).toHaveLength(2); expect(attempts[0]![1]).toEqual(attempts[1]![1])
  expect(document.querySelector('[aria-label="分析范围"]')?.closest('fieldset')?.disabled).toBe(true)
})
it('reports unavailable capability without generation controls', async () => {
  mocks.call.mockResolvedValue({ version: 1, supported: false })
  await click('✨ 分享建议 1'); await settle()
  expect(document.body.textContent).toContain('分享建议服务尚未就绪')
  expect([...document.querySelectorAll('button')].some(b => b.textContent === '开始分析')).toBe(false)
})

it('gives an actionable terminal failure without promising an automatic rerun', async () => {
  mocks.call.mockImplementation(async (_op, p) => p.action === 'capabilities' ? { version: 1, supported: true } : p.action === 'models' ? { items: [] } : p.action === 'state' ? { ...state(), job: { ref: 'job-ref', requestId: 'accepted-request', status: 'failed', phase: 'failed', failure: 'model_connector_offline', scanned: 1, processed: 0, matched: 0 } } : {})
  await click('✨ 分享建议 1'); await settle()
  expect(document.body.textContent).toContain('本机模型暂时离线，请恢复后重新分析')
  expect(document.body.textContent).not.toContain('恢复后会继续核对')
  expect(mocks.call.mock.calls.filter(c => c[1].action === 'create')).toHaveLength(0)
})
