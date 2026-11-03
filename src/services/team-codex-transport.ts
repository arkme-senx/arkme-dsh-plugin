import { ArkmePluginError, type ServiceRuntime } from './service.js'

type TeamCodexRuntime = Pick<ServiceRuntime, 'config' | 'requireSession' | 'postDirect' | 'refreshAccessToken' | 'fetchImpl'>

/** Team Codex uses the account JWT, never the managed MCP credential. */
export async function teamCodexPost<T>(runtime: TeamCodexRuntime, owner: number, path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  if (![
    '/api/v1/team/list-mine', '/api/v1/team/members/list', '/api/v1/team-codex/sync',
    '/api/v1/team-codex/tasks/list',
    '/api/v1/team-codex/content/prepare','/api/v1/team-codex/content/commit','/api/v1/team-codex/content/list',
    '/api/v1/team-codex/sources/confirm', '/api/v1/team-codex/connection/status',
    '/api/v1/team-codex/sources/settings/update','/api/v1/team-codex/annotations/capabilities','/api/v1/team-codex/annotations/list','/api/v1/team-codex/annotations/change','/api/v1/team-codex/images/prepare','/api/v1/team-codex/share/resolve',
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
    result = await runtime.postDirect<T>(runtime.config.teamBaseUrl || (runtime.config.environment==='prod'?'https://team.jotmo.cc':'https://jotmo-team.senguo.me'), path, body, session.accessToken, [200], signal, true)
  } catch (error) {
    if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) throw error
    await assertOwner()
    await runtime.refreshAccessToken(session)
    session = await assertOwner()
    result = await runtime.postDirect<T>(runtime.config.teamBaseUrl || (runtime.config.environment==='prod'?'https://team.jotmo.cc':'https://jotmo-team.senguo.me'), path, body, session.accessToken, [200], signal, true)
  }
  await assertOwner()
  return result
}

const MAX_PRIVATE_IMAGE = 20 * 1024 * 1024

async function boundedResponse(response: Response, maximum: number, signal: AbortSignal): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    await response.body?.cancel()
    throw new ArkmePluginError('team-codex-response', '图片响应大小无效', false, 502)
  }
  if (!response.body) throw new ArkmePluginError('team-codex-response', '图片响应为空', true, 502)
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  const abort = () => { void reader.cancel(signal.reason).catch(() => undefined) }
  let length = 0
  signal.addEventListener('abort', abort, {once:true})
  try {
    for (;;) {
      signal.throwIfAborted()
      const next = await reader.read()
      signal.throwIfAborted()
      if (next.done) break
      length += next.value.byteLength
      if (length > maximum) throw new ArkmePluginError('team-codex-response', '图片超出大小限制', false, 502)
      chunks.push(next.value)
    }
    if (!length || declared !== null && length !== Number(declared)) {
      throw new ArkmePluginError('team-codex-response', '图片响应不完整', true, 502)
    }
    const result = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
    return result
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** Authenticated binary protocol; redirects and reusable object URLs are forbidden. */
export async function teamCodexBytes(
  runtime: TeamCodexRuntime, owner: number, path: string,
  body: Uint8Array | Record<string, unknown>, headers: Record<string, string>, signal: AbortSignal,
): Promise<Uint8Array | Record<string, unknown>> {
  if (!['/api/v1/team-codex/images/upload','/api/v1/team-codex/images/read'].includes(path)) {
    throw new ArkmePluginError('team-codex-invalid', '图片操作无效', false, 400)
  }
  if (body instanceof Uint8Array && (!body.byteLength || body.byteLength > MAX_PRIVATE_IMAGE)) {
    throw new ArkmePluginError('team-codex-invalid', '图片大小无效', false, 400)
  }
  const controller = new AbortController(), abort = () => controller.abort(signal.reason)
  signal.throwIfAborted()
  signal.addEventListener('abort', abort, {once:true})
  const timer = setTimeout(() => controller.abort(new Error('图片请求超时')), 15 * 60_000)
  const check = async () => {
    controller.signal.throwIfAborted()
    const session = await runtime.requireSession()
    controller.signal.throwIfAborted()
    if (session.userId !== owner) throw new ArkmePluginError('ACCOUNT_OR_DESTINATION_MISMATCH', '账号已切换', false, 409)
    return session
  }
  try {
    let session = await check()
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await runtime.fetchImpl(`${(runtime.config.teamBaseUrl || (runtime.config.environment === 'prod' ? 'https://team.jotmo.cc' : 'https://jotmo-team.senguo.me')).replace(/\/+$/, '')}${path}`, {
        method:'POST', redirect:'error',
        headers:{...headers, Authorization:`Bearer ${session.accessToken}`, Usersource:'3', 'Content-Type':body instanceof Uint8Array ? 'application/octet-stream' : 'application/json'},
        body:body instanceof Uint8Array ? Buffer.from(body) : JSON.stringify(body), signal:controller.signal,
      })
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel()
        await check(); await runtime.refreshAccessToken(session); session = await check()
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new ArkmePluginError(`team-codex-http-${response.status}`, '图片暂不可用，请重试', response.status >= 500, response.status)
      }
      const data = await boundedResponse(response, path.endsWith('/read') ? MAX_PRIVATE_IMAGE : 64 * 1024, controller.signal)
      await check()
      if (path.endsWith('/read')) return data
      let envelope: {code?:number;data?:Record<string,unknown>}
      try { envelope = JSON.parse(Buffer.from(data).toString('utf8')) }
      catch { throw new ArkmePluginError('team-codex-response', '图片上传结果未确认', true, 502) }
      if (envelope.code !== 200 || !envelope.data) throw new ArkmePluginError('team-codex-response', '图片上传结果未确认', true, 502)
      return envelope.data
    }
    throw new ArkmePluginError('auth-http-401', '登录已失效', false, 401)
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
