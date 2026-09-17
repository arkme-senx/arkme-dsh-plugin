// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { loadNativeSelection } from '../src/client/harness-native-selection-loader.js'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

afterEach(() => { document.head.replaceChildren(); vi.restoreAllMocks() })

it('disposes an installed contribution exactly once', async () => {
  const restore = vi.fn()
  const install = vi.fn(() => restore)
  const dispose = loadNativeSelection({ modules: { import: async () => ({ install }) } } as unknown as ClientContext, document, '/selection.js')
  document.querySelector('script')!.dispatchEvent(new Event('load'))
  await Promise.resolve(); await Promise.resolve()
  expect(install).toHaveBeenCalledOnce()
  dispose(); dispose()
  expect(restore).toHaveBeenCalledOnce()
})

it('only imports after script arrival and disposes a late install after unload', async () => {
  let resolve!: (module: unknown) => void
  const importModule = vi.fn(() => new Promise(r => { resolve = r }))
  const dispose = loadNativeSelection({ modules: { import: importModule } } as unknown as ClientContext, document, '/selection.js')
  expect(importModule).not.toHaveBeenCalled()
  document.querySelector('script')!.dispatchEvent(new Event('load'))
  const restore = vi.fn()
  const install = vi.fn(() => restore)
  dispose()
  resolve({ install })
  await Promise.resolve(); await Promise.resolve()
  expect(install).not.toHaveBeenCalled()
  expect(document.querySelector('script')).toBeNull()
})

it('isolates download and import failures', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const importModule = vi.fn().mockRejectedValue(new Error('incompatible'))
  const dispose = loadNativeSelection({ modules: { import: importModule } } as unknown as ClientContext, document, '/selection.js')
  document.querySelector('script')!.dispatchEvent(new Event('error'))
  expect(importModule).not.toHaveBeenCalled()
  dispose()
  const second = loadNativeSelection({ modules: { import: importModule } } as unknown as ClientContext, document, '/selection.js')
  document.querySelector('script')!.dispatchEvent(new Event('load'))
  await Promise.resolve(); await Promise.resolve()
  second()
  expect(document.querySelector('script')).toBeNull()
})


it('loads through the real Cordis service boundary declared by onboarding', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { inject } = await import('../src/client/harness-onboarding-client.js')
  const root = new Context()
  root.reflect.provide('slots', {})
  root.reflect.provide('sessions', {})
  root.reflect.provide('modules', { import: async () => ({ install: () => () => {} }) })
  let dispose: (() => void) | undefined
  const fiber = root.plugin({ inject, apply(ctx) { dispose = loadNativeSelection(ctx as unknown as ClientContext, document, '/selection.js') } })
  await fiber
  expect(document.querySelector('script')?.getAttribute('src')).toBe('/selection.js')
  dispose?.()
  await fiber.dispose()
})
