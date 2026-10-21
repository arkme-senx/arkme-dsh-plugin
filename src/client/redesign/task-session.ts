import type { HarnessSessions } from '../harness-session-state.js'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { IWorkspaces, WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

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
  sessions: HarnessSessions,
  options: { workspaceId?: WorkspaceId; path?: string } = {},
  navigation: Pick<UiWorkspace, 'connectWorkspace'>,
): Promise<SessionId | undefined> {
  const workspaceSnapshot = workspaces.list.getSnapshot()
  const currentSessionId = sessions.list.getSnapshot().current
  const currentWorkspaceId = currentSessionId === undefined
    ? undefined
    : workspaceSnapshot.items.find(workspace => workspace.sessionIds.includes(currentSessionId))?.workspaceId

  let workspaceId = options.workspaceId ?? currentWorkspaceId ?? workspaceSnapshot.items[0]?.workspaceId
  if (workspaceId === undefined) {
    if (options.path === undefined) return undefined
    const workspace = await workspaces.create({ path: options.path })
    workspaceId = workspace.workspaceId
  }

  const sessionId = await navigation.connectWorkspace(workspaceId)
  sessions.open(sessionId)
  return sessionId
}
