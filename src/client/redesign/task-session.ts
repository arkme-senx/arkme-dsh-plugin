import type { ISessions, IWorkspaces, SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'

export function needsArkmeWorkspaceBrowser(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('needs the native capability') && message.includes('serves "browse"')
}

/**
 * Resolve the native DSH Session that backs an Arkme task.
 *
 * DSH deliberately keeps the no-workspace state session-less. The redesigned
 * task composer therefore has to complete the native workspace flow before it
 * can hand a prompt to an Agent.
 */
export async function resolveArkmeTaskSession(
  workspaces: IWorkspaces,
  sessions: ISessions,
  options: { workspaceId?: WorkspaceId; path?: string } = {},
): Promise<SessionId | undefined> {
  const workspaceSnapshot = workspaces.list.getSnapshot()
  const currentSessionId = sessions.list.getSnapshot().current
  const currentWorkspaceId = currentSessionId === undefined
    ? undefined
    : workspaceSnapshot.items.find(workspace => workspace.sessionIds.includes(currentSessionId))?.workspaceId

  let workspaceId = options.workspaceId ?? currentWorkspaceId ?? workspaceSnapshot.recentWorkspaceId
  if (workspaceId === undefined) {
    if (options.path === undefined) return undefined
    const workspace = await workspaces.create({ path: options.path })
    workspaceId = workspace.workspaceId
  }

  const sessionId = await workspaces.connectWorkspace(workspaceId)
  sessions.open(sessionId)
  return sessionId
}
