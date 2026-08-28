import { randomUUID } from 'node:crypto'

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
