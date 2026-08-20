export const ARKME_EXTENSION_FORMAT = 'arkme-cordis-extension' as const
export const ARKME_EXTENSION_FORMAT_VERSION = 1 as const
export const ARKME_EXTENSION_MAX_BYTES = 100 * 1024 * 1024

export type ArkmeExtensionVisibility = 'private' | 'unlisted' | 'public'
export type ArkmeExtensionChannel = 'stable' | 'beta'

export interface ArkmeExtensionManifest {
  format: typeof ARKME_EXTENSION_FORMAT
  format_version: typeof ARKME_EXTENSION_FORMAT_VERSION
  name: string
  description: string
  version: string
  runtime: {
    dsh: string
    arkme_provider_contract: number
  }
  halves: { host: boolean; client: boolean }
  permissions: string[]
  entrypoints: { host?: 'host.js'; client?: 'client.js' }
}

export interface ArkmeExtensionArtifact {
  bytes: Uint8Array
  artifactSha256: string
  manifestSha256: string
  manifest: ArkmeExtensionManifest
}

export interface ArkmeExtensionCatalogItem {
  extension_id: string
  name: string
  description: string
  owner_user_id?: number
  owner_name?: string
  owner_arkme_id?: string
  visibility: ArkmeExtensionVisibility
  latest_stable_version?: string
  version?: string
  channel?: ArkmeExtensionChannel
  manifest?: ArkmeExtensionManifest
  updated_at?: string
  installed_version?: string
  update_available?: boolean
}

export interface ArkmeExtensionCatalogPage {
  items: ArkmeExtensionCatalogItem[]
  total: number
  next_cursor?: string
}

export interface ArkmeExtensionPublishSession {
  publish_session_id: string
  extension_id: string
  upload_url: string
  upload_method?: 'PUT'
  upload_headers?: Record<string, string>
  expires_at: string | number
  version?: string
  status?: string
  idempotent_replay?: boolean
}

export interface ArkmeExtensionPublishResult {
  publish_session_id?: string
  extension_id: string
  version: string
  status: 'uploading' | 'validating' | 'published' | 'rejected' | 'expired'
  artifact_sha256?: string
  validation_error_code?: string
  validation_error_message?: string
}

export interface ArkmeExtensionDeleteResult {
  extension_id: string
  status: 'deleted'
  deleted_at: number
}

export interface ArkmeExtensionInstallResolution {
  extension_id: string
  version: string
  artifact_url: string
  artifact_headers?: Record<string, string>
  artifact_expires_at?: string | number
  artifact_size?: number
  artifact_sha256: string
  manifest_sha256: string
  manifest: ArkmeExtensionManifest
  signature: string
  signing_key_id: string
  published_at: number
  revoked: boolean
  revocation_reason?: string
}

export interface ArkmeExtensionInstallPreview {
  extension_id: string
  version: string
  artifact_size?: number
  manifest: ArkmeExtensionManifest
  revoked: boolean
  revocation_reason?: string
}

export interface ArkmeInstalledExtension {
  extensionId: string
  installedVersion: string
  artifactSha256: string
  artifactPath: string
  manifest: ArkmeExtensionManifest
  enabled: boolean
  active: boolean
  dynamicPluginId?: string
  dynamicPackageId?: string
  profilePackageName?: string
  profileBundlePath?: string
  permissionSnapshot: string[]
  updateChannel: ArkmeExtensionChannel
  installedAtMillis: number
  lastCheckedAtMillis: number
  lastError?: string
}

export interface ArkmeExtensionUpdateResolution {
  extension_id: string
  installed_version: string
  latest_version?: string
  update_available: boolean
  revoked: boolean
  revocation_reason?: string
  permissions_added?: string[]
}

export type ArkmeExtensionInstallPhase =
  | 'resolving'
  | 'downloading'
  | 'verifying'
  | 'persisting'
  | 'registering'
  | 'applying'
  | 'paused'
  | 'awaiting-approval'
  | 'installed'
  | 'active'
  | 'failed'

export interface ArkmeExtensionInstallProgress {
  phase: ArkmeExtensionInstallPhase
  version?: string
  downloadedBytes?: number
  totalBytes?: number
  message?: string
}

export interface ArkmeExtensionInstallTaskSnapshot extends ArkmeExtensionInstallProgress {
  taskId: string
  extensionId: string
  sessionId: string
  done: boolean
  updatedAtMillis: number
  result?: {
    installed: boolean
    active: boolean
    approvalRequired: boolean
    restartRequired: boolean
  }
  error?: { code: string; message: string; retryable: boolean }
}

export interface DynamicCordisPackageInspectionLike {
  pluginId: string
  packageId: string
  name: string
  purpose: string
  code: { host?: string; client?: string }
  currentPackageId?: string
  activeRun?: { pluginRunId: string; packageId: string }
}

export interface DynamicCordisInventoryPackageLike {
  packageId: string
  name: string
  purpose: string
  hasHostHalf: boolean
  hasClientHalf: boolean
}

export interface DynamicCordisInventoryRowLike {
  pluginId: string
  agentId: string
  packages: DynamicCordisInventoryPackageLike[]
  currentPackageId?: string
  nextPackageId?: string
  activeRun?: { pluginRunId: string; packageId: string }
}

export interface DynamicCordisRunnerLike {
  inventory?(): DynamicCordisInventoryRowLike[]
  inspectPackage(agent: unknown, pluginId: string, packageId: string): DynamicCordisPackageInspectionLike
  define(request: {
    sessionId: string
    plugin: { kind: 'new'; idPrefix: string } | { kind: 'existing'; pluginId: string }
    name: string
    purpose: string
    code: { host?: string; client?: string }
  }): { pluginId: string; packageId: string }
  run(
    agent: unknown,
    pluginId: string,
    packageId: string,
    mode: 'run' | 'update',
    signal?: AbortSignal,
  ): Promise<{
    ok: boolean
    status?: 'awaiting-approval' | 'starting' | 'running'
    pluginId?: string
    packageId?: string
    message?: string
  }>
  undefine?(agent: unknown, pluginId: string): Promise<{
    ok: boolean
    wasRunning?: boolean
    reason?: string
    message?: string
  }>
}
