// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorldPublicationBadge, WorldPublicationActions } from '../src/client/WorldPublicationControls.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { worldPublications } from '../src/client/world-publications.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: (...args: unknown[]) => mocks.call(...args) }))
let host: HTMLDivElement, root: Root
const target = { source: { sourceRef: 'self', messageActionRef: 'action', itemUid: 'note' } }
const publication = {
  key: 'stable-publication',
  ref: 'sealed',
  kind: 'person',
  label: '个人世界',
  requested: true,
  pending: false,
  canUnpublish: true,
}
const click = async (label: string) =>
  act(async () => {
    const b = [...document.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === label || b.textContent === label,
    )
    expect(b, `missing ${label}`).toBeDefined()
    b!.click()
  })
const settle = async () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 35))
  })
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 8 })
  mocks.call.mockReset()
  mocks.call.mockImplementation(async (_op, p) =>
    p.action === 'sources'
      ? { items: [{ itemUid: 'note', publications: [publication] }] }
      : { completed: true, pending: false },
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  worldPublications.invalidate()
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
it('uses one state for the block badge and detail menu; keeps original state on failure and retries the same command', async () => {
  let active = true
  mocks.call.mockImplementation(async (_op, p) => {
    if (p.action === 'sources') return { items: [{ itemUid: 'note', publications: active ? [publication] : [] }] }
    if (mocks.call.mock.calls.filter((c) => c[1].action === 'unpublish').length === 1) throw new Error('结果未知')
    active = false
    return { completed: true, pending: false }
  })
  await act(async () =>
    root.render(
      <>
        <WorldPublicationBadge target={target} />
        <WorldPublicationActions target={target} />
      </>,
    ),
  )
  await settle()
  expect(document.querySelector('[data-world-publication-badge]')).not.toBeNull()
  expect(mocks.call.mock.calls.filter((c) => c[1].action === 'sources')).toHaveLength(1)
  await click('公开发布管理')
  await click('取消公开发布')
  expect(document.body.textContent).toContain('原消息保留，内容将从世界中取消公开。')
  await click('确认取消公开')
  expect(document.body.textContent).toContain('结果未知')
  expect(document.querySelector('[data-world-publication-badge]')).not.toBeNull()
  await click('重试取消公开')
  await settle()
  expect(document.querySelector('[data-world-publication-badge]')).toBeNull()
  const writes = mocks.call.mock.calls.filter((c) => c[1].action === 'unpublish')
  expect(writes).toHaveLength(2)
  expect(writes[0]![1]).toEqual(writes[1]![1])
})
it('does not cancel when the confirmation is dismissed and hides the previous account badge immediately', async () => {
  await act(async () =>
    root.render(
      <>
        <WorldPublicationBadge target={target} />
        <WorldPublicationActions target={target} />
      </>,
    ),
  )
  await settle()
  await click('公开发布管理')
  await click('取消公开发布')
  await click('返回')
  expect(mocks.call.mock.calls.filter((c) => c[1].action === 'unpublish')).toHaveLength(0)
  await act(async () => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 9 }))
  expect(document.querySelector('[data-world-publication-badge]')).toBeNull()
})
