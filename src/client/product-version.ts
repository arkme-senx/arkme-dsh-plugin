/** Missing build metadata on older clients must not produce a synthetic build number. */
export function formatProductVersion(pluginVersion: string, clientVersionCode: unknown): string {
  return Number.isSafeInteger(clientVersionCode) && (clientVersionCode as number) > 0
    && (clientVersionCode as number) <= 2_147_483_647
    ? `v${pluginVersion}+${clientVersionCode}`
    : `v${pluginVersion}`
}

export function currentClientVersionCode(): unknown {
  if (typeof window === 'undefined') return undefined
  return (window as Window & { arkmeDesktop?: { appVersionCode?: unknown } }).arkmeDesktop?.appVersionCode
}
