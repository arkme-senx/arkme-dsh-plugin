export const ARKME_EXTENSION_FORMAT = 'arkme-cordis-extension' as const
export const ARKME_EXTENSION_FORMAT_VERSION = 1 as const
export const ARKME_EXTENSION_MAX_BYTES = 100 * 1024 * 1024
export const ARKME_EXTENSION_ICON_MAX_BYTES = 2 * 1024 * 1024
export const ARKME_EXTENSION_PREVIEW_MAX_BYTES = 5 * 1024 * 1024
export const ARKME_EXTENSION_PREVIEW_MAX_ITEMS = 20

export type ArkmeExtensionVisibility = 'private' | 'unlisted' | 'public'
export type ArkmeExtensionEditableVisibility = 'private' | 'public'
export type ArkmeExtensionChannel = 'stable' | 'beta'
export type ArkmeNativeCapability =
  | 'runtime_dependencies'
  | 'optional_dependencies'
  | 'bundled_dependencies'
  | 'peer_dependencies'
  | 'lifecycle_scripts'
  | 'bin'
  | 'native_addon'
  | 'profile_patch_override'
  | 'external_package_reference'
export type ArkmeExtensionCatalogSort = 'rating' | 'comments' | 'opens' | 'created_at'
export type ArkmeExtensionClassificationStatus = 'unavailable' | 'building' | 'ready' | 'failed' | 'empty'
export type ArkmeExtensionPublisherRole = 'author' | 'importer'

export interface ArkmeExtensionRatingSummary {
  average: number
  count: number
  /** Index 0..4 corresponds to 1..5 stars. */
  histogram: [number, number, number, number, number]
}

export interface ArkmeExtensionSource {
	type: 'github_repository'
	url: string
	label: string
	verification: 'publisher_attested'
}

export interface ArkmeExtensionShare {
	ref: string
	url: string
}

export interface ArkmeSharedExtensionPreview {
	preview_ref: string
	width: number
	height: number
}

/** Link-capability projection. It intentionally contains no extension_id or install facts. */
export interface ArkmeSharedExtensionDetail {
	name: string
	description: string
	visibility: 'private' | 'public'
	share_scope: 'link_readonly'
	latest_stable_version: string
	icon_ref?: string
	preview_images: ArkmeSharedExtensionPreview[]
	rating_summary: ArkmeExtensionRatingSummary
	source?: ArkmeExtensionSource
}

/** Optional author projection returned by GitHub-imported marketplace entries. */
export interface ArkmeExtensionSourceAuthor {
  name?: string
  avatar_url?: string
  profile_url?: string
}

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
  owner_avatar_ref?: string
  owner_avatar_fallback?: ArkmeExtensionReviewAvatarFallback
  source_author?: ArkmeExtensionSourceAuthor
  publisher_role?: ArkmeExtensionPublisherRole
  visibility: ArkmeExtensionVisibility
  status?: 'active' | 'suspended' | 'deleted'
  latest_stable_version?: string
  version?: string
  channel?: ArkmeExtensionChannel
  manifest?: ArkmeExtensionManifest
  updated_at?: number
  created_at?: number
  comment_count?: number
  open_count?: number
  view_count?: number
  install_user_count?: number
  installed_version?: string
  update_available?: boolean
  package_name?: string
  artifact_contract_version?: 2 | 3
  artifact_kind?: 'dsh-bundle-tgz' | 'dsh-native-package-tgz'
  execution_model?: 'arkme-sandboxed' | 'dsh-native'
  native_capabilities?: ArkmeNativeCapability[]
  icon_ref?: string
  preview_cover_ref?: string
  preview_count?: number
  preview_images?: ArkmeExtensionPreviewItem[]
  preview_revision?: number
  rating_summary?: ArkmeExtensionRatingSummary
	source?: ArkmeExtensionSource
	share?: ArkmeExtensionShare
}

