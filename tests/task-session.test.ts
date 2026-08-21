import { describe, expect, it, vi } from 'vitest'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import { needsArkmeWorkspaceBrowser, resolveArkmeTaskSession } from '../src/client/redesign/task-session.js'

function runtimeState({
  current,
  recentWorkspaceId,
  workspaces,
}: {
  current?: string
  recentWorkspaceId?: string
  workspaces: Array<{ workspaceId: string; path: string; sessionIds: string[] }>
}) {
  const open = vi.fn()
  const create = vi.fn(async () => ({
    workspaceId: 'workspace:new', title: 'project', path: '/tmp/project', sessionIds: [], createdAt: new Date(0).toISOString(),
  }))
  const connectWorkspace = vi.fn(async () => 'session:new')
  const sessions = {
    list: { getSnapshot: () => ({ current }) },
    open,
  } as unknown as ISessions
  const workspaceRuntime = {
    list: { getSnapshot: () => ({ items: workspaces, recentWorkspaceId }) },
    create,
    connectWorkspace,
  } as unknown as IWorkspaces
  return { sessions, workspaceRuntime, open, create, connectWorkspace }
}

describe('Arkme task session resolution', () => {
  it('adopts a browsed directory and opens a real DSH session when no workspace exists', async () => {
    const runtime = runtimeState({ workspaces: [] })

    await expect(resolveArkmeTaskSession(runtime.workspaceRuntime, runtime.sessions, { path: '/tmp/project' })).resolves.toBe('session:new')
    expect(runtime.create).toHaveBeenCalledWith({ path: '/tmp/project' })
    expect(runtime.connectWorkspace).toHaveBeenCalledWith('workspace:new')
    expect(runtime.open).toHaveBeenCalledWith('session:new')
  })

  it('uses the current session workspace before the recent workspace', async () => {
    const runtime = runtimeState({
      current: 'session:current', recentWorkspaceId: 'workspace:recent',
      workspaces: [
        { workspaceId: 'workspace:current', path: '/tmp/current', sessionIds: ['session:current'] },
        { workspaceId: 'workspace:recent', path: '/tmp/recent', sessionIds: [] },
      ],
    })

    await resolveArkmeTaskSession(runtime.workspaceRuntime, runtime.sessions)
    expect(runtime.connectWorkspace).toHaveBeenCalledWith('workspace:current')
  })

  it('requests the browser flow when there is no usable workspace yet', async () => {
    const runtime = runtimeState({ workspaces: [] })

    await expect(resolveArkmeTaskSession(runtime.workspaceRuntime, runtime.sessions)).resolves.toBeUndefined()
    expect(runtime.create).not.toHaveBeenCalled()
    expect(runtime.connectWorkspace).not.toHaveBeenCalled()
    expect(runtime.open).not.toHaveBeenCalled()
  })
})

describe('Arkme task workspace picker capability', () => {
  it('falls back to the browser dialog only for a browse-capable host', () => {
    expect(needsArkmeWorkspaceBrowser(new Error('host.pickDirectory needs the native capability; the composed picker serves "browse"'))).toBe(true)
    expect(needsArkmeWorkspaceBrowser(new Error('directory-picker-unavailable'))).toBe(false)
  })
})
