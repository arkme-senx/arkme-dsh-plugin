// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { apply } from '../src/client/harness-sidebar-client.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function mount(accountId?: string) {
  const surface = document.createElement('section')
  surface.dataset.arkmeOwned = 'deepseek-harness-surface'
  if (accountId !== undefined) surface.dataset.arkmeAccountId = accountId
  const frame = document.createElement('iframe')
  surface.append(frame)
  document.body.append(surface)
  vi.spyOn(window, 'frameElement', 'get').mockReturnValue(frame)
  return surface
}

function install() {
  const restore = vi.fn()
  const register = vi.fn((_options: unknown, _component: () => unknown) => restore)
  const inject = vi.fn((_name: string, contribute: () => () => void) => contribute())
  apply({
    effect: (start: () => (() => void) | undefined) => { const stop = start(); if (stop) cleanups.push(stop) },
    slots: { inject, register },
  } as unknown as ClientContext)
  return { inject, register, restore }
}

it('removes only the native settings slot while the authenticated avatar entry exists, then restores it on logout', async () => {
  const surface = mount('42')
  const { inject, register, restore } = install()
  expect(inject).toHaveBeenCalledOnce()
  expect(inject.mock.calls[0]?.[0]).toBe('sidebar.settings')
  expect(register.mock.calls[0]?.[0]).toEqual({ name: 'sidebar.settings', priority: -100 })
  expect((register.mock.calls[0]?.[1] as () => unknown)()).toBeNull()
  surface.dataset.arkmeAccountId = '43'
  await Promise.resolve()
  expect(inject).toHaveBeenCalledOnce()
  surface.removeAttribute('data-arkme-account-id')
  await Promise.resolve()
  expect(restore).toHaveBeenCalledOnce()
  surface.dataset.arkmeAccountId = '42'
  await Promise.resolve()
  expect(inject).toHaveBeenCalledTimes(2)
  cleanups.pop()?.()
  expect(restore).toHaveBeenCalledTimes(2)
  surface.removeAttribute('data-arkme-account-id')
  await Promise.resolve()
  expect(restore).toHaveBeenCalledTimes(2)
})

it.each([undefined, '', '0', 'invalid'])('preserves the original settings for unauthenticated or unresolved account %s', accountId => {
  mount(accountId)
  const { inject } = install()
  expect(inject).not.toHaveBeenCalled()
})

it('reacts when login becomes available after the native sidebar mounts', async () => {
  const surface = mount()
  const { inject } = install()
  surface.dataset.arkmeAccountId = '42'
  await Promise.resolve()
  expect(inject).toHaveBeenCalledOnce()
})

it('leaves standalone Harness and unrelated embedded pages untouched', () => {
  expect(install().inject).not.toHaveBeenCalled()
  const surface = mount('42')
  surface.dataset.arkmeOwned = 'another-surface'
  expect(install().inject).not.toHaveBeenCalled()
})