export interface ArkmeExtensionMetadataUpdateInput {
  name: string
  description: string
  visibility: ArkmeExtensionEditableVisibility
  clientMutationId: string
}

export interface ArkmeExtensionMetadataUpdateResult {
  extension: ArkmeExtensionCatalogItem
}

export interface ArkmeExtensionCatalogPage {
  items: ArkmeExtensionCatalogItem[]
  total: number
  next_cursor?: string
  capabilities?: {
    sorts: ArkmeExtensionCatalogSort[]
    cursor: boolean
  }
}

export interface ArkmeExtensionClassificationCategory {
  category_id: string
  name: string
  description?: string
  extension_count: number
  level?: number
}

export interface ArkmeExtensionClassificationTree {
  status: ArkmeExtensionClassificationStatus
  categories: ArkmeExtensionClassificationCategory[]
  total_extensions: number
  total_categories: number
  updated_at?: number
  message?: string
  progress?: {
    total: number
    processed: number
    percentage: number
    stage?: string
  }
}

export interface ArkmeExtensionClassificationPage extends ArkmeExtensionCatalogPage {
  category_id: string
  category_name?: string
  status?: ArkmeExtensionClassificationStatus
  limit: number
  offset: number
}

export type ArkmeExtensionAuditTrigger = 'market_detail' | 'tool'
export type ArkmeExtensionAuditVerdict = 'pass' | 'review' | 'reject'
export type ArkmeExtensionAuditRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface ArkmeExtensionAuditResult {
  extension_id: string
  version?: string
  trigger: ArkmeExtensionAuditTrigger
  verdict: ArkmeExtensionAuditVerdict
  risk_level: ArkmeExtensionAuditRiskLevel
  summary: string
  reasons: string[]
  recommendations: string[]
  source_reviewed: boolean
  source_scope: 'public_detail_only' | 'public_source_reference' | 'published_source_snapshot'
  model?: {
    provider: string
    model: string
    name?: string
  }
  audited_at_millis: number
}

/** Browser/SDK-safe extension review projection. Record UIDs remain inside the Host. */
export interface ArkmeExtensionReviewAvatarFallback {
  kind: 'phone_default'
  colorIndex: number
  label: string
}

export interface ArkmeExtensionReviewItem {
  reviewRef: string
  parentReviewRef?: string
  authorName: string
  authorArkmeId?: string
  authorAvatarRef?: string
  authorAvatarFallback?: ArkmeExtensionReviewAvatarFallback
  textContent: string
  rating: number
  createdAtMillis: number
}

