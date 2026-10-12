import { readFileSync } from 'node:fs'
import { useEffect, useState } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))
vi.mock('../src/client/ArkmeCallSurface.js', () => ({ ArkmeCallSurface: ({ active }: { active: boolean }) => {
  const [value, setValue] = useState('')
  useEffect(() => { lifecycle.mounts++; return () => { lifecycle.unmounts++ } }, [])
  return <input value={value} data-active={active} onChange={setValue} />
} }))
import { ArkmeRetainedCallPage } from '../src/client/ArkmeRetainedCallPage.js'

it('lazily retains the calls component, and releases it at the account/logout boundary', () => {
  lifecycle.mounts = 0; lifecycle.unmounts = 0
  const view = create(<ArkmeRetainedCallPage key="prod:1" active={false} />)
  expect(lifecycle.mounts).toBe(0)
  act(() => { view.update(<ArkmeRetainedCallPage key="prod:1" active />) })
  act(() => { view.root.findByType('input').props.onChange('my search') })
  act(() => { view.update(<ArkmeRetainedCallPage key="prod:1" active={false} />) })
  expect(view.root.findByProps({ 'data-arkme-retained-call-page': 'true' }).props.hidden).toBe(true)
  expect(view.root.findByType('input').props['data-active']).toBe(false)
  act(() => { view.update(<ArkmeRetainedCallPage key="prod:1" active />) })
  expect(view.root.findByType('input').props.value).toBe('my search')
  expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 })
  act(() => { view.update(<ArkmeRetainedCallPage key="prod:2" active />) })
  expect(view.root.findByType('input').props.value).toBe('')
  expect(lifecycle).toEqual({ mounts: 2, unmounts: 1 })
  act(() => { view.update(<div>Logged out</div>) })
  expect(lifecycle.unmounts).toBe(2)
  view.unmount()
})

it('places the retained page outside the mode switch, scoped to the authenticated account', () => {
  const source = readFileSync(new URL('../src/client/ArkmeSidebar.tsx', import.meta.url), 'utf8')
  expect(source).toContain("const retainedCallPage = authView === 'content' && <ArkmeRetainedCallPage")
  expect(source).toContain('key={`calls:${auth?.status}:${auth?.environment}:${auth?.userId}`}')
  expect(source).toContain("active={active && ui.mode === 'calls'}")
  expect(source).toContain("ui.mode === 'calls' ? null")
})
