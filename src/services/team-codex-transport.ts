import { ArkmePluginError, type ServiceRuntime } from './service.js'

type TeamCodexRuntime = Pick<ServiceRuntime, 'config' | 'requireSession' | 'postDirect' | 'refreshAccessToken'>

/** Team Codex uses the account JWT, never the managed MCP credential. */
export async function teamCodexPost<T>(runtime: TeamCodexRuntime, owner: number, path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  if (runtime.config.environment !== 'prod' || ![
    '/api/v1/team/list-mine', '/api/v1/team/members/list', '/api/v1/team-codex/sync',
    '/api/v1/team-codex/tasks/list', '/api/v1/team-codex/events/list',
  ].includes(path)) throw new ArkmePluginError('team-codex-disabled', '当前环境未配置团队云端同步', false, 403)
  const assertOwner = async () => {
    const session = await runtime.requireSession()
    signal.throwIfAborted()
    if (session.userId !== owner) throw new ArkmePluginError('ACCOUNT_OR_DESTINATION_MISMATCH', '账号已切换，已停止云端同步', false, 409)
    return session
  }
  let session = await assertOwner()
  let result: T
  try {
    result = await runtime.postDirect<T>('https://team.jotmo.cc', path, body, session.accessToken, [200], signal, true)
  } catch (error) {
    if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) throw error
    await assertOwner()
    await runtime.refreshAccessToken(session)
    session = await assertOwner()
    result = await runtime.postDirect<T>('https://team.jotmo.cc', path, body, session.accessToken, [200], signal, true)
  }
  await assertOwner()
  return result
}
