import { readFileSync } from 'node:fs'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { IconSearchOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { ArkmeForwardSearch } from '../src/client/ArkmeForwardSearch.js'

let renderer: ReactTestRenderer | undefined
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined })

it('uses the native DSH input and icon without overriding their visual states', () => {
  act(() => { renderer = create(<ArkmeForwardSearch value="" onChange={vi.fn()} />) })
  const native = renderer!.root.findByType(Input)
  expect(native.props.className).toBe('arkme-forward-search')
  expect(native.props.style).toBeUndefined()
  expect(renderer!.root.findAllByType(IconSearchOutline16)).toHaveLength(1)
  const input = renderer!.root.findByType('input')
  expect(input.props['aria-label']).toBe('搜索转发对象')
  expect(input.props.placeholder).toBe('搜索转发对象')
  expect(input.props.style).toBeUndefined()
})

it('preserves controlled keyword changes and busy-state disabling', () => {
  const change = vi.fn()
  act(() => { renderer = create(<ArkmeForwardSearch value="工作" onChange={change} />) })
  const event = { currentTarget: { value: '工作群' }, target: { value: '工作群' } }
  act(() => { renderer!.root.findByType('input').props.onChange(event) })
  expect(change).toHaveBeenCalledExactlyOnceWith(event)
  act(() => { renderer!.update(<ArkmeForwardSearch value="工作群" disabled onChange={change} />) })
  expect(renderer!.root.findByType('input').props.value).toBe('工作群')
  expect(renderer!.root.findByType('input').props.disabled).toBe(true)
})

it('shares both forwarding surfaces, with theme-aware contrast and native borders/focus', () => {
  for (const file of ['ArkmeSidebar', 'ArkmeMessageActions']) {
    const source = readFileSync(`src/client/${file}.tsx`, 'utf8')
    expect(source).toContain('<ArkmeForwardSearch')
    expect(source).not.toMatch(/<input[^>]*aria-label="搜索转发对象"/)
  }
  const css = readFileSync('src/client/redesign/arkme-redesign.css', 'utf8')
  const declarations = css.match(/\.arkme-forward-search\s*\{([^}]+)\}/)![1]!
  expect(declarations).toContain('width: 100%')
  expect(declarations).toContain('height: 100%')
  expect(declarations).toContain('box-sizing: border-box')
  expect(declarations).toContain('background: var(--dsw-alias-bg-module-platform, #f5f6f7)')
  expect(declarations).not.toMatch(/border:|border-radius|outline|box-shadow|font/)
  expect(css).toContain('.arkme-forward-search input::placeholder { color: var(--dsw-alias-label-secondary, #61666b); }')
  expect(css).not.toMatch(/\.arkme-forward-search[^{}]*:focus[^{}]*\{/)
})
