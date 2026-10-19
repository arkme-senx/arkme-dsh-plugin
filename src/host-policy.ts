/** Trusted desktop-host policy. Request parameters and plugin preferences cannot override it. */
export const ARKME_HOST_POLICY_VERSION = 1
export type HostCapability = 'clientSelfUpdate' | 'runtimeSelfUpdate' | 'executableExtensionInstall'
export interface ArkmeHostPolicy {
  schemaVersion: 1
  distribution: 'website' | 'mas'
  capabilities: Readonly<Record<HostCapability, boolean>>
  credentialServicePrefix?: string
}
const names: HostCapability[] = ['clientSelfUpdate', 'runtimeSelfUpdate', 'executableExtensionInstall']
export function resolveHostPolicy(env: Readonly<Record<string, string | undefined>> = process.env): ArkmeHostPolicy {
  const raw = env.ARKME_HOST_POLICY
  if (raw === undefined) return {schemaVersion:1, distribution:'website', capabilities:{clientSelfUpdate:true,runtimeSelfUpdate:true,executableExtensionInstall:true}}
  let value: ArkmeHostPolicy
  try { value = JSON.parse(raw) as ArkmeHostPolicy } catch { throw new Error('ARKME_HOST_POLICY_INVALID') }
  if (!value || value.schemaVersion !== 1 || !['website','mas'].includes(value.distribution)
    || !value.capabilities || names.some(name => typeof value.capabilities[name] !== 'boolean')) throw new Error('ARKME_HOST_POLICY_INVALID')
  if (value.distribution === 'mas' && (names.some(name => value.capabilities[name])
    || value.credentialServicePrefix !== 'com.senqisi.dsh-arkme.mas')) throw new Error('ARKME_HOST_POLICY_INVALID')
  if (value.credentialServicePrefix !== undefined && !/^[a-zA-Z0-9.-]{1,160}$/.test(value.credentialServicePrefix)) throw new Error('ARKME_HOST_POLICY_INVALID')
  return value
}
export function hostAllows(capability: HostCapability): boolean { return resolveHostPolicy().capabilities[capability] }
export function assertHostCapability(capability: HostCapability): void {
  const policy = resolveHostPolicy()
  if (!policy.capabilities[capability]) throw new Error(policy.distribution === 'mas'
    ? '该功能仅在官网版本中可用。'
    : `ARKME_CAPABILITY_DISABLED: ${capability}`)
}
