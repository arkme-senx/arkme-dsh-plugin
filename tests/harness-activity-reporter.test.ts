// @vitest-environment jsdom
import { act, createElement, useSyncExternalStore, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installHarnessActivityReporter } from '../src/client/harness-activity-reporter.js'
import { HARNESS_ACTIVITY_ATTRIBUTE, HARNESS_ACTIVITY_EVENT, parseHarnessActivity, type ActivityList } from '../src/client/harness-activity.js'
import { useHarnessActivity } from '../src/client/use-harness-activity.js'

it('bridges real public-slot subscriptions, accounts for parent visibility, and releases its contribution without changing native state', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const surface = document.createElement('section')
  surface.dataset.arkmeOwned = 'deepseek-harness-surface'
  surface.dataset.arkmeAccountId = '42'; surface.dataset.arkmeAccountScope = 'prod:42'
  surface.dataset.arkmeVisible = 'false'; surface.dataset.arkmeFollowSession = 'false'
  document.body.append(surface)
  const container = document.createElement('div'); document.body.append(container)
  let component: ComponentType<any>
  const listeners = new Set<() => void>()
  let state: ActivityList = { phase: 'ready', ids: ['a'], byId: { a: { id: 'a', displayTitle: '任务 A', running: true } }, current: 'a' }
  const useSessions = (select: (value: ActivityList) => unknown) => select(useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => state))
  const archived: string[] = []
  const useWorkspaces = (select: (value: { archivedSessionIds: string[] }) => unknown) => select({ archivedSessionIds: archived })
  const pending = new Map()
  const useSessionPendingInteraction = (select: (value: Map<string, { kind: string }>) => unknown) => select(pending)
  const remove = vi.fn()
  const stop = installHarnessActivityReporter({ slots: {
    spec: () => ({ kind: 'list', scope: 'root' }),
    inject: (_key: string, mount: () => () => void) => mount(),
    register: (_options: unknown, value: ComponentType<any>) => { component = value; return remove },
  } } as unknown as ClientContext, surface)
  function Consumer() { const value = useHarnessActivity('prod:42'); return createElement('output', null, value?.unread.length ?? 0) }
  const root = createRoot(container)
  await act(async () => { root.render(createElement('div', null, createElement(component!, { useSessions, useWorkspaces, useSessionPendingInteraction }), createElement(Consumer))) })
  const read = () => parseHarnessActivity(surface.getAttribute(HARNESS_ACTIVITY_ATTRIBUTE), 'prod:42')!
  expect(read().running).toHaveLength(1)
  await act(async () => {
    state = { ...state, byId: { a: { ...state.byId.a!, running: false } } }
    listeners.forEach(listener => listener())
  })
  expect(read().unread).toHaveLength(1)
  expect(container.querySelector('output')!.textContent).toBe('1')
  // Opening the DSH area while its browser window is not focused must not mark it read.
  focus.mockReturnValue(false)
  await act(async () => { surface.dataset.arkmeVisible = 'true'; surface.dataset.arkmeFollowSession = 'true' })
  expect(read().unread).toHaveLength(1)
  focus.mockReturnValue(true)
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(read().unread).toHaveLength(0)
  expect(container.querySelector('output')!.textContent).toBe('0')
  expect(state.byId.a!.running).toBe(false)
  await act(async () => { root.unmount(); stop() })
  expect(remove).toHaveBeenCalledOnce(); expect(listeners.size).toBe(0)
  expect(surface.hasAttribute(HARNESS_ACTIVITY_ATTRIBUTE)).toBe(false)
  document.dispatchEvent(new Event(HARNESS_ACTIVITY_EVENT))
  document.body.replaceChildren(); focus.mockRestore(); localStorage.clear()
})
