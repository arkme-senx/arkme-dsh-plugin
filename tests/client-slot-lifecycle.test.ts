import { Context } from '@deepseek-ai/cordis'
import * as cordisModule from '@deepseek-ai/cordis'
import * as slotsModule from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { createClientLocaleStub } from './client-locale-stub.js'

type RuntimeModule = {
  SlotRegistry: new (ctx: Context) => {
    entries(key: string): ReadonlyArray<{ component: unknown; options: { priority?: number } }>
    entriesOfSlot(key: string): ReadonlyArray<{ component: unknown; options: { priority?: number } }>
    inject(key: string, callback: () => (() => void)): () => void
    register(options: unknown, component: () => unknown): () => void
    spec(key: string): unknown
  }
}

let cachedSlotRegistry: RuntimeModule['SlotRegistry'] | undefined

function restoreGlobalProperty(name: 'window' | 'document', descriptor: PropertyDescriptor | undefined): void {
  if (descriptor === undefined) delete (globalThis as unknown as Record<string, unknown>)[name]
  else Object.defineProperty(globalThis, name, descriptor)
}

async function loadSlotRegistry(): Promise<RuntimeModule['SlotRegistry']> {
  if (cachedSlotRegistry !== undefined) return cachedSlotRegistry
  let runtime: RuntimeModule | undefined
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __ModuleLoader__: {
        load(definition: { factory(require: (id: string) => unknown): RuntimeModule }) {
          runtime = definition.factory(id => {
            if (id === '@deepseek-ai/cordis') return cordisModule
            if (id === '@deepseek-ai/dsh-client-ui-slots') return slotsModule
            throw new Error(`unexpected runtime dependency: ${id}`)
          })
        },
      },
    },
  })
  try {
    await import('@deepseek-ai/dsh-client-runtime/client')
  } finally {
    restoreGlobalProperty('window', previousWindow)
  }
  if (runtime === undefined) throw new Error('DSH client runtime did not register with the module loader')
  cachedSlotRegistry = runtime.SlotRegistry
  return cachedSlotRegistry
}

afterEach(() => {
  vi.useRealTimers()
  arkmeUi.showConversations()
})

describe('Arkme directory slot lifecycle', () => {
  it('restarts directory consumers exactly once when the official settings sidebar returns', async () => {
    vi.useFakeTimers()
    const SlotRegistry = await loadSlotRegistry()
    const registry = new SlotRegistry(new Context())
    const disposeFrame = registry.register({
      name: 'root',
      children: {
        sidebar: { kind: 'single', scope: 'root' },
        conversation: { kind: 'single', scope: 'session' },
        details: { kind: 'single', scope: 'session-maybe' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
    }, () => null)

    let consumerActivations = 0
    let consumerDisposals = 0
    const stopConsumer = registry.inject('arkme.directory.entry', () => {
      consumerActivations += 1
      const disposeEntry = registry.register({
        name: 'arkme.directory.entry',
        id: 'test-directory-consumer',
      }, () => null)
      return () => {
        consumerDisposals += 1
        disposeEntry()
      }
    })

    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    let settingsDialogVisible = false
    const settingsTrigger = { click: vi.fn(() => { settingsDialogVisible = true }) }
    const sidebar = {
      querySelector: vi.fn((selector: string) => selector.includes('[data-arkme-owned=') ? null : settingsTrigger),
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        setInterval: (...args: Parameters<typeof setInterval>) => globalThis.setInterval(...args),
        clearInterval: (timer: ReturnType<typeof setInterval>) => globalThis.clearInterval(timer),
      },
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        querySelector: vi.fn((selector: string) => {
          if (selector === '[role="dialog"][aria-modal="true"]') return settingsDialogVisible ? {} : null
          if (selector === '[data-slot="sidebar"]') return sidebar
          return null
        }),
      },
    })

    const pluginCleanups: Array<() => void> = []
    try {
      apply({
        slots: registry,
        layout: { toggleSidebar: vi.fn(), closeDetails: vi.fn() },
        locale: createClientLocaleStub(),
        effect: (factory: () => unknown, label: string) => {
          if (!label.includes('embedded DeepSeek Harness') && !label.includes('official settings sidebar')) return () => {}
          const cleanup = factory()
          if (typeof cleanup === 'function') pluginCleanups.push(cleanup)
          return typeof cleanup === 'function' ? cleanup : () => {}
        },
      } as never)

      expect(consumerActivations).toBe(1)
      expect(registry.entries('arkme.directory.entry')).toHaveLength(1)

      arkmeUi.openDshSettings()

      expect(registry.spec('arkme.directory.entry')).toBeUndefined()
      expect(registry.entries('arkme.directory.entry')).toHaveLength(0)
      expect(consumerDisposals).toBe(1)

      vi.advanceTimersByTime(50)
      expect(settingsTrigger.click).toHaveBeenCalledOnce()
      expect(consumerActivations).toBe(1)

      vi.advanceTimersByTime(50)
      settingsDialogVisible = false
      vi.advanceTimersByTime(50)

      expect(registry.entries('arkme.directory.entry')).toHaveLength(1)
      expect(consumerActivations).toBe(2)
      expect(consumerDisposals).toBe(1)

      vi.advanceTimersByTime(2_000)
      expect(consumerActivations).toBe(2)
      expect(registry.entries('arkme.directory.entry')).toHaveLength(1)
    } finally {
      pluginCleanups.reverse().forEach(cleanup => { cleanup() })
      stopConsumer()
      disposeFrame()
      restoreGlobalProperty('window', previousWindow)
      restoreGlobalProperty('document', previousDocument)
    }
  })
})

describe('embedded DSH settings slot lifecycle', () => {
  it('restores the native settings entry when the Arkme shadow is disposed', async () => {
    const SlotRegistry = await loadSlotRegistry()
    const registry = new SlotRegistry(new Context())
    const disposeFrame = registry.register({
      name: 'root',
      children: {
        'sidebar.settings': { kind: 'single', scope: 'root' },
      },
    }, () => null)
    const NativeSettings = () => 'native settings'
    const disposeNativeSettings = registry.register({ name: 'sidebar.settings' }, NativeSettings)
    const injectionCleanups: Array<() => void> = []
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { search: '?arkme-harness-embed=1' } },
    })

    try {
      apply({
        slots: {
          inject: (key: string, callback: () => (() => void)) => {
            const cleanup = registry.inject(key, callback)
            injectionCleanups.push(cleanup)
            return cleanup
          },
          register: (options: unknown, component: () => unknown) => registry.register(options, component),
        },
        effect: vi.fn(),
      } as never)

      expect(registry.entries('sidebar.settings').map(entry => entry.options.priority ?? 0)).toEqual([-100, 0])
      expect(registry.entriesOfSlot('sidebar.settings')).toEqual([
        expect.objectContaining({ options: expect.objectContaining({ priority: -100 }) }),
      ])

      injectionCleanups.splice(0).reverse().forEach(cleanup => { cleanup() })
      expect(registry.entriesOfSlot('sidebar.settings').map(entry => entry.component)).toEqual([NativeSettings])
    } finally {
      injectionCleanups.splice(0).reverse().forEach(cleanup => { cleanup() })
      disposeNativeSettings()
      disposeFrame()
      restoreGlobalProperty('window', previousWindow)
    }
  })
})
