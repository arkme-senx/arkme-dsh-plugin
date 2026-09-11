// @vitest-environment jsdom
import { act, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { apply } from '../src/client/harness-onboarding-client.js'

afterEach(() => { document.body.replaceChildren(); delete document.body.dataset.arkmeHarnessOnboarding; vi.unstubAllGlobals() })

it('stays pending through native startup and signals ready only when the final native step mounts', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let snapshot = { phase: 'loading', current: undefined as string | undefined, byId: {} as Record<string, { blank: boolean }> }
  let changed = () => {}
  let dispose = () => {}
  let Step!: ComponentType<{ complete(): void }>
  let order = 0
  const unsubscribe = vi.fn()
  apply({
    sessions: { list: { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { changed = listener; return unsubscribe } } },
    effect: (start: () => () => void) => { dispose = start() },
    slots: { inject: (_name: string, register: () => void) => register(), register: (options: { order: number }, component: typeof Step) => { order = options.order; Step = component } },
  } as unknown as ClientContext)
  expect(order).toBeGreaterThan(0) // Native welcome (-100) and model setup (0) keep ownership first.
  expect(document.body.dataset.arkmeHarnessOnboarding).toBe('pending')
  snapshot = { ...snapshot, phase: 'ready' }
  changed()
  expect(document.body.dataset.arkmeHarnessOnboarding).toBe('pending')
  // A loading/failed acknowledgement cannot mount this step; no DOM disappearance guesses are used.
  changed()
  expect(document.body.dataset.arkmeHarnessOnboarding).toBe('pending')
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const complete = vi.fn()
  await act(async () => { root.render(<Step complete={complete} />) })
  expect(document.body.dataset.arkmeHarnessOnboarding).toBe('ready')
  expect(complete).toHaveBeenCalledOnce()
  await act(async () => { root.unmount() })
  expect(document.body.dataset.arkmeHarnessOnboarding).toBe('ready')
  // Matches SettingsRoot: leaving an active onboarding session resets its completed step set.
  snapshot = { phase: 'ready', current: 'existing', byId: { existing: { blank: false } } }
  changed()
  expect(document.body.dataset.arkmeHarnessOnboarding).toBe('ready')
  snapshot = { phase: 'ready', current: undefined, byId: {} }
  changed()
  expect(document.body.dataset.arkmeHarnessOnboarding).toBe('pending')
  dispose()
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(document.body.dataset.arkmeHarnessOnboarding).toBeUndefined()
})
