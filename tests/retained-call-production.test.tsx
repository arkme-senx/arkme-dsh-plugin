import { useEffect, useState } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))
vi.mock('../src/client/ArkmeCallSurface.js', () => ({ ArkmeCallSurface: ({ active }: { active: boolean }) => {
  const [value, setValue] = useState('')
  useEffect(() => { lifecycle.mounts++; return () => { lifecycle.unmounts++ } }, [])
  return <input data-call-probe active={active} value={value} onChange={setValue} />
} }))
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn(async (op: string) => {
  if (op === 'sources.list') return { items: [], hasMore: false }
  if (op === 'files.send.tasks') return []
  if (op === 'provider.instance') return { instanceId: 'retained-call-test' }
  throw new Error('not used')
}), ArkmeClientError: class extends Error {} }))
import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'

it('retains calls through both utility-mode switches and full workspace suspension', async () => {
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 9981 })
  arkmeUi.showCalls()
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeSurface productChrome={false} />) })
  await act(async () => { view.root.findByProps({ 'data-call-probe': true }).props.onChange('retained query') })
  await act(async () => { arkmeUi.showContacts(); view.update(<ArkmeSurface productChrome={false} active={false} />) })
  expect(view.root.findByProps({ 'data-call-probe': true }).props.active).toBe(false)
  expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 })
  await act(async () => { arkmeUi.showCalls(); view.update(<ArkmeSurface productChrome={false} />) })
  expect(view.root.findByProps({ 'data-call-probe': true }).props.value).toBe('retained query')
  expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 })
  await act(async () => { arkmeUi.showHarness(); view.update(<ArkmeSurface productChrome={false} active={false} />) })
  await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 9982 }) })
  expect(view.root.findAllByProps({ 'data-call-probe': true })).toHaveLength(0)
  expect(lifecycle.unmounts).toBe(1)
  await act(async () => { arkmeUi.showCalls(); view.update(<ArkmeSurface productChrome={false} />) })
  expect(view.root.findByProps({ 'data-call-probe': true }).props.value).toBe('')
  await act(async () => { arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' }) })
  expect(view.root.findAllByProps({ 'data-call-probe': true })).toHaveLength(0)
  expect(lifecycle.unmounts).toBe(2)
  act(() => view.unmount())
})
