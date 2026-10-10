import { runInNewContext } from 'node:vm'
import { HARNESS_SESSION_RESTORE_SCRIPT } from '../src/harness-session-restore-script.js'
import { Context } from '@deepseek-ai/cordis'
import * as cordis from '@deepseek-ai/cordis'
import * as slots from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionRuntime, WorkspaceRuntime } from '@deepseek-ai/dsh-client-runtime/client'
import { afterEach, expect, it, vi } from 'vitest'
import { observeHarnessSessionSelection } from '../src/client/harness-session-selection.js'

type Runtime = { SessionRuntime: typeof SessionRuntime; WorkspaceRuntime: typeof WorkspaceRuntime }
let runtime: Runtime
const cleanup: Array<() => unknown> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.unstubAllGlobals() })

async function boot(sessionId: string | null, failList = false, subagentAddress?: { parentSessionId: string; childSessionId: string; mode: 'continuable' }) {
  const values = new Map(sessionId === null ? [] : [['dsh.sessions.current', JSON.stringify({ sessionId, ...(subagentAddress ? { subagentAddress } : {}) })]])
  let restored = values.get('dsh.sessions.current') ?? null
  class Storage {
    getItem(key: string) { return values.get(key) ?? null }
    setItem(key: string, value: string) { values.set(key, value) }
  }
  const storage = new Storage()
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { __ModuleLoader__: { load: (entry: { factory(require: (id: string) => unknown): Runtime }) => {
    runtime = entry.factory(id => {
      if (id === '@deepseek-ai/cordis') return cordis
      if (id === '@deepseek-ai/dsh-client-ui-slots') return slots
      throw new Error(`Unexpected runtime dependency ${id}`)
    })
  } } })
  await import('@deepseek-ai/dsh-client-runtime/client')
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  const ok = (value: unknown) => Promise.resolve({ result: { ok: true, value } })
  let fail = failList
  const summary = (id: string, blank = false) => ({ sessionId: id, cwd: '/work', updatedAt: 1, running: false, blank })
  const create = vi.fn(async () => ({ result: { ok: true, value: { sessionId: 'new-blank' } } }))
  const api = {
    sessions: {
      list: () => fail ? Promise.reject(new Error('offline')) : ok({ items: [summary('A'), summary('B')] }),
      create,
      history: () => ok({ events: [], hasMore: false, running: false }),
    },
    subagents: {
      list: () => ok({ parentAvailable: true, entries: subagentAddress ? [{ kind: 'child', id: 'child', mode: 'continuable', activity: 'idle' }] : [] }),
      history: () => ok({ events: [], hasMore: false }),
    },
    workspace: { list: () => ok({ items: [{ workspaceId: 'work', path: '/work', sessionIds: ['A', 'B'], createdAt: 1 }], archivedSessionIds: [] }) },
  }
  // Reproduce the actual desktop's two runtime boot: the root starts a pending
  // list pull and clears the shared selection key before the iframe constructs.
  const outerCtx = new Context()
  cleanup.push(() => outerCtx.fiber.dispose())
  const outer = new runtime.SessionRuntime(outerCtx, {
    ...api, sessions: { ...api.sessions, list: () => new Promise(() => {}) },
  } as never, {} as never)
  outer.handleConnected()
  await Promise.resolve()
  if (sessionId !== null && !subagentAddress) expect(values.get('dsh.sessions.current')).toBe('{}')
  runInNewContext(HARNESS_SESSION_RESTORE_SCRIPT, { Storage, window: {
    localStorage: storage, parent: { arkmeDesktop: { sessionSelection: { restore: () => restored } } },
  } })
  const sessions = new runtime.SessionRuntime(ctx, api as never, {} as never)
  const workspaces = new runtime.WorkspaceRuntime(ctx, api as never, sessions)
  cleanup.push(workspaces.startInitialSelection())
  const saved: string[] = []
  cleanup.push(observeHarnessSessionSelection(sessions, { save: async (id, address) => { saved.push(id); restored = JSON.stringify({ sessionId: id, subagentAddress: address }); return true } }))
  sessions.handleConnected()
  workspaces.handleConnected()
  return { sessions, workspaces, saved, create, reconnect: () => { fail = false; sessions.handleConnected() } }
}

it('the real Harness runtime restores before default creation and emits changes for open and new-session actions', async () => {
  const f = await boot('A')
  await vi.waitFor(() => expect(f.sessions.list.getSnapshot().current).toBe('A'))
  expect(f.workspaces.list.getSnapshot().baselinesReady).toBe(true)
  expect(f.create).not.toHaveBeenCalled()
  f.sessions.open('B' as never)
  await vi.waitFor(() => expect(f.saved.at(-1)).toBe('B'))
  f.workspaces.startSession()
  await vi.waitFor(() => expect(f.saved.at(-1)).toBe('new-blank'))
  expect(f.create).toHaveBeenCalledTimes(1)
})

it('the real Harness runtime falls back only after a successful list proves the saved session is missing', async () => {
  const f = await boot('deleted', true)
  await vi.waitFor(() => expect(f.workspaces.list.getSnapshot().phase).toBe('ready'))
  expect(f.workspaces.list.getSnapshot().baselinesReady).toBe(false)
  expect(f.create).not.toHaveBeenCalled()
  expect(f.saved).toEqual([])
  f.reconnect()
  await vi.waitFor(() => expect(f.sessions.list.getSnapshot().current).toBe('new-blank'))
  expect(f.create).toHaveBeenCalledTimes(1)
  await vi.waitFor(() => expect(f.saved).toEqual(['new-blank']))
})


it('restores a catalog child using its persisted public parent/child address', async () => {
  const f = await boot('child', false, { parentSessionId: 'A', childSessionId: 'child', mode: 'continuable' })
  await vi.waitFor(() => expect(f.sessions.list.getSnapshot().current).toBe('child'))
  expect(f.sessions.list.getSnapshot().currentAddress).toEqual({ parentSessionId: 'A', childSessionId: 'child', mode: 'continuable' })
  expect(f.create).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(f.saved).toContain('child'))
})
