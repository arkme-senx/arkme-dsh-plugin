/** Display v3.<plugin patch>.<client code>; never invent missing build metadata. */
export function formatProductVersion(pluginVersion: string, clientVersionCode: unknown): string {
  const patch = /^\d+\.\d+\.(\d+)(?:[-+].*)?$/.exec(pluginVersion)?.[1]
  if (patch === undefined) return `v${pluginVersion}`
  const version = `v3.${patch}`
  return Number.isSafeInteger(clientVersionCode) && (clientVersionCode as number) > 0
    && (clientVersionCode as number) <= 2_147_483_647
    ? `${version}.${clientVersionCode}`
    : version
}

export function currentClientVersionCode(): unknown {
  if (typeof window === 'undefined') return undefined
  return (window as Window & { arkmeDesktop?: { appVersionCode?: unknown } }).arkmeDesktop?.appVersionCode
}
