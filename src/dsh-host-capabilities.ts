import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'

export interface DshServiceContextLike {
  get(name: string): unknown
}

interface DshSessionControllerLike {
  openWorkspacePath(
    request: { path: string },
    signal: AbortSignal,
  ): Promise<{ opened: true }>
}

interface DshApiProxyLike {
  host: {
    openPath(
      request: { rpcId: string; payload: { path: string } },
      signal: AbortSignal,
    ): Promise<{
      result:
        | { ok: true; value: { opened: true } }
        | { ok: false; error: { message: string } }
    }>
  }
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null
}

export async function pickDshHostDirectory(
  ctx: DshServiceContextLike,
  signal: AbortSignal,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  signal.throwIfAborted()
  const endpoint = environment.ARKME_DIRECTORY_PICKER_BRIDGE_URL?.trim()
  const token = environment.ARKME_DIRECTORY_PICKER_BRIDGE_TOKEN?.trim()
  if (endpoint || token) {
    let url: URL
    try { url = new URL(endpoint ?? '') } catch { throw new Error('桌面目录选择配置无效') }
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || !url.port || url.pathname !== '/choose-directory' || url.search || url.hash || url.username || url.password
      || !token || token.length < 16 || token.length > 512 || /\s/.test(token)) throw new Error('桌面目录选择配置无效')
    // Desktop owns its modal dialog; the DSH Windows worker has a separate IPC lifecycle.
    const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal,
      headers: { 'content-type': 'application/json', 'x-arkme-picker-token': token },
      body: JSON.stringify({ title: '选择导出文件夹' }) })
    if (!response.ok) throw new Error('桌面目录选择失败，请重试')
    const value: unknown = await response.json()
    if (isRecord(value) && value.canceled === true) return null
    if (!isRecord(value) || value.canceled !== false || typeof value.path !== 'string'
      || value.path.includes('\0') || !isAbsolute(value.path)) throw new Error('桌面目录选择返回了无效响应')
    return value.path
  }
  const picker = ctx.get('directoryPicker') as { capability?: () => { kind: string; pick: (signal: AbortSignal) => Promise<string | null> } } | undefined
  const capability = picker?.capability?.()
  if (capability?.kind !== 'native') throw new Error('当前宿主没有本机目录选择能力，请在桌面客户端导出')
  return capability.pick(signal)
}

function sessionController(value: unknown): DshSessionControllerLike | undefined {
  if (!isRecord(value) || typeof value.openWorkspacePath !== 'function') return undefined
  return value as unknown as DshSessionControllerLike
}

function apiProxy(value: unknown): DshApiProxyLike | undefined {
  if (!isRecord(value) || !isRecord(value.host) || typeof value.host.openPath !== 'function') return undefined
  return value as unknown as DshApiProxyLike
}

/**
 * Open one Arkme-owned, already-validated local path through the current DSH
 * Host capability. The service shape is detected at call time so one plugin
 * package works with both the Typert Remote and legacy ApiProxy generations.
 */
export async function openDshHostPath(
  ctx: DshServiceContextLike,
  path: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()

  const current = sessionController(ctx.get('sessionController'))
  if (current !== undefined) {
    const response = await current.openWorkspacePath({ path }, signal)
    if (!isRecord(response) || response.opened !== true) {
      throw new Error('DSH sessionController.openWorkspacePath 返回了无效响应')
    }
    return
  }

  const legacy = apiProxy(ctx.get('apiProxy'))
  if (legacy === undefined) throw new Error('当前 DSH 宿主未提供本机文件打开能力')
  const response = await legacy.host.openPath({ rpcId: randomUUID(), payload: { path } }, signal)
  if (!isRecord(response) || !isRecord(response.result)) {
    throw new Error('DSH apiProxy.host.openPath 返回了无效响应')
  }
  if (response.result.ok === false) {
    const error = response.result.error
    throw new Error(isRecord(error) && typeof error.message === 'string'
      ? error.message
      : 'DSH apiProxy.host.openPath 调用失败')
  }
  if (response.result.ok !== true || !isRecord(response.result.value) || response.result.value.opened !== true) {
    throw new Error('DSH apiProxy.host.openPath 返回了无效响应')
  }
}
