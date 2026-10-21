import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { currentHarnessSession, harnessSessions } from '../src/client/harness-session-state.js'

it('derives selection from main-view ownership and forwards navigation to the UI owner', () => {
  let state: any = { phase: 'ready', ids: ['a', 'b'], byId: {
    a: { id: 'a', retainedBy: { gateway: 1 } },
    b: { id: 'b', retainedBy: { mainView: 1 } },
  } }
  const listeners = new Set<() => void>()
  const openSession = vi.fn()
  const refresh = vi.fn(function (this: unknown) { return this })
  const sessions = { list: { getSnapshot: () => state, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) } },
    subagentAddress: () => undefined, refresh }
  const adapted = harnessSessions({ sessions, uiWorkspace: { openSession } } as unknown as Context)
  expect(currentHarnessSession(state)).toBe('b')
  expect(adapted.list.getSnapshot().current).toBe('b')
  expect(adapted.list.getSnapshot()).toBe(adapted.list.getSnapshot())
  const changed = vi.fn()
  const stop = adapted.list.subscribe(changed)
  state = { ...state, byId: { ...state.byId, b: { id: 'b', retainedBy: {} } } }
  listeners.forEach(fn => fn())
  expect(changed).toHaveBeenCalledOnce()
  expect(adapted.list.getSnapshot().current).toBeUndefined()
  adapted.open('a' as never)
  expect(openSession).toHaveBeenCalledExactlyOnceWith('a')
  expect(adapted.refresh()).toBe(sessions)
  expect(state).not.toHaveProperty('current')
  stop()
  expect(listeners.size).toBe(0)
})