export interface ArkmeExtensionReviewPage {
  items: ArkmeExtensionReviewItem[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
  nextOffset?: number
  ratingSummary: ArkmeExtensionRatingSummary
}

export interface ArkmeExtensionReviewCreateResult {
  review: ArkmeExtensionReviewItem
  ratingSummary: ArkmeExtensionRatingSummary
  idempotentReplay: boolean
}

export interface ArkmeExtensionReviewCreateInput {
  extensionId: string
  textContent: string
  rating?: number
  parentReviewRef?: string
  clientMutationId: string
}

export type ArkmeExtensionReviewOperationState = 'record_pending' | 'registry_pending' | 'failed'

/** Host-only durable operation; adapters must never expose record UIDs. */
export interface ArkmeExtensionReviewOperation {
  extensionId: string
  recordUid: string
  parentReviewId?: string
  textContent: string
  rating?: number
  clientMutationId: string
  state: ArkmeExtensionReviewOperationState
  attempts: number
  createdAtMillis: number
  lastError?: string
}

export interface ArkmeExtensionReviewWireItem {
  extension_id: string
  review_id: string
  parent_review_id?: string
  user_id: number
  text_content: string
  rating: number
  created_at: number
}

export interface ArkmeExtensionReviewWirePage {
  items: ArkmeExtensionReviewWireItem[]
  total: number
  limit: number
  offset: number
  has_more: boolean
  rating_summary: ArkmeExtensionRatingSummary
}

export interface ArkmeExtensionReviewWireCreateResult {
  review: ArkmeExtensionReviewWireItem
  rating_summary: ArkmeExtensionRatingSummary
  idempotent_replay: boolean
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

export interface ArkmeExtensionUploadSlot {
  url: string
  method: 'PUT'
  headers?: Record<string, string>
  expires_at: string | number
}

export interface ArkmeBundlePublishSession {
  publish_session_id: string
  extension_id: string
  version?: string
  status?: string
  idempotent_replay?: boolean
  bundle_upload?: ArkmeExtensionUploadSlot
  source_upload?: ArkmeExtensionUploadSlot
}

export interface ArkmeExtensionPublishResult {
  publish_session_id?: string
  extension_id: string
  version: string
  status: 'uploading' | 'validating' | 'published' | 'rejected' | 'expired'
  artifact_sha256?: string
  artifact_contract_version?: 2 | 3
  artifact_kind?: 'dsh-bundle-tgz' | 'dsh-native-package-tgz'
  package_name?: string
  execution_model?: 'arkme-sandboxed' | 'dsh-native'
  bundle_sha256?: string
  package_json_sha256?: string
  source_sha256?: string
  native_capabilities?: ArkmeNativeCapability[]
  validation_error_code?: string
  validation_error_message?: string
	source?: ArkmeExtensionSource
	share?: ArkmeExtensionShare
}

export interface ArkmeExtensionDeleteResult {
  extension_id: string
  status: 'deleted'
  deleted_at: number
}

/** Complete user-visible deletion result after cloud soft-delete and local reference cleanup. */
export interface ArkmeExtensionCompleteDeleteResult extends ArkmeExtensionDeleteResult {
  installed: false
  active: false
  references_removed: true
  removed_source_count: number
  restart_required: boolean
  message: string
}

export type ArkmeExtensionIconMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

export interface ArkmeExtensionIconUploadSession {
  icon_upload_session_id: string
  extension_id: string
  status: 'uploading' | 'applied' | 'rejected' | 'expired'
  icon_ref?: string
  upload_url?: string
  upload_method?: 'PUT'
  upload_headers?: Record<string, string>
  expires_at: string | number
  idempotent_replay?: boolean
}

export interface ArkmeExtensionIconResult {
  icon_upload_session_id: string
  extension_id: string
  status: 'applied'
  icon_ref: string
  content_type: ArkmeExtensionIconMediaType
  icon_size: number
  icon_sha256: string
  width?: number
  height?: number
  updated_at: number
}

export interface ArkmeExtensionIconResolution {
  extension_id: string
  icon_ref: string
  content_type: ArkmeExtensionIconMediaType
  icon_size: number
  icon_sha256: string
  width: number
  height: number
  download_url: string
  download_headers?: Record<string, string>
  expires_at: string | number
}

export interface ArkmeExtensionIconBytes {
  extensionId: string
  iconRef: string
  mediaType: ArkmeExtensionIconMediaType
  data: Uint8Array
}

export type ArkmeExtensionPreviewMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

export interface ArkmeExtensionPreviewItem {
  preview_ref: string
  content_type: ArkmeExtensionPreviewMediaType
  preview_size: number
  width: number
  height: number
  created_at: number
}

export interface ArkmeExtensionPreviewGallery {
  extension_id: string
  applied_preview_ref?: string
  preview_images: ArkmeExtensionPreviewItem[]
  preview_revision: number
}

export interface ArkmeExtensionPreviewUploadSession {
  preview_upload_session_id: string
  extension_id: string
  status: 'uploading' | 'applied' | 'rejected' | 'expired'
  preview_ref?: string
  upload_url?: string
  upload_method?: 'PUT'
  upload_headers?: Record<string, string>
  expires_at: string | number
  idempotent_replay?: boolean
}

export interface ArkmeExtensionPreviewResolution {
  extension_id: string
  preview_ref: string
  content_type: ArkmeExtensionPreviewMediaType
  preview_size: number
  preview_sha256: string
  width: number
  height: number
  download_url: string
  download_headers?: Record<string, string>
  expires_at: string | number
}

export interface ArkmeExtensionPreviewBytes {
  extensionId: string
  previewRef: string
  mediaType: ArkmeExtensionPreviewMediaType
  data: Uint8Array
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
  /** Server-owned effective permissions. Missing means no capability grant. */
  permissions?: string[]
  signature: string
  signing_key_id: string
  published_at: number
  revoked: boolean
  revocation_reason?: string
  artifact_contract_version?: 2 | 3
  artifact_kind?: 'dsh-bundle-tgz' | 'dsh-native-package-tgz'
  package_name?: string
  execution_model?: 'arkme-sandboxed' | 'dsh-native'
  bundle_url?: string
  bundle_headers?: Record<string, string>
  bundle_expires_at?: string | number
  bundle_size?: number
  bundle_sha256?: string
  package_json_sha256?: string
  source_sha256?: string
  native_capabilities?: ArkmeNativeCapability[]
  requires_native_confirmation?: boolean
  audit_status?: 'approved' | 'warning' | 'rejected'
  audit_risk_level?: ArkmeExtensionAuditRiskLevel
  audit_reason?: string
}

export interface ArkmeExtensionInstallPreview {
  extension_id: string
  version: string
  artifact_contract_version?: 2 | 3
  artifact_kind?: 'dsh-bundle-tgz' | 'dsh-native-package-tgz'
  artifact_size?: number
  manifest: ArkmeExtensionManifest
  revoked: boolean
  revocation_reason?: string
  package_name?: string
  execution_model?: 'arkme-sandboxed' | 'dsh-native'
  bundle_size?: number
  requires_native_confirmation?: boolean
  native_capabilities?: ArkmeNativeCapability[]
  audit_status?: 'approved' | 'warning' | 'rejected'
  audit_risk_level?: ArkmeExtensionAuditRiskLevel
  audit_reason?: string
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
  executionModel?: 'arkme-sandboxed' | 'dsh-native'
  artifactContractVersion?: 2 | 3
  nativeCapabilities?: ArkmeNativeCapability[]
  packageJsonSha256?: string
  sourceSha256?: string
  permissionSnapshot: string[]
  updateChannel: ArkmeExtensionChannel
  installedAtMillis: number
  lastCheckedAtMillis: number
  lastError?: string
}

/** Browser/model-safe projection. Host filesystem paths and Dynamic Cordis IDs stay private. */
export const ARKME_EXTENSION_RUNTIME_UNAVAILABLE_MESSAGE = '插件运行失败，已自动停用。'

export interface ArkmeExtensionUnavailableView {
  code: 'runtime-load-failed'
  message: typeof ARKME_EXTENSION_RUNTIME_UNAVAILABLE_MESSAGE
}

export type ArkmeInstalledExtensionView = Pick<
  ArkmeInstalledExtension,
  | 'extensionId'
  | 'installedVersion'
  | 'manifest'
  | 'enabled'
  | 'active'
  | 'artifactContractVersion'
  | 'nativeCapabilities'
  | 'permissionSnapshot'
  | 'updateChannel'
  | 'installedAtMillis'
  | 'lastCheckedAtMillis'
> & { unavailable?: ArkmeExtensionUnavailableView }

export interface ArkmeExtensionEnabledResult {
  extension_id: string
  installed: true
  enabled: boolean
  active: boolean
  restart_required: boolean
  message: string
  unavailable?: ArkmeExtensionUnavailableView
}

export interface ArkmeExtensionEnabledState {
  extension_id: string
  installed: boolean
  enabled: boolean
  active: boolean
  unavailable?: ArkmeExtensionUnavailableView
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
