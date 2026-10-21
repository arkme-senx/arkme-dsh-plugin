import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import * as cordis from '@deepseek-ai/cordis'
import * as store from '@deepseek-ai/dsh-client-store'
import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import { afterEach, expect, it, vi } from 'vitest'
import { HARNESS_SESSION_RESTORE_SCRIPT } from '../src/harness-session-restore-script.js'
import { ArkmeLayoutController } from '../src/client/redesign/layout-controller.js'
import { harnessSessions } from '../src/client/harness-session-state.js'
import { observeHarnessSessionSelection } from '../src/client/harness-session-selection.js'

const cleanup: Array<() => unknown> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.unstubAllGlobals() })

async function boot(savedId: string, loading = false, address?: object) {
  const saved = JSON.stringify({ sessionId: savedId, ...(address ? { subagentAddress: address } : {}) })
  const values = new Map([['dsh.sessions.current', '{}']])
  class Storage {
    getItem(key: string) { return values.get(key) ?? null }
    setItem(key: string, value: string) { values.set(key, value) }
    removeItem(key: string) { values.delete(key) }
  }
  const storage = new Storage()
  runInNewContext(HARNESS_SESSION_RESTORE_SCRIPT, { Storage, window: {
    localStorage: storage, parent: { arkmeDesktop: { sessionSelection: { restore: () => saved } } },
  } })
  vi.stubGlobal('localStorage', storage)
  const summary = (id: string) => ({ id, displayTitle: id, blank: false, cwd: '/work', running: false, updatedAt: 1, retainedBy: {} })
  const list = store.createSnapshotStore<any>({ phase: loading ? 'loading' : 'ready', ids: ['A', 'B'], byId: { A: summary('A'), B: summary('B') }, projectionsBySession: {} })
  const addresses = new Map<string, object>()
  const create = vi.fn(async () => {
    list.set({ ...list.getSnapshot(), ids: [...list.getSnapshot().ids, 'new-blank'], byId: { ...list.getSnapshot().byId, 'new-blank': summary('new-blank') } })
    return 'new-blank'
  })
  const sessions = { list, create, subagentAddress: (id: string) => addresses.get(id), retain(target: string | any) {
    const id = typeof target === 'string' ? target : target.childSessionId
    if (typeof target !== 'string') addresses.set(id, target)
    const update = (count: number) => list.set({ ...list.getSnapshot(), byId: { ...list.getSnapshot().byId, [id]: { ...(list.getSnapshot().byId[id] ?? summary(id)), retainedBy: { mainView: count } } } })
    update(1)
    return { sessionId: id, release: () => update(0) }
  } }
  const workspaces = { list: store.createSnapshotStore({ phase: 'ready', items: [{ workspaceId: 'work', title: 'work', path: '/work', sessionIds: ['A', 'B'], createdAt: '2026-01-01', updatedAt: '2026-01-01' }], archivedSessionIds: [] }) }
  const ctx = new cordis.Context()
  cleanup.push(() => ctx.fiber.dispose())
  ctx.provide('sessions', sessions as never); ctx.provide('workspaces', workspaces as never)
  ctx.provide('remote', { directoryPicker: {} } as never)
  ctx.provide('layout', new ArkmeLayoutController())
  // Mount the published 0.2 UI navigation service; stop at the renderer boundary.
  // Controller snapshots/retention are explicit fixtures, not a copied navigation algorithm.
  const rendererBoundary = new Error('renderer outside navigation test')
  ctx.provide('slots', { provideRoot: () => { throw rendererBoundary } } as never)
  let plugin: any
  const modules: Record<string, unknown> = { '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-store': store,
    '@deepseek-ai/dsh-client-ui-primitives': {}, react: React, 'react/jsx-runtime': jsx }
  const source = await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js', import.meta.url), 'utf8')
  runInNewContext(source, { window: { __ModuleLoader__: { load: (entry: any) => { plugin = entry.factory((id: string) => { if (!(id in modules)) throw Error(id); return modules[id] }) } } },
    AbortController, AbortSignal, console, setTimeout, clearTimeout, queueMicrotask })
  expect(() => plugin.apply(ctx)).toThrow(rendererBoundary)
  const adapted = harnessSessions(ctx)
  const persisted: string[] = []
  cleanup.push(observeHarnessSessionSelection(adapted, { save: async id => { persisted.push(id); return true } }))
  return { ctx, adapted, list, create, persisted }
}

it('restores before creating defaults and observes native UI navigation through public ownership', async () => {
  const f = await boot('A')
  await vi.waitFor(() => expect(f.adapted.list.getSnapshot().current).toBe('A'))
  expect(f.create).not.toHaveBeenCalled()
  f.ctx.uiWorkspace.openSession('B' as never)
  await vi.waitFor(() => expect(f.persisted.at(-1)).toBe('B'))
  f.ctx.uiWorkspace.startSession('work' as never)
  await vi.waitFor(() => expect(f.adapted.list.getSnapshot().current).toBe('new-blank'))
  expect(f.create).toHaveBeenCalledOnce()
})

it('waits for a ready catalog before replacing a missing saved selection', async () => {
  const f = await boot('deleted', true)
  expect(f.create).not.toHaveBeenCalled(); expect(f.persisted).toEqual([])
  f.list.set({ ...f.list.getSnapshot(), phase: 'ready' })
  await vi.waitFor(() => expect(f.adapted.list.getSnapshot().current).toBe('new-blank'))
  expect(f.create).toHaveBeenCalledOnce()
})

it('restores the public durable parent/child address', async () => {
  const address = { parentSessionId: 'A', childSessionId: 'child', mode: 'continuable' }
  const f = await boot('child', false, address)
  await vi.waitFor(() => expect(f.adapted.list.getSnapshot().current).toBe('child'))
  expect(f.adapted.list.getSnapshot().currentAddress).toEqual(address)
  expect(f.create).not.toHaveBeenCalled()
})
