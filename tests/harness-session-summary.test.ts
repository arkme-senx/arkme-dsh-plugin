// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, createElement, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ClientContext, UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import { installHarnessSessionSummary, SessionTurnCount } from '../src/client/harness-session-summary.js'

let root: Root | undefined
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; document.body.replaceChildren() })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('follows the current session projection, including updates and missing data, without counting visible messages or tool steps', () => {
  const listeners = new Set<() => void>()
  let value: unknown = { turns: 12, steps: 50 }
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  const useProjection = ((key: string) => {
    expect(key).toBe('sessionStats')
    return useSyncExternalStore(subscribe, () => value)
  }) as UseProjection
  const t = ((_key: string, params: { count: number }) => `${params.count} 次对话`) as Parameters<typeof SessionTurnCount>[0]['t']
  const container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(createElement(SessionTurnCount, { useProjection, t })))
  expect(container.textContent).toBe('12 次对话')
  const update = (next: unknown) => act(() => { value = next; listeners.forEach(listener => listener()) })
  update({ turns: 12, steps: 200 })
  expect(container.textContent).toBe('12 次对话')
  update({ turns: 13, steps: 201 })
  expect(container.textContent).toBe('13 次对话')
  // The framework withdraws the old projection while another session loads.
  update(undefined)
  expect(container.textContent).toBe('')
  update({ turns: 2, steps: 2 })
  expect(container.textContent).toBe('2 次对话')
  for (const invalid of [null, {}, { turns: '2' }, { turns: -1 }, { turns: 1.5 }, { turns: Infinity }]) {
    update(invalid)
    expect(container.textContent).toBe('')
  }
  update({ turns: 0, steps: 0 })
  expect(container.textContent).toBe('0 次对话')
  act(() => root!.unmount()); root = undefined
  expect(listeners.size).toBe(0)
})

it('contributes through the public session slot and removes only its own contribution on disposal', () => {
  const removeSlot = vi.fn(), removeLocale = vi.fn()
  const register = vi.fn(() => removeSlot)
  const locale = vi.fn(() => removeLocale)
  const ctx = {
    locale: { register: locale },
    slots: { spec: () => ({ kind: 'list', scope: 'session' }), inject: (_key: string, fn: () => () => void) => fn(), register },
  } as unknown as ClientContext
  const dispose = installHarnessSessionSummary(ctx)
  expect(register).toHaveBeenCalledWith(expect.objectContaining({ name: 'conversation.session.header.actions', id: 'arkme-session-turn-count', order: 0 }), SessionTurnCount)
  dispose()
  expect(removeSlot).toHaveBeenCalledOnce()
  expect(removeLocale).toHaveBeenCalledOnce()
})
