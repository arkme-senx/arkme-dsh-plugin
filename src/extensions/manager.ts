import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ArkmePluginError } from '../arkme-service.js'
import { ARKME_PROVIDER_CONTRACT_VERSION } from '../types.js'
import { canonicalExtensionJson, sha256Hex, unpackArkmeExtension } from './artifact.js'
import { materializeCordisBundle } from './bundle-materializer.js'
import type { ArkmeBundlePublishSource, ArkmeNativeBundlePublishSource } from './bundle-artifact.js'
import { bundleSha256, inspectBundleArtifact, inspectNativeBundleArtifactV3 } from './bundle-artifact.js'
import {
  activeProfileExtensionOwnerConflicts, arkmeClientContentDigest, arkmeClientContentDigestFromSource,
} from './client-owner.js'
import { arkmeBundleActive, deactivateArkmeBundle } from './bundle-runtime.js'
import { ArkmeExtensionInstallStore } from './install-store.js'
import { ExtensionPublishClient } from './publish-client.js'
import { normalizeGitHubRepositoryURL } from './source.js'
import {
  materializePersistentExtensionBundle, quarantinePersistentExtension, readPersistentExtensionActivation,
  refreshPersistentClientWrapper, writePersistentExtensionActivation,
} from './persistent-bundle.js'
import type { ArkmeExtensionProfileInstaller } from './profile-installer.js'
import {
  activatePersistentArkmeExtension, deactivatePersistentArkmeExtension,
  persistentArkmeExtensionRuntimeState, type PersistentArkmeExtensionRuntimeState,
} from './persistent-runtime.js'
import { verifyBundleResolutionSignature, verifyExtensionResolutionSignature, verifyNativeBundleResolutionSignature } from './signature.js'
export { verifyExtensionResolutionSignature } from './signature.js'
import {
  type ArkmeExtensionCatalogItem, type ArkmeExtensionCatalogPage,
  type ArkmeExtensionCatalogSort, type ArkmeExtensionClassificationPage, type ArkmeExtensionClassificationTree,
  type ArkmeExtensionDeleteResult, type ArkmeExtensionUnpublishResult, type ArkmeExtensionEnabledResult, type ArkmeExtensionEnabledState,
  ARKME_EXTENSION_ICON_MAX_BYTES, type ArkmeExtensionIconBytes, type ArkmeExtensionIconMediaType,
  type ArkmeExtensionIconResult, type ArkmeExtensionInstallPreview, type ArkmeExtensionInstallResolution,
  type ArkmeExtensionPublishResult,
	type ArkmeExtensionShare,
	type ArkmeExtensionRatingSummary, type ArkmeExtensionSource, type ArkmeSharedExtensionDetail,
  ARKME_EXTENSION_PREVIEW_MAX_BYTES, ARKME_EXTENSION_PREVIEW_MAX_ITEMS,
  type ArkmeExtensionPreviewBytes, type ArkmeExtensionPreviewGallery, type ArkmeExtensionPreviewMediaType,
  type ArkmeExtensionEditableVisibility, type ArkmeExtensionUpdateResolution, type ArkmeExtensionVisibility,
  type ArkmeExtensionInstallProgress, type ArkmeInstalledExtension, type ArkmeInstalledExtensionView, type DynamicCordisPackageInspectionLike,
  type DynamicCordisRunnerLike, type ArkmeNativeCapability,
  ARKME_EXTENSION_RUNTIME_UNAVAILABLE_MESSAGE, type ArkmeExtensionUnavailableView,
  type ArkmeExtensionAuditResult, type ArkmeExtensionAuditTrigger,
} from './types.js'

interface AgentLike { id?: unknown }

// Permanent Profile/Loader installation is the active product path. Keep the Dynamic Cordis
// activation implementation below for controlled fallback/debugging, but do not run it after
// a Bundle has been registered: otherwise the same extension briefly appears in Cordis.
const APPLY_PERSISTENT_EXTENSION_TO_DYNAMIC_CORDIS = false
// Profile mutations require a restart to take effect, but restart ownership stays with the user.
// The restart/rollback implementation remains available behind this switch for future opt-in use.
const AUTO_RESTART_DSH_AFTER_PROFILE_CHANGE = false

export interface ArkmeExtensionManagerOptions {
  artifactDirectory: string
  trustedSigningKeys: string
  dshRuntimeVersion?: string
  profileDirectory?: string
  profileInstaller?: Pick<ArkmeExtensionProfileInstaller, 'install' | 'installTarball' | 'remove' | 'restart' | 'setEnabled'>
    & Partial<Pick<ArkmeExtensionProfileInstaller, 'removeMany'>>
  clientApiPath?: string
  pluginInventory?: ArkmePluginInventoryLike
  persistentRuntimeState?: (extensionId: string) => PersistentArkmeExtensionRuntimeState | undefined
}

export interface ArkmeCordisProfileSave {
  source: ArkmeBundlePublishSource
  packageName: string
  version: string
  installed: true
  active: false
  restartRequired: true
  message: string
}

export interface ArkmePersistentClientState {
  extension_id: string
  version: string
  mount: boolean
  instance_key?: string
  generation?: number
  reason?: 'not-installed' | 'version-mismatch' | 'runtime-mismatch' | 'disabled' | 'unavailable'
}

export interface ArkmeBundleClientState {
  extension_id?: string
  version: string
  mount: boolean
  instance_key?: string
  generation?: number
  reason?: 'not-installed' | 'version-mismatch' | 'disabled' | 'unavailable' | 'content-mismatch'
}

export interface ArkmePluginInventoryLike {
  list(): {
    entries: ReadonlyArray<{
      entryId: string
      moduleName: string
      enabled: boolean
      fiberPhase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
    }>
  }
}

export interface ArkmeExtensionApplyResult {
  extension_id: string
  version: string
  state: 'active' | 'installed' | 'failed'
  installed: true
  active: boolean
  approval_required: boolean
  restart_required: boolean
  plugin_id?: string
  package_id?: string
  message: string
}

export interface ArkmeExtensionUninstallResult {
  extension_id: string
  installed: false
  active: false
  restart_required: boolean
  message: string
}

type BundleInstallResolution = ArkmeExtensionInstallResolution & {
  artifact_contract_version: 2
  artifact_kind: 'dsh-bundle-tgz'
  package_name: string
  execution_model: 'arkme-sandboxed' | 'dsh-native'
  bundle_url: string
  bundle_size: number
  bundle_sha256: string
  package_json_sha256: string
  source_sha256: string
}

type NativeBundleInstallResolution = ArkmeExtensionInstallResolution & {
  artifact_contract_version: 3
  artifact_kind: 'dsh-native-package-tgz'
  package_name: string
  execution_model: 'dsh-native'
  bundle_url: string
  bundle_size: number
  bundle_sha256: string
  package_json_sha256: string
  source_sha256: string
  native_capabilities: ArkmeNativeCapability[]
}

function bundleInstallResolution(value: ArkmeExtensionInstallResolution): boolean {
  return value.artifact_contract_version === 2 && value.artifact_kind === 'dsh-bundle-tgz'
    && typeof value.package_name === 'string' && value.package_name.trim() !== ''
    && (value.execution_model === 'arkme-sandboxed' || value.execution_model === 'dsh-native')
    && typeof value.bundle_url === 'string' && value.bundle_url.trim() !== ''
    && typeof value.bundle_size === 'number' && value.bundle_size > 0
    && typeof value.bundle_sha256 === 'string' && typeof value.package_json_sha256 === 'string'
    && typeof value.source_sha256 === 'string'
}

function nativeBundleInstallResolution(value: ArkmeExtensionInstallResolution): value is NativeBundleInstallResolution {
  return value.artifact_contract_version === 3 && value.artifact_kind === 'dsh-native-package-tgz'
    && typeof value.package_name === 'string' && value.package_name.trim() !== ''
    && value.execution_model === 'dsh-native'
    && typeof value.bundle_url === 'string' && value.bundle_url.trim() !== ''
    && typeof value.bundle_size === 'number' && value.bundle_size > 0
    && typeof value.bundle_sha256 === 'string' && typeof value.package_json_sha256 === 'string'
    && typeof value.source_sha256 === 'string' && Array.isArray(value.native_capabilities)
    && value.native_capabilities.every(capability => typeof capability === 'string' && capability.trim() !== '')
}

function completedPublishSession(
  session: import('./types.js').ArkmeBundlePublishSession,
  fallbackVersion: string,
): ArkmeExtensionPublishResult | undefined {
  return session.status === 'published'
    ? {
        extension_id: session.extension_id,
        version: session.version ?? fallbackVersion,
        status: 'published',
        ...(session.publish_session_id === '' ? {} : { publish_session_id: session.publish_session_id }),
        ...(session.package_name === undefined ? {} : { package_name: session.package_name }),
        ...(session.package_identity_state === undefined ? {} : { package_identity_state: session.package_identity_state }),
      }
    : undefined
}

function requireBundleUploadSlots(session: import('./types.js').ArkmeBundlePublishSession): {
  bundle: NonNullable<typeof session.bundle_upload>
  source: NonNullable<typeof session.source_upload>
} {
  if (session.bundle_upload === undefined || session.source_upload === undefined) {
    throw new ArkmePluginError('extension-publish-contract-invalid', '市集没有返回完整的 Bundle/source 上传槽', false, 502)
  }
  return { bundle: session.bundle_upload, source: session.source_upload }
}

function installedView(
  item: ArkmeInstalledExtension,
  unavailable?: ArkmeExtensionUnavailableView,
  restartRequired = false,
): ArkmeInstalledExtensionView {
  return {
    extensionId: item.extensionId,
    installedVersion: item.installedVersion,
    manifest: item.manifest,
    enabled: item.enabled,
    active: item.active,
    ...(item.artifactContractVersion === undefined ? {} : { artifactContractVersion: item.artifactContractVersion }),
    ...(item.nativeCapabilities === undefined ? {} : { nativeCapabilities: [...item.nativeCapabilities] }),
    permissionSnapshot: [...item.permissionSnapshot],
    updateChannel: item.updateChannel,
    installedAtMillis: item.installedAtMillis,
    lastCheckedAtMillis: item.lastCheckedAtMillis,
    ...(restartRequired ? { restartRequired: true } : {}),
    ...(unavailable === undefined ? {} : { unavailable }),
  }
}

interface PendingProfileChange {
  extensionId: string
  packageName: string
  expectActive: boolean
  targetBundlePath?: string
  previousBundlePath?: string
  cleanupPaths: string[]
  previousInstalled?: ArkmeInstalledExtension
  activationChange?: true
  previousProfileIncluded?: boolean
}

function requiredId(value: string, label: string): string {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized)) {
    throw new ArkmePluginError('extension-id-invalid', `${label}无效`, false)
  }
  return normalized
}

function requiredPreviewRef(value: string): string {
  const normalized = value.trim()
  if (!/^preview_v1_[a-f0-9]{64}$/.test(normalized)) {
    throw new ArkmePluginError('extension-preview-ref-invalid', '扩展预览图引用无效', false, 400)
  }
  return normalized
}

function requiredShareRef(value: string): string {
	const normalized = value.trim()
	if (!/^extshare_[0-9a-f]{32}$/.test(normalized)) {
		throw new ArkmePluginError('extension-share-invalid', '扩展分享参数无效', false, 400)
	}
	return normalized
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined
}

function sharedRatingSummary(value: unknown): ArkmeExtensionRatingSummary | undefined {
	const summary = objectValue(value)
	const histogram = summary?.histogram
	if (typeof summary?.average !== 'number' || !Number.isFinite(summary.average)
		|| summary.average < 0 || summary.average > 5
		|| typeof summary.count !== 'number' || !Number.isSafeInteger(summary.count) || summary.count < 0
		|| !Array.isArray(histogram) || histogram.length !== 5
		|| !histogram.every(item => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0)
		|| histogram.reduce((total, item) => total + item, 0) !== summary.count
		|| (summary.count === 0 ? summary.average !== 0 : summary.average <= 0)) return undefined
	return { average: summary.average, count: summary.count, histogram: histogram as [number, number, number, number, number] }
}

function sharedSource(value: unknown): ArkmeExtensionSource | undefined {
	if (value === undefined || value === null) return undefined
	const source = objectValue(value)
	if (source?.type !== 'github_repository' || source.verification !== 'publisher_attested'
		|| source.label !== '开源来源 · GitHub' || typeof source.url !== 'string') return undefined
	let normalized: string | undefined
	try { normalized = normalizeGitHubRepositoryURL(source.url) } catch { return undefined }
	return normalized === source.url
		? { type: 'github_repository', url: normalized, label: '开源来源 · GitHub', verification: 'publisher_attested' }
		: undefined
}

function assertSharedExtensionDetail(value: unknown): ArkmeSharedExtensionDetail {
	const item = objectValue(value)
	const previews = item?.preview_images
	const rating = sharedRatingSummary(item?.rating_summary)
	if (typeof item?.name !== 'string' || item.name.trim() === '' || [...item.name].length > 120
		|| typeof item.description !== 'string' || [...item.description].length > 2_000
		|| (item.visibility !== 'private' && item.visibility !== 'public')
		|| item.share_scope !== 'link_readonly'
		|| typeof item.latest_stable_version !== 'string' || semverParts(item.latest_stable_version) === undefined
		|| (item.icon_ref !== undefined && (typeof item.icon_ref !== 'string' || !/^icon_v1_[a-f0-9]{64}$/.test(item.icon_ref)))
		|| !Array.isArray(previews) || previews.length > ARKME_EXTENSION_PREVIEW_MAX_ITEMS || rating === undefined) {
		throw new ArkmePluginError('extension-share-contract-invalid', '扩展市场返回了无效只读分享详情', false, 502)
	}
	const safePreviews = previews.map((value) => {
		const preview = objectValue(value)
		if (typeof preview?.preview_ref !== 'string' || !/^preview_v1_[a-f0-9]{64}$/.test(preview.preview_ref)
			|| typeof preview.width !== 'number' || !Number.isSafeInteger(preview.width) || preview.width < 320 || preview.width > 4096
			|| typeof preview.height !== 'number' || !Number.isSafeInteger(preview.height) || preview.height < 320 || preview.height > 4096) {
			throw new ArkmePluginError('extension-share-contract-invalid', '扩展市场返回了无效只读分享详情', false, 502)
		}
		return { preview_ref: preview.preview_ref, width: preview.width, height: preview.height }
	})
	const source = sharedSource(item.source)
	if (item.source !== undefined && source === undefined) {
		throw new ArkmePluginError('extension-share-contract-invalid', '扩展市场返回了无效只读分享详情', false, 502)
	}
	return {
		name: item.name.trim(), description: item.description, visibility: item.visibility,
		share_scope: 'link_readonly', latest_stable_version: item.latest_stable_version,
		...(typeof item.icon_ref === 'string' ? { icon_ref: item.icon_ref } : {}),
		preview_images: safePreviews, rating_summary: rating,
		...(source === undefined ? {} : { source }),
	}
}

function assertPreviewGallery(value: ArkmeExtensionPreviewGallery, extensionId: string): ArkmeExtensionPreviewGallery {
  if (value.extension_id !== extensionId || !Number.isSafeInteger(value.preview_revision) || value.preview_revision < 0
    || !Array.isArray(value.preview_images) || value.preview_images.length > ARKME_EXTENSION_PREVIEW_MAX_ITEMS) {
    throw new ArkmePluginError('extension-preview-contract-invalid', '市集返回了不一致的预览图集', false, 502)
  }
  const refs = new Set<string>()
  for (const item of value.preview_images) {
    if (!/^preview_v1_[a-f0-9]{64}$/.test(item.preview_ref) || refs.has(item.preview_ref)
      || !['image/png', 'image/jpeg', 'image/webp'].includes(item.content_type)
      || !Number.isSafeInteger(item.preview_size) || item.preview_size <= 0 || item.preview_size > ARKME_EXTENSION_PREVIEW_MAX_BYTES
      || !Number.isSafeInteger(item.width) || !Number.isSafeInteger(item.height)
      || item.width < 320 || item.height < 320 || item.width > 4096 || item.height > 4096) {
      throw new ArkmePluginError('extension-preview-contract-invalid', '市集返回了无效预览图元数据', false, 502)
    }
    refs.add(item.preview_ref)
  }
  return value
}

function parseTrustedKeys(raw: string): Map<string, string> {
  const text = raw.trim()
  if (text === '') return new Map()
  let value: unknown
  try { value = JSON.parse(text) } catch (error) {
    throw new ArkmePluginError('extension-signing-keys-invalid', '可信扩展签名公钥配置必须是 JSON 对象', false, 500, { cause: error })
  }
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new ArkmePluginError('extension-signing-keys-invalid', '可信扩展签名公钥配置必须是 JSON 对象', false, 500)
  }
  const keys = new Map<string, string>()
  for (const [keyId, encoded] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(keyId) || typeof encoded !== 'string' || encoded.trim() === '') {
      throw new ArkmePluginError('extension-signing-keys-invalid', '可信扩展签名公钥配置包含无效条目', false, 500)
    }
    keys.set(keyId, encoded.trim())
  }
  return keys
}

function semverParts(value: string): { core: [number, number, number]; pre: string[] } | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim())
  return match === null ? undefined : {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4]?.split('.') ?? [],
  }
}

function atLeast(current: string, minimum: string): boolean {
  const left = semverParts(current)
  const right = semverParts(minimum)
  if (left === undefined || right === undefined) return false
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index]! > right.core[index]!) return true
    if (left.core[index]! < right.core[index]!) return false
  }
  if (left.pre.length === 0 || right.pre.length === 0) return left.pre.length === 0
  const length = Math.max(left.pre.length, right.pre.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.pre[index]
    const rightPart = right.pre[index]
    if (leftPart === undefined || rightPart === undefined) return rightPart === undefined
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber > rightNumber
    if (leftNumber !== undefined) return false
    if (rightNumber !== undefined) return true
    return leftPart.localeCompare(rightPart) > 0
  }
  return true
}

export function extensionCatalogPageLimit(limit?: number): number {
  return Math.min(100, Math.max(1, Math.trunc(limit ?? 20)))
}

export class ArkmeExtensionManager {
  private readonly trustedKeys: Map<string, string>
  private readonly dshRuntimeVersion: string
  private readonly activeAgents = new Map<string, unknown>()
  private readonly pendingProfileChanges = new Map<string, PendingProfileChange>()
  private enabledMutationTail: Promise<void> = Promise.resolve()
  private readonly iconCache = new Map<string, ArkmeExtensionIconBytes>()
  private readonly previewCache = new Map<string, ArkmeExtensionPreviewBytes>()
  private readonly installationInstanceId: string

  constructor(
    readonly client: ExtensionPublishClient,
    readonly store: ArkmeExtensionInstallStore,
    private readonly runner: DynamicCordisRunnerLike,
    private readonly options: ArkmeExtensionManagerOptions,
  ) {
    this.trustedKeys = parseTrustedKeys(options.trustedSigningKeys)
    this.dshRuntimeVersion = options.dshRuntimeVersion ?? '0.1.0-rc.7'
    this.installationInstanceId = store.installationInstanceId()
    mkdirSync(options.artifactDirectory, { recursive: true, mode: 0o700 })
    chmodSync(options.artifactDirectory, 0o700)
  }

  /** Profile installation is Host-owned and does not need a live conversation Agent. */
  canInstallWithoutAgent(): boolean {
    return this.options.profileDirectory !== undefined && this.options.profileInstaller !== undefined
  }

  /** Reconcile this Profile once during Host startup; failures remain compatible with older services. */
  async reconcileInstallationMetrics(): Promise<void> {
    const repairFailures: Array<{ extensionId: string; error: unknown }> = []
    const repaired = await this.restoreDisabledProfileLayers('', (item, error) => {
      repairFailures.push({ extensionId: item.extensionId, error })
    })
    const current = new Map(this.listInstalled().map(item => [item.extensionId, item]))
    for (const item of repaired) {
      if (item.profilePackageName === undefined) continue
      const loaded = current.get(item.extensionId)?.active === true
      if (!loaded && !item.manifest.halves.client) continue
      this.pendingProfileChanges.set(item.extensionId, {
        extensionId: item.extensionId,
        packageName: item.profilePackageName,
        expectActive: false,
        cleanupPaths: [],
        previousInstalled: item,
        activationChange: true,
        previousProfileIncluded: true,
      })
    }
    this.refreshPersistentClientWrappers()
    await this.reconcileProfileClientOwners()
    await this.syncInstallationSnapshot()
    if (repairFailures.length > 0) {
      throw new AggregateError(
        repairFailures.map(item => item.error),
        `无法收敛 ${repairFailures.map(item => item.extensionId).join('、')} 的关闭状态`,
      )
    }
  }

  /** Profile-only extensions can be removed without touching a legacy dynamic Agent. */
  canUninstallWithoutAgent(extensionIdValue: string): boolean {
    const extensionId = requiredId(extensionIdValue, 'extension_id')
    return this.store.get(extensionId)?.dynamicPluginId === undefined || this.activeAgents.has(extensionId)
  }

  installedProfilePackageName(extensionIdValue: string): string | undefined {
    const extensionId = requiredId(extensionIdValue, 'extension_id')
    return this.store.get(extensionId)?.profilePackageName
  }

  /** Remove a previously linked author source from the Profile without deleting its source directory/tarball. */
  async removeOwnedProfilePackage(packageNameValue: string): Promise<boolean> {
    const packageName = packageNameValue.trim()
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName)
      || packageName.startsWith('@deepseek-ai/') || packageName === '@senguoyun/dsh-arkme') {
      throw new ArkmePluginError('extension-delete-profile-reference-invalid', '扩展 Profile 引用无效', false, 400)
    }
    if (!this.profileContains(packageName, false)) return false
    if (this.options.profileInstaller === undefined) {
      throw new ArkmePluginError('extension-delete-profile-unavailable', '当前 DSH 运行方式不支持移除扩展 Profile 引用', false, 503)
    }
    await this.options.profileInstaller.remove(packageName)
    await this.restoreDisabledProfileLayers('')
    return true
  }

  inspectPackage(agent: unknown, pluginId: string, packageId: string): DynamicCordisPackageInspectionLike {
    return this.runner.inspectPackage(agent, requiredId(pluginId, 'plugin_id'), requiredId(packageId, 'package_id'))
  }

  /** Materialize one live Cordis package into an immutable V2 Bundle and register it through the official DSH Profile CLI. */
  async persistCordisProfile(input: {
    agent: unknown
    pluginId: string
    packageId: string
    packageName: string
    name: string
    description: string
    version: string
  }): Promise<ArkmeCordisProfileSave> {
    if (this.options.profileInstaller === undefined || this.options.profileDirectory === undefined) {
      throw new ArkmePluginError('extension-profile-install-unavailable', '当前 DSH 运行方式不支持保存插件到 Profile', false, 503)
    }
    const inspected = this.inspectPackage(input.agent, input.pluginId, input.packageId)
    const source = materializeCordisBundle({
      packageName: input.packageName,
      name: input.name.trim() || inspected.name,
      description: input.description.trim() || inspected.purpose,
      version: input.version,
      ...(inspected.code.host === undefined ? {} : { hostCode: inspected.code.host }),
      ...(inspected.code.client === undefined ? {} : { clientCode: inspected.code.client }),
    })
    const persisted = this.persistAuthoredBundle(source)
    let installed = false
    try {
      await this.options.profileInstaller.installTarball(persisted.path)
      installed = true
      await this.restoreDisabledProfileLayers('')
    } catch (error) {
      if (persisted.created && !installed) this.removeArtifact(persisted.path)
      throw new ArkmePluginError(
        installed ? 'extension-profile-postinstall-failed' : 'extension-profile-save-failed',
        installed
          ? `插件已加入 DSH Profile，但无法恢复其他插件的停用状态：${error instanceof Error ? error.message : String(error)}`
          : `插件 Bundle 已生成，但无法加入 DSH Profile：${error instanceof Error ? error.message : String(error)}`,
        true,
        500,
        { cause: error },
      )
    }
    return {
      source,
      packageName: source.bundle.packageName,
      version: source.bundle.version,
      installed: true,
      active: false,
      restartRequired: true,
      message: '插件已保存到当前 DSH Profile，重启 DSH 后生效',
    }
  }

  async publish(input: {
    agent: unknown
    pluginId: string
    packageId: string
    packageName?: string
    extensionId?: string
    name: string
    description: string
    version: string
    visibility: ArkmeExtensionVisibility
    changelog?: string
		githubRepositoryUrl?: string
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<ArkmeExtensionPublishResult> {
		let githubRepositoryUrl: string | undefined
		try { githubRepositoryUrl = normalizeGitHubRepositoryURL(input.githubRepositoryUrl) } catch (error) {
			throw new ArkmePluginError('extension-source-invalid', 'GitHub 仓库地址无效', false, 400, { cause: error })
		}
    const inspected = this.inspectPackage(input.agent, input.pluginId, input.packageId)
    const source = materializeCordisBundle({
      packageName: input.packageName ?? `@arkme-generated/${bundleSha256(`cordis\0${input.pluginId}`).slice(0, 24)}`,
      name: input.name.trim() || inspected.name,
      description: input.description.trim() || inspected.purpose,
      version: input.version,
      ...(inspected.code.host === undefined ? {} : { hostCode: inspected.code.host }),
      ...(inspected.code.client === undefined ? {} : { clientCode: inspected.code.client }),
    })
    const session = await this.client.createBundlePublishSession({
      ...(input.extensionId === undefined || input.extensionId.trim() === ''
        ? {}
        : { extension_id: requiredId(input.extensionId, 'extension_id') }),
      name: input.name.trim() || inspected.name,
      description: input.description.trim() || inspected.purpose,
      visibility: input.visibility,
      ...(input.changelog === undefined || input.changelog.trim() === '' ? {} : { changelog: input.changelog.trim() }),
      idempotency_key: input.idempotencyKey,
      bundle: source.bundle,
      source: source.source,
		...(githubRepositoryUrl === undefined ? {} : { listingSource: { type: 'github_repository' as const, url: githubRepositoryUrl } }),
    }, input.signal)
    const completed = completedPublishSession(session, source.bundle.version)
    if (completed !== undefined) return completed
    try {
      if (session.status === 'validating') {
        return await this.client.completePublishSession(session.publish_session_id, input.signal)
      }
      const slots = requireBundleUploadSlots(session)
      await this.client.uploadBundle(slots.bundle, source.bundle, input.signal)
      await this.client.uploadSource(slots.source, source.source, input.signal)
      return await this.client.completePublishSession(session.publish_session_id, input.signal)
    } catch (error) {
      if (input.signal?.aborted === true) throw error
      try {
        const recovered = await this.client.publishStatus(session.publish_session_id, input.signal)
        if (['validating', 'published'].includes(recovered.status)) return recovered
      } catch { /* The original failure retains the best causal signal. */ }
      throw error
    }
  }

  async publishBundleSource(input: {
    source: ArkmeBundlePublishSource
    extensionId?: string
    name: string
    description: string
    visibility: ArkmeExtensionVisibility
    changelog?: string
		githubRepositoryUrl?: string
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<ArkmeExtensionPublishResult> {
		let githubRepositoryUrl: string | undefined
		try { githubRepositoryUrl = normalizeGitHubRepositoryURL(input.githubRepositoryUrl) } catch (error) {
			throw new ArkmePluginError('extension-source-invalid', 'GitHub 仓库地址无效', false, 400, { cause: error })
		}
    const session = await this.client.createBundlePublishSession({
      ...(input.extensionId === undefined || input.extensionId.trim() === ''
        ? {}
        : { extension_id: requiredId(input.extensionId, 'extension_id') }),
      name: input.name.trim() || input.source.bundle.packageName,
      description: input.description.trim(),
      visibility: input.visibility,
      ...(input.changelog === undefined || input.changelog.trim() === '' ? {} : { changelog: input.changelog.trim() }),
      idempotency_key: input.idempotencyKey,
      bundle: input.source.bundle,
      source: input.source.source,
		...(githubRepositoryUrl === undefined ? {} : { listingSource: { type: 'github_repository' as const, url: githubRepositoryUrl } }),
    }, input.signal)
    const completed = completedPublishSession(session, input.source.bundle.version)
    if (completed !== undefined) return completed
    try {
      if (session.status === 'validating') {
        return await this.client.completePublishSession(session.publish_session_id, input.signal)
      }
      const slots = requireBundleUploadSlots(session)
      await this.client.uploadBundle(slots.bundle, input.source.bundle, input.signal)
      await this.client.uploadSource(slots.source, input.source.source, input.signal)
      return await this.client.completePublishSession(session.publish_session_id, input.signal)
    } catch (error) {
      if (input.signal?.aborted === true) throw error
      try {
        const recovered = await this.client.publishStatus(session.publish_session_id, input.signal)
        if (['validating', 'published'].includes(recovered.status)) return recovered
      } catch { /* The original failure retains the best causal signal. */ }
      throw error
    }
  }

  async publishNativeBundleSource(input: {
    source: ArkmeNativeBundlePublishSource
    extensionId?: string
    name: string
    description: string
    visibility: ArkmeExtensionVisibility
    changelog?: string
    githubRepositoryUrl?: string
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<ArkmeExtensionPublishResult> {
    let githubRepositoryUrl: string | undefined
    try { githubRepositoryUrl = normalizeGitHubRepositoryURL(input.githubRepositoryUrl) } catch (error) {
      throw new ArkmePluginError('extension-source-invalid', 'GitHub 仓库地址无效', false, 400, { cause: error })
    }
    const session = await this.client.createNativeBundlePublishSession({
      ...(input.extensionId === undefined || input.extensionId.trim() === ''
        ? {}
        : { extension_id: requiredId(input.extensionId, 'extension_id') }),
      name: input.name.trim() || input.source.bundle.packageName,
      description: input.description.trim(),
      visibility: input.visibility,
      ...(input.changelog === undefined || input.changelog.trim() === '' ? {} : { changelog: input.changelog.trim() }),
      idempotency_key: input.idempotencyKey,
      bundle: input.source.bundle,
      source: input.source.source,
      ...(githubRepositoryUrl === undefined ? {} : { listingSource: { type: 'github_repository' as const, url: githubRepositoryUrl } }),
    }, input.signal)
    const completed = completedPublishSession(session, input.source.bundle.version)
    if (completed !== undefined) return completed
    try {
      if (session.status === 'validating') {
        return await this.client.completePublishSession(session.publish_session_id, input.signal)
      }
      const slots = requireBundleUploadSlots(session)
      await this.client.uploadNativeBundle(slots.bundle, input.source.bundle, input.signal)
      await this.client.uploadSource(slots.source, input.source.source, input.signal)
      return await this.client.completePublishSession(session.publish_session_id, input.signal)
    } catch (error) {
      if (input.signal?.aborted === true) throw error
      try {
        const recovered = await this.client.publishStatus(session.publish_session_id, input.signal)
        if (['validating', 'published'].includes(recovered.status)) return recovered
      } catch { /* The original failure retains the best causal signal. */ }
      throw error
    }
  }

  async search(query = '', limit = 20, signal?: AbortSignal): Promise<ArkmeExtensionCatalogPage> {
    return await this.searchCatalog({ query, limit }, signal)
  }

  async searchCatalog(input: {
    query?: string
    sort?: ArkmeExtensionCatalogSort
    cursor?: string
    limit?: number
    ownerUserId?: number
    excludeExtensionId?: string
  } = {}, signal?: AbortSignal): Promise<ArkmeExtensionCatalogPage> {
    const query = input.query?.trim() ?? ''
    const cursor = input.cursor?.trim() ?? ''
    const excludeExtensionId = input.excludeExtensionId?.trim() ?? ''
    if (input.ownerUserId !== undefined && (!Number.isSafeInteger(input.ownerUserId) || input.ownerUserId <= 0)) {
      throw new TypeError('owner_user_id must be a positive safe integer')
    }
    return await this.client.list({
      ...(query === '' ? {} : { query }),
      ...(input.sort === undefined ? {} : { sort: input.sort }),
      ...(cursor === '' ? {} : { cursor }),
      ...(input.ownerUserId === undefined ? {} : { owner_user_id: input.ownerUserId }),
      ...(excludeExtensionId === '' ? {} : { exclude_extension_id: excludeExtensionId }),
      limit: extensionCatalogPageLimit(input.limit),
    }, signal)
  }

  async classificationTree(limit = 30, signal?: AbortSignal): Promise<ArkmeExtensionClassificationTree> {
    return await this.client.classificationTree(Math.min(100, Math.max(1, Math.trunc(limit))), signal)
  }

  async classificationItems(input: {
    categoryId: string
    query?: string
    sort?: ArkmeExtensionCatalogSort
    cursor?: string
    limit?: number
  }, signal?: AbortSignal): Promise<ArkmeExtensionClassificationPage> {
    const categoryId = requiredId(input.categoryId, 'category_id')
    const query = input.query?.trim() ?? ''
    const cursor = input.cursor?.trim() ?? ''
    return await this.client.classificationItems({
      category_id: categoryId,
      ...(query === '' ? {} : { query }),
      ...(input.sort === undefined ? {} : { sort: input.sort }),
      ...(cursor === '' ? {} : { cursor }),
      limit: extensionCatalogPageLimit(input.limit),
    }, signal)
  }

  async inspect(extensionId: string, signal?: AbortSignal): Promise<ArkmeExtensionCatalogItem> {
    const normalizedExtensionId = requiredId(extensionId, 'extension_id')
    const detail = await this.client.detail(normalizedExtensionId, signal)
    void this.reportOpen(normalizedExtensionId)
    return detail
  }

  async previewInstall(extensionId: string, version?: string, signal?: AbortSignal): Promise<ArkmeExtensionInstallPreview> {
    const requestedId = requiredId(extensionId, 'extension_id')
    const resolution = await this.client.resolveInstall(requestedId, version, signal)
    if (resolution.extension_id !== requestedId) {
      throw new ArkmePluginError('extension-install-contract-invalid', '市集返回了错误的扩展身份', false, 502)
    }
    if (nativeBundleInstallResolution(resolution)) {
      return {
        extension_id: resolution.extension_id,
        version: resolution.version,
        artifact_contract_version: 3,
        artifact_kind: 'dsh-native-package-tgz',
        package_name: resolution.package_name,
        execution_model: resolution.execution_model,
        bundle_size: resolution.bundle_size,
        requires_native_confirmation: true,
        native_capabilities: [...resolution.native_capabilities],
        ...(resolution.audit_status === undefined ? {} : { audit_status: resolution.audit_status }),
        ...(resolution.audit_risk_level === undefined ? {} : { audit_risk_level: resolution.audit_risk_level }),
        ...(resolution.audit_reason === undefined ? {} : { audit_reason: resolution.audit_reason }),
        manifest: resolution.manifest,
        revoked: resolution.revoked,
        ...(resolution.revocation_reason === undefined ? {} : { revocation_reason: resolution.revocation_reason }),
      }
    }
    if (bundleInstallResolution(resolution)) {
      const bundle = resolution as BundleInstallResolution
      return {
        extension_id: bundle.extension_id,
        version: bundle.version,
        artifact_contract_version: 2,
        artifact_kind: 'dsh-bundle-tgz',
        package_name: bundle.package_name,
        execution_model: bundle.execution_model,
        bundle_size: bundle.bundle_size,
        requires_native_confirmation: bundle.requires_native_confirmation === true,
        manifest: bundle.manifest,
        revoked: bundle.revoked,
        ...(bundle.revocation_reason === undefined ? {} : { revocation_reason: bundle.revocation_reason }),
      }
    }
    return {
      extension_id: resolution.extension_id,
      version: resolution.version,
      ...(resolution.artifact_size === undefined ? {} : { artifact_size: resolution.artifact_size }),
      manifest: resolution.manifest,
      revoked: resolution.revoked,
      ...(resolution.revocation_reason === undefined ? {} : { revocation_reason: resolution.revocation_reason }),
    }
  }

  async auditExtension(input: {
    extensionId: string
    trigger: ArkmeExtensionAuditTrigger
    signal?: AbortSignal
  }): Promise<ArkmeExtensionAuditResult> {
    const extensionId = requiredId(input.extensionId, 'extension_id')
    return await this.client.auditExtension(extensionId, input.trigger, input.signal)
  }

  async myList(signal?: AbortSignal): Promise<ArkmeExtensionCatalogPage> {
    const items: ArkmeExtensionCatalogItem[] = []
    const seenExtensionIds = new Set<string>()
    const seenCursors = new Set<string>()
    let cursor: string | undefined
    let publicationCapabilities: ArkmeExtensionCatalogPage['publication_capabilities']
    while (true) {
      const page = await this.client.myList({ limit: 50, ...(cursor === undefined ? {} : { cursor }) }, signal)
      publicationCapabilities ??= page.publication_capabilities
      for (const item of page.items) {
        if (seenExtensionIds.has(item.extension_id)) continue
        seenExtensionIds.add(item.extension_id)
        items.push(item)
      }
      const nextCursor = page.next_cursor?.trim()
      if (nextCursor === undefined || nextCursor === '') {
        return {
          items, total: items.length,
          ...(publicationCapabilities === undefined ? {} : { publication_capabilities: publicationCapabilities }),
        }
      }
      if (seenCursors.has(nextCursor)) throw new Error('owned extension cursor loop')
      seenCursors.add(nextCursor)
      cursor = nextCursor
    }
  }

  async updateMetadata(input: {
    extensionId: string
    name: string
    description: string
    visibility: ArkmeExtensionEditableVisibility
    clientMutationId: string
    signal?: AbortSignal
  }): Promise<ArkmeExtensionCatalogItem> {
    const extensionId = requiredId(input.extensionId, 'extension_id')
    const name = input.name.trim()
    const description = input.description.trim()
    if (name === '' || [...name].length > 120 || [...description].length > 2_000
      || (input.visibility !== 'private' && input.visibility !== 'public')
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.clientMutationId)) {
      throw new ArkmePluginError('extension-metadata-invalid', '扩展信息无效', false, 400)
    }
    const result = await this.client.updateMetadata({
      extension_id: extensionId,
      name,
      description,
      visibility: input.visibility,
      client_mutation_id: input.clientMutationId,
    }, input.signal)
    const extension = result.extension
    if (extension.extension_id !== extensionId || extension.name !== name || extension.description !== description
      || extension.visibility !== input.visibility || !Number.isSafeInteger(extension.updated_at) || extension.updated_at! <= 0) {
      throw new ArkmePluginError('extension-metadata-contract-invalid', '市集返回了不一致的资料事实', false, 502)
    }
    return extension
  }

	async rotateShareLink(input: {
		extensionId: string
		clientMutationId: string
		signal?: AbortSignal
	}): Promise<ArkmeExtensionShare> {
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.extensionId.trim())
			|| !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.clientMutationId)) {
			throw new ArkmePluginError('extension-share-invalid', '扩展分享参数无效', false, 400)
		}
		const share = await this.client.rotateShareLink(input.extensionId.trim(), input.clientMutationId, input.signal)
		let url: URL
		try { url = new URL(share.url) } catch (error) {
			throw new ArkmePluginError('extension-share-contract-invalid', '市集返回了无效分享链接', false, 502, { cause: error })
		}
		if (!/^extshare_[0-9a-f]{32}$/.test(share.ref) || url.protocol !== 'https:' || !url.pathname.endsWith(`/${share.ref}`)
			|| url.username !== '' || url.password !== '') {
			throw new ArkmePluginError('extension-share-contract-invalid', '市集返回了无效分享链接', false, 502)
		}
		return share
	}

	async readSharedDetail(shareRef: string, signal?: AbortSignal): Promise<ArkmeSharedExtensionDetail> {
		const response = await this.client.sharedDetail(requiredShareRef(shareRef), signal)
		return assertSharedExtensionDetail(response.extension)
	}

  async delete(extensionId: string, signal?: AbortSignal): Promise<ArkmeExtensionDeleteResult> {
    return await this.client.deleteExtension(requiredId(extensionId, 'extension_id'), signal)
  }

  async unpublish(extensionId: string, signal?: AbortSignal): Promise<ArkmeExtensionUnpublishResult> {
    return await this.client.unpublishExtension(requiredId(extensionId, 'extension_id'), signal)
  }

  async setIcon(input: {
    extensionId: string
    mediaType: ArkmeExtensionIconMediaType
    data: Uint8Array
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<ArkmeExtensionIconResult> {
    const extensionId = requiredId(input.extensionId, 'extension_id')
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(input.mediaType)) {
      throw new ArkmePluginError('extension-icon-type-invalid', '扩展头像仅支持 PNG、JPEG 或 WebP', false, 400)
    }
    if (input.data.byteLength <= 0 || input.data.byteLength > ARKME_EXTENSION_ICON_MAX_BYTES) {
      throw new ArkmePluginError('extension-icon-size-invalid', '扩展头像必须小于 2 MiB', false, 400)
    }
    const iconSha256 = createHash('sha256').update(input.data).digest('hex')
    const session = await this.client.createIconUploadSession({
      extension_id: extensionId,
      content_type: input.mediaType,
      icon_size: input.data.byteLength,
      icon_sha256: iconSha256,
      idempotency_key: input.idempotencyKey,
    }, input.signal)
    if (session.status === 'uploading') {
      if (session.upload_url === undefined) {
        throw new ArkmePluginError('extension-icon-upload-contract-invalid', '市集未返回头像上传地址', false, 502)
      }
      await this.client.uploadIcon(
        session.upload_url,
        input.data,
        input.mediaType,
        session.upload_headers ?? {},
        input.signal,
      )
    }
    const result = await this.client.completeIconUploadSession(session.icon_upload_session_id, input.signal)
    if (result.extension_id !== extensionId || result.icon_sha256 !== iconSha256 || result.content_type !== input.mediaType) {
      throw new ArkmePluginError('extension-icon-contract-invalid', '市集返回了不一致的头像事实', false, 502)
    }
    // A replacement invalidates every previously authorized ref for this extension.
    // Keeping an old immutable-ref entry would let the same-origin image route serve
    // it without re-checking the registry's current pointer.
    const cachePrefix = `${extensionId}\0`
    for (const key of this.iconCache.keys()) {
      if (key.startsWith(cachePrefix)) this.iconCache.delete(key)
    }
    return result
  }

  async readIcon(extensionIdValue: string, iconRefValue: string, signal?: AbortSignal): Promise<ArkmeExtensionIconBytes> {
    const extensionId = requiredId(extensionIdValue, 'extension_id')
    const iconRef = iconRefValue.trim()
    if (!/^icon_v1_[a-f0-9]{64}$/.test(iconRef)) {
      throw new ArkmePluginError('extension-icon-ref-invalid', '扩展头像引用无效', false, 400)
    }
    const cacheKey = `${extensionId}\0${iconRef}`
    const cached = this.iconCache.get(cacheKey)
    if (cached !== undefined) return { ...cached, data: new Uint8Array(cached.data) }
    const resolution = await this.client.resolveIcon(extensionId, iconRef, signal)
    if (resolution.extension_id !== extensionId || resolution.icon_ref !== iconRef
      || !['image/png', 'image/jpeg', 'image/webp'].includes(resolution.content_type)
      || resolution.icon_size <= 0 || resolution.icon_size > ARKME_EXTENSION_ICON_MAX_BYTES) {
      throw new ArkmePluginError('extension-icon-contract-invalid', '市集返回了不一致的头像解析结果', false, 502)
    }
    const data = await this.client.downloadIcon(resolution, signal)
    const sha256 = createHash('sha256').update(data).digest('hex')
    if (data.byteLength !== resolution.icon_size || sha256 !== resolution.icon_sha256) {
      throw new ArkmePluginError('extension-icon-download-invalid', '扩展头像下载校验失败', false, 502)
    }
    const value: ArkmeExtensionIconBytes = {
      extensionId,
      iconRef,
      mediaType: resolution.content_type,
      data: new Uint8Array(data),
    }
    this.iconCache.set(cacheKey, value)
    while (this.iconCache.size > 128) {
      const oldest = this.iconCache.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.iconCache.delete(oldest)
    }
    return { ...value, data: new Uint8Array(value.data) }
  }

  async addPreview(input: {
    extensionId: string
    mediaType: ArkmeExtensionPreviewMediaType
    data: Uint8Array
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<ArkmeExtensionPreviewGallery> {
    const extensionId = requiredId(input.extensionId, 'extension_id')
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(input.mediaType)) {
      throw new ArkmePluginError('extension-preview-type-invalid', '扩展预览图仅支持 PNG、JPEG 或 WebP', false, 400)
    }
    if (input.data.byteLength <= 0 || input.data.byteLength > ARKME_EXTENSION_PREVIEW_MAX_BYTES) {
      throw new ArkmePluginError('extension-preview-size-invalid', '扩展预览图必须小于 5 MiB', false, 400)
    }
    const previewSha256 = createHash('sha256').update(input.data).digest('hex')
    const session = await this.client.createPreviewUploadSession({
      extension_id: extensionId,
      content_type: input.mediaType,
      preview_size: input.data.byteLength,
      preview_sha256: previewSha256,
      idempotency_key: input.idempotencyKey,
    }, input.signal)
    if (session.status === 'uploading') {
      if (session.upload_url === undefined) {
        throw new ArkmePluginError('extension-preview-upload-contract-invalid', '市集未返回预览图上传地址', false, 502)
      }
      await this.client.uploadPreview(
        session.upload_url, input.data, input.mediaType, session.upload_headers ?? {}, input.signal,
      )
    }
    const result = assertPreviewGallery(
      await this.client.completePreviewUploadSession(session.preview_upload_session_id, input.signal),
      extensionId,
    )
    if (result.applied_preview_ref !== `preview_v1_${previewSha256}`) {
      throw new ArkmePluginError('extension-preview-contract-invalid', '市集返回了不一致的预览图事实', false, 502)
    }
    return result
  }

  async deletePreview(input: {
    extensionId: string
    previewRef: string
    expectedRevision: number
    signal?: AbortSignal
  }): Promise<ArkmeExtensionPreviewGallery> {
    const extensionId = requiredId(input.extensionId, 'extension_id')
    const previewRef = requiredPreviewRef(input.previewRef)
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new ArkmePluginError('extension-preview-revision-invalid', '扩展预览图版本无效', false, 400)
    }
    const result = assertPreviewGallery(
      await this.client.deletePreview(extensionId, previewRef, input.expectedRevision, input.signal), extensionId,
    )
    this.previewCache.delete(`${extensionId}\0${previewRef}`)
    return result
  }

  async reorderPreviews(input: {
    extensionId: string
    orderedPreviewRefs: string[]
    expectedRevision: number
    signal?: AbortSignal
  }): Promise<ArkmeExtensionPreviewGallery> {
    const extensionId = requiredId(input.extensionId, 'extension_id')
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
      || input.orderedPreviewRefs.length <= 0 || input.orderedPreviewRefs.length > ARKME_EXTENSION_PREVIEW_MAX_ITEMS) {
      throw new ArkmePluginError('extension-preview-reorder-invalid', '扩展预览图排序参数无效', false, 400)
    }
    const refs = input.orderedPreviewRefs.map(requiredPreviewRef)
    if (new Set(refs).size !== refs.length) {
      throw new ArkmePluginError('extension-preview-reorder-invalid', '扩展预览图排序不能包含重复引用', false, 400)
    }
    return assertPreviewGallery(
      await this.client.reorderPreviews(extensionId, refs, input.expectedRevision, input.signal), extensionId,
    )
  }

  async readPreview(extensionIdValue: string, previewRefValue: string, signal?: AbortSignal): Promise<ArkmeExtensionPreviewBytes> {
    const extensionId = requiredId(extensionIdValue, 'extension_id')
    const previewRef = requiredPreviewRef(previewRefValue)
    const cacheKey = `${extensionId}\0${previewRef}`
    const cached = this.previewCache.get(cacheKey)
    if (cached !== undefined) return { ...cached, data: new Uint8Array(cached.data) }
    const resolution = await this.client.resolvePreview(extensionId, previewRef, signal)
    if (resolution.extension_id !== extensionId || resolution.preview_ref !== previewRef
      || !['image/png', 'image/jpeg', 'image/webp'].includes(resolution.content_type)
      || resolution.preview_size <= 0 || resolution.preview_size > ARKME_EXTENSION_PREVIEW_MAX_BYTES) {
      throw new ArkmePluginError('extension-preview-contract-invalid', '市集返回了不一致的预览图解析结果', false, 502)
    }
    const data = await this.client.downloadPreview(resolution, signal)
    const sha256 = createHash('sha256').update(data).digest('hex')
    if (data.byteLength !== resolution.preview_size || sha256 !== resolution.preview_sha256) {
      throw new ArkmePluginError('extension-preview-download-invalid', '扩展预览图下载校验失败', false, 502)
    }
    const value: ArkmeExtensionPreviewBytes = {
      extensionId, previewRef, mediaType: resolution.content_type, data: new Uint8Array(data),
    }
    this.previewCache.set(cacheKey, value)
    while (this.previewCache.size > 128) {
      const oldest = this.previewCache.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.previewCache.delete(oldest)
    }
    return { ...value, data: new Uint8Array(value.data) }
  }

  listInstalled(): ArkmeInstalledExtensionView[] {
    const loaderEntries = this.options.pluginInventory?.list().entries ?? []
    return this.store.list().map(item => {
      const state = this.effectivePersistentActivation(item)
      const effective = state.item
      if (effective.enabled !== item.enabled || effective.active !== item.active || effective.lastError !== item.lastError) {
        this.store.put(effective)
      }
      const loaderActive = effective.executionModel !== undefined && effective.profilePackageName !== undefined && loaderEntries.some(entry =>
        entry.moduleName === effective.profilePackageName && entry.enabled && entry.fiberPhase === 'active')
      const active = effective.executionModel === undefined
        ? effective.enabled && this.persistentRuntimeMatches(effective)
        : effective.executionModel === 'dsh-native'
          ? loaderActive
          : loaderActive || effective.active || (effective.profilePackageName !== undefined
            && arkmeBundleActive(effective.profilePackageName))
      const restartRequired = this.pendingProfileChanges.has(effective.extensionId)
      return installedView({ ...effective, active }, state.unavailable, restartRequired)
    })
  }

  private persistentRuntimeMatches(item: ArkmeInstalledExtension): boolean {
    if (item.executionModel !== undefined || item.profileBundlePath === undefined) return false
    const bundleDirectory = this.resolveLegacyBundlePath(item.profileBundlePath)
    if (bundleDirectory === undefined) return false
    const runtime = (this.options.persistentRuntimeState ?? persistentArkmeExtensionRuntimeState)(item.extensionId)
    return runtime?.active === true
      && runtime.version === item.installedVersion
      && runtime.installationUrl === pathToFileURL(join(bundleDirectory, 'installation.json')).href
  }

  private effectivePersistentActivation(item: ArkmeInstalledExtension): {
    item: ArkmeInstalledExtension
    unavailable?: ArkmeExtensionUnavailableView
  } {
    if (item.executionModel !== undefined || item.profileBundlePath === undefined) return { item }
    const bundleDirectory = this.resolveLegacyBundlePath(item.profileBundlePath)
    if (bundleDirectory === undefined) return { item }
    try {
      const activation = readPersistentExtensionActivation(pathToFileURL(join(bundleDirectory, 'installation.json')))
      if (activation.extension_id !== item.extensionId || activation.enabled) return { item }
      return {
        item: {
          ...item,
          enabled: false,
          active: false,
          ...(activation.quarantine === undefined ? {} : { lastError: activation.quarantine.message }),
        },
        ...(activation.quarantine === undefined ? {} : {
          unavailable: {
            code: 'runtime-load-failed',
            message: ARKME_EXTENSION_RUNTIME_UNAVAILABLE_MESSAGE,
          },
        }),
      }
    } catch {
      return { item }
    }
  }

  enabledState(extensionIdValue: string): ArkmeExtensionEnabledState {
    const extensionId = requiredId(extensionIdValue, 'extension_id')
    const installed = this.listInstalled().find(item => item.extensionId === extensionId)
    if (installed === undefined) return { extension_id: extensionId, installed: false, enabled: false, active: false }
    return {
      extension_id: extensionId,
      installed: true,
      enabled: installed.enabled && (this.store.get(extensionId)?.executionModel !== undefined || installed.active),
      active: installed.active,
      ...(installed.restartRequired ? { restart_required: true } : {}),
      ...(installed.unavailable === undefined ? {} : { unavailable: installed.unavailable }),
    }
  }

  persistentClientState(extensionIdValue: string, versionValue: string): ArkmePersistentClientState {
    const extensionId = requiredId(extensionIdValue, 'extension_id')
    const version = versionValue.trim()
    const stored = this.store.get(extensionId)
    if (stored === undefined) return { extension_id: extensionId, version, mount: false, reason: 'not-installed' }
    if (version === '' || stored.installedVersion !== version) {
      return { extension_id: extensionId, version, mount: false, reason: 'version-mismatch' }
    }
    const installed = this.listInstalled().find(item => item.extensionId === extensionId)
    if (installed?.unavailable !== undefined) {
      return { extension_id: extensionId, version, mount: false, reason: 'unavailable' }
    }
    if (installed?.enabled !== true) return { extension_id: extensionId, version, mount: false, reason: 'disabled' }
    if (installed.active !== true || !this.persistentRuntimeMatches(stored)) {
      return { extension_id: extensionId, version, mount: false, reason: 'runtime-mismatch' }
    }
    return {
      extension_id: extensionId,
      version,
      mount: true,
      instance_key: this.installedClientInstanceKey(stored),
      generation: stored.installedAtMillis,
    }
  }

  bundleClientState(packageNameValue: string, versionValue: string, contentDigestValue: string): ArkmeBundleClientState {
    const packageName = packageNameValue.trim()
    const version = versionValue.trim()
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName)) {
      return { version, mount: false, reason: 'not-installed' }
    }
    const stored = this.store.list().find(item => item.profilePackageName === packageName)
    if (stored === undefined || stored.executionModel === undefined) {
      return { version, mount: false, reason: 'not-installed' }
    }
    if (version === '' || stored.installedVersion !== version) {
      return { extension_id: stored.extensionId, version, mount: false, reason: 'version-mismatch' }
    }
    const contentDigest = contentDigestValue.trim()
    if (contentDigest === '' || this.installedClientContentDigest(stored) !== contentDigest) {
      return { extension_id: stored.extensionId, version, mount: false, reason: 'content-mismatch' }
    }
    const installed = this.listInstalled().find(item => item.extensionId === stored.extensionId)
    if (installed?.unavailable !== undefined) {
      return { extension_id: stored.extensionId, version, mount: false, reason: 'unavailable' }
    }
    if (installed?.enabled !== true) {
      return { extension_id: stored.extensionId, version, mount: false, reason: 'disabled' }
    }
    return {
      extension_id: stored.extensionId,
      version,
      mount: true,
      instance_key: this.installedClientInstanceKey(stored),
      generation: stored.installedAtMillis,
    }
  }

  async reportClientFailure(input: {
    identityKey: string
    extensionId: string
    version: string
    clientInstanceKey?: string
    clientContentDigest?: string
    clientOwnerKey?: string
    kind: string
    message: string
  }): Promise<{ handled: boolean; disabled: boolean }> {
    const identityKey = input.identityKey
    if (identityKey !== 'extensionId' && identityKey !== 'packageName') {
      throw new ArkmePluginError('extension-client-failure-identity-invalid', '扩展 Client 身份无效', false, 400)
    }
    const item = identityKey === 'extensionId'
      ? this.store.get(requiredId(input.extensionId, 'extension_id'))
      : this.store.list().find(candidate => candidate.profilePackageName === input.extensionId.trim())
    if (item === undefined || item.installedVersion !== input.version.trim()) return { handled: false, disabled: false }
    const instanceKey = input.clientInstanceKey?.trim() ?? ''
    const exactInstance = instanceKey !== '' && instanceKey === this.installedClientInstanceKey(item)
    const legacyContentOwner = instanceKey === '' && input.clientOwnerKey !== undefined
      && input.clientOwnerKey === this.installedClientContentDigest(item)
    if (!exactInstance && !legacyContentOwner) {
      return { handled: false, disabled: false }
    }
    // Wrappers before v3 treated matching source as ownership and reported collisions. Do not let
    // that legacy heuristic disable the canonical extension selected by the Host install store.
    if (input.kind === 'duplicate-owner') return { handled: true, disabled: false }
    const message = (input.message.trim() || 'extension client failed to load').slice(0, 2_000)
    if (item.executionModel === undefined && item.profileBundlePath !== undefined) {
      const bundleDirectory = this.resolveLegacyBundlePath(item.profileBundlePath)
      if (bundleDirectory !== undefined) {
        try { quarantinePersistentExtension(bundleDirectory, item.extensionId, new Error(message)) } catch { /* Store state still converges below. */ }
      }
    }
    if (item.profilePackageName !== undefined) {
      try { await this.options.profileInstaller?.setEnabled(item.profilePackageName, false) } catch (error) {
        console.error(`[arkme-extension:${item.extensionId}] failed to persist Client isolation in Profile`, error)
      }
    }
    if (item.executionModel === 'arkme-sandboxed' && item.profilePackageName !== undefined) {
      try { await deactivateArkmeBundle(item.profilePackageName) } catch { /* The failed Client fiber is already isolated. */ }
    } else if (item.executionModel === undefined) {
      try { await deactivatePersistentArkmeExtension(item.extensionId) } catch { /* The failed Client fiber is already isolated. */ }
    }
    this.store.put({
      ...item,
      enabled: false,
      active: false,
      lastError: message,
    })
    return { handled: true, disabled: true }
  }

  async setEnabled(input: { agent: unknown; extensionId: string; enabled: boolean }): Promise<ArkmeExtensionEnabledResult> {
    const result = this.enabledMutationTail.then(
      async () => await this.setEnabledNow(input),
      async () => await this.setEnabledNow(input),
    )
    this.enabledMutationTail = result.then(() => undefined, () => undefined)
    return await result
  }

  private async setEnabledNow(input: { agent: unknown; extensionId: string; enabled: boolean }): Promise<ArkmeExtensionEnabledResult> {
    const extensionId = requiredId(input.extensionId, 'extension_id')
    const installed = this.store.get(extensionId)
    if (installed === undefined) {
      throw new ArkmePluginError('extension-not-installed', '该扩展尚未安装', false, 404)
    }
    const current = this.listInstalled().find(item => item.extensionId === extensionId)
    const currentActive = current?.active === true
    const profilePackageName = installed.profilePackageName
    const legacyProfileBundle = installed.executionModel === undefined
      && installed.profileBundlePath !== undefined && !installed.profileBundlePath.endsWith('.tgz')
      ? installed.profileBundlePath
      : undefined
    if (profilePackageName !== undefined && this.options.profileInstaller === undefined) {
      throw new ArkmePluginError('extension-profile-toggle-unavailable', '当前 DSH 运行方式不支持修改扩展启用状态', false, 503)
    }
    const previousProfileIncluded = profilePackageName !== undefined && this.profileContains(profilePackageName, true)
    if ((current?.enabled ?? installed.enabled) === input.enabled) {
      if (legacyProfileBundle !== undefined) this.writeActivation(legacyProfileBundle, extensionId, input.enabled)
      if (profilePackageName !== undefined) await this.options.profileInstaller?.setEnabled(profilePackageName, input.enabled)
      const profileProjectionChanged = profilePackageName !== undefined && previousProfileIncluded !== input.enabled
      const needsRestart = currentActive !== input.enabled || profileProjectionChanged
        || this.pendingProfileChanges.has(extensionId)
      if (needsRestart && profilePackageName !== undefined) {
        this.rememberActivationRestart(installed, previousProfileIncluded, input.enabled)
      } else {
        this.pendingProfileChanges.delete(extensionId)
      }
      const restartRequired = this.pendingProfileChanges.has(extensionId)
      return {
        extension_id: extensionId,
        installed: true,
        enabled: input.enabled,
        active: currentActive,
        restart_required: restartRequired,
        message: input.enabled
          ? currentActive && !profileProjectionChanged ? '扩展已启用' : '扩展已设为启用，重启 DSH 后生效'
          : restartRequired ? '扩展已关闭，重启 DSH 后完全停用' : '扩展已关闭',
        ...(current?.unavailable === undefined ? {} : { unavailable: current.unavailable }),
      }
    }

    if (!input.enabled) {
      try {
        if (legacyProfileBundle !== undefined) {
          this.writeActivation(legacyProfileBundle, extensionId, false)
        }
        if (profilePackageName !== undefined) await this.options.profileInstaller?.setEnabled(profilePackageName, false)
      } catch (error) {
        if (legacyProfileBundle !== undefined) {
          try { this.writeActivation(legacyProfileBundle, extensionId, true) } catch { /* Preserve the causal failure. */ }
        }
        throw error
      }
      try {
        if (installed.dynamicPluginId !== undefined) {
          if (this.runner.undefine === undefined) {
            throw new ArkmePluginError('extension-disable-runtime-unavailable', '当前 Dynamic Cordis 不支持关闭扩展', false, 503)
          }
          const agent = this.activeAgents.get(extensionId) ?? input.agent
          const result = await this.runner.undefine(agent, installed.dynamicPluginId)
          if (!result.ok && result.reason !== 'plugin-missing') {
            throw new ArkmePluginError(
              'extension-disable-failed', result.message?.trim() || 'Dynamic Cordis 无法关闭扩展', false, 409,
            )
          }
        }
        if (installed.executionModel === 'arkme-sandboxed' && profilePackageName !== undefined) {
          await deactivateArkmeBundle(profilePackageName)
        } else if (installed.executionModel === undefined) {
          await deactivatePersistentArkmeExtension(extensionId)
        }
      } catch (error) {
        if (profilePackageName !== undefined) await this.options.profileInstaller?.setEnabled(profilePackageName, true).catch(() => undefined)
        if (legacyProfileBundle !== undefined) {
          try { this.writeActivation(legacyProfileBundle, extensionId, true) } catch { /* Preserve the causal failure. */ }
        }
        throw error
      }
      const activeUntilRestart = installed.executionModel === 'dsh-native' && currentActive
      const { lastError: _lastError, dynamicPluginId: _pluginId, dynamicPackageId: _packageId, ...retained } = installed
      this.store.put({ ...retained, enabled: false, active: activeUntilRestart })
      this.activeAgents.delete(extensionId)
      const needsRestart = activeUntilRestart || installed.manifest.halves.client
      if (needsRestart && profilePackageName !== undefined) {
        this.rememberActivationRestart(installed, previousProfileIncluded, false)
      } else {
        this.pendingProfileChanges.delete(extensionId)
      }
      const restartRequired = this.pendingProfileChanges.has(extensionId)
      return {
        extension_id: extensionId,
        installed: true,
        enabled: false,
        active: activeUntilRestart,
        restart_required: restartRequired,
        message: restartRequired
          ? activeUntilRestart
            ? '扩展已设为关闭，重启 DSH 后停止原生 Bundle'
            : '扩展已关闭；Host 能力已停止，重启 DSH 后 Client 界面完全移除'
          : '扩展已关闭，无需重启 DSH',
      }
    }

    try {
      if (legacyProfileBundle !== undefined) {
        this.writeActivation(legacyProfileBundle, extensionId, true)
      }
      if (profilePackageName !== undefined) await this.options.profileInstaller?.setEnabled(profilePackageName, true)
    } catch (error) {
      if (legacyProfileBundle !== undefined) {
        try { this.writeActivation(legacyProfileBundle, extensionId, false) } catch { /* Preserve the causal failure. */ }
      }
      throw error
    }
    let active = currentActive
    let activationError = ''
    if (installed.executionModel === undefined) {
      try {
        active = await activatePersistentArkmeExtension(extensionId)
      } catch (error) {
        activationError = error instanceof Error ? error.message : String(error)
      }
    }
    const activationFailed = activationError !== ''
    const needsRestart = !activationFailed && (!active || installed.manifest.halves.client)
    const { lastError: _lastError, ...retained } = installed
    this.store.put({
      ...retained,
      enabled: !activationFailed,
      active,
      ...(activationError === '' ? {} : { lastError: activationError }),
    })
    if (needsRestart && profilePackageName !== undefined) {
      this.rememberActivationRestart(installed, previousProfileIncluded, true)
    } else {
      this.pendingProfileChanges.delete(extensionId)
    }
    const restartRequired = this.pendingProfileChanges.has(extensionId)
    return {
      extension_id: extensionId,
      installed: true,
      enabled: !activationFailed,
      active,
      restart_required: restartRequired,
      message: activationFailed
        ? `${ARKME_EXTENSION_RUNTIME_UNAVAILABLE_MESSAGE} 请检查扩展兼容性后重试。`
        : restartRequired
        ? activationError === ''
          ? '扩展已设为启用，重启 DSH 后完全生效'
          : `扩展已设为启用，当前进程加载失败：${activationError}；可重启 DSH 重试`
        : '扩展已启用，无需重启 DSH',
      ...(activationFailed ? {
        unavailable: {
          code: 'runtime-load-failed' as const,
          message: ARKME_EXTENSION_RUNTIME_UNAVAILABLE_MESSAGE,
        },
      } : {}),
    }
  }

  async updates(signal?: AbortSignal): Promise<ArkmeExtensionUpdateResolution[]> {
    const installed = this.store.list()
    if (installed.length === 0) return []
    const result = await this.client.resolveUpdates(installed, signal)
    this.store.markChecked(installed.map(item => item.extensionId))
    return result
  }

  async apply(input: {
    agent: unknown
    extensionId: string
    version?: string
    signal?: AbortSignal
    onProgress?: (progress: ArkmeExtensionInstallProgress) => void
  }): Promise<ArkmeExtensionApplyResult> {
    const extensionId = requiredId(input.extensionId, 'extension_id')
    let previous = this.store.get(extensionId)
    if (previous?.profilePackageName !== undefined && !this.profileContains(previous.profilePackageName, previous.enabled)) {
      const { profilePackageName: _package, profileBundlePath: _bundle, ...withoutStaleProfile } = previous
      previous = withoutStaleProfile
      this.store.put(previous)
    }
    input.onProgress?.({ phase: 'resolving', message: '正在解析可安装版本' })
    const resolution = await this.client.resolveInstall(extensionId, input.version, input.signal)
    if (resolution.revoked) {
      throw new ArkmePluginError(
        'extension-version-revoked',
        resolution.revocation_reason?.trim() || '该扩展版本已被撤销，不能应用',
        false,
        409,
      )
    }
    if (resolution.extension_id !== extensionId) {
      throw new ArkmePluginError('extension-install-contract-invalid', '市集返回了错误的扩展身份', false, 502)
    }
    let result: ArkmeExtensionApplyResult
    if (nativeBundleInstallResolution(resolution)) {
      result = await this.applyNativeBundleV3(input, resolution, previous)
      void this.reportInstallationState(extensionId, true)
      return result
    }
    if (bundleInstallResolution(resolution)) {
      result = await this.applyBundleV2(input, resolution as BundleInstallResolution, previous)
      void this.reportInstallationState(extensionId, true)
      return result
    }
    const contractVersion = (resolution as { artifact_contract_version?: unknown }).artifact_contract_version
    if (contractVersion !== undefined && contractVersion !== 0) {
      throw new ArkmePluginError('extension-install-contract-invalid', '市集返回了不完整或不受支持的制品合同', false, 502)
    }
    result = await this.applyLegacyV1(input, resolution, previous)
    void this.reportInstallationState(extensionId, true)
    return result
  }

  private async applyLegacyV1(
    input: {
      agent: unknown
      extensionId: string
      version?: string
      signal?: AbortSignal
      onProgress?: (progress: ArkmeExtensionInstallProgress) => void
    },
    resolution: ArkmeExtensionInstallResolution,
    previous: ArkmeInstalledExtension | undefined,
  ): Promise<ArkmeExtensionApplyResult> {
    const extensionId = resolution.extension_id
    const declaredArtifactSize = typeof resolution.artifact_size === 'number' && resolution.artifact_size > 0
      ? resolution.artifact_size
      : undefined
    input.onProgress?.({
      phase: 'downloading', version: resolution.version, downloadedBytes: 0,
      ...(declaredArtifactSize === undefined ? {} : { totalBytes: declaredArtifactSize }),
      message: '正在下载扩展制品',
    })
    const bytes = await this.client.downloadArtifact(
      resolution.artifact_url,
      resolution.artifact_headers ?? {},
      input.signal,
      progress => {
        const totalBytes = progress.totalBytes ?? declaredArtifactSize
        input.onProgress?.({
          phase: 'downloading', version: resolution.version,
          downloadedBytes: progress.downloadedBytes,
          ...(totalBytes === undefined ? {} : { totalBytes }),
          message: '正在下载扩展制品',
        })
      },
    )
    input.onProgress?.({
      phase: 'verifying', version: resolution.version, downloadedBytes: bytes.byteLength,
      totalBytes: declaredArtifactSize ?? bytes.byteLength, message: '正在校验摘要、签名和兼容性',
    })
    if (sha256Hex(bytes) !== resolution.artifact_sha256) {
      throw new ArkmePluginError('extension-artifact-sha256', '下载的扩展制品摘要不匹配', false, 502)
    }
    const unpacked = unpackArkmeExtension(bytes)
    if (unpacked.manifestSha256 !== resolution.manifest_sha256
      || unpacked.manifest.version !== resolution.version
      || canonicalExtensionJson(unpacked.manifest) !== canonicalExtensionJson(resolution.manifest)) {
      throw new ArkmePluginError('extension-manifest-mismatch', '扩展制品 manifest 与发布记录不一致', false, 502)
    }
    verifyExtensionResolutionSignature(resolution, this.trustedKeys)
    this.assertCompatible(unpacked.manifest.runtime)
    input.onProgress?.({ phase: 'persisting', version: resolution.version, message: '正在安全写入本地' })
    const artifactPath = this.persistArtifact(extensionId, resolution.version, bytes)
    let persistentBundle: ReturnType<typeof materializePersistentExtensionBundle> | undefined
    let duplicatePackageNames: string[] = []
    const desiredEnabled = previous?.enabled ?? true
    if (this.options.profileDirectory !== undefined && this.options.profileInstaller !== undefined) {
      const trustedPublicKey = this.trustedKeys.get(resolution.signing_key_id)
      if (trustedPublicKey === undefined) {
        throw new ArkmePluginError('extension-signing-key-untrusted', '无法为永久 Bundle 解析可信签名公钥', false, 403)
      }
      persistentBundle = materializePersistentExtensionBundle({
        profileDirectory: this.options.profileDirectory,
        resolution,
        artifactPath,
        trustedPublicKey,
        ...(unpacked.clientCode === undefined ? {} : { clientCode: unpacked.clientCode }),
        ...(this.options.clientApiPath === undefined ? {} : { clientApiPath: this.options.clientApiPath }),
      })
      duplicatePackageNames = this.profileExtensionOwnerConflicts(
        extensionId,
        unpacked.clientCode === undefined ? undefined : arkmeClientContentDigest(unpacked.clientCode),
        persistentBundle.packageName,
      )
      input.onProgress?.({ phase: 'registering', version: resolution.version, message: '正在加入 DSH 插件列表' })
      try {
        await this.options.profileInstaller.install(persistentBundle.bundleDirectory)
        this.writeActivation(persistentBundle.bundleDirectory, extensionId, desiredEnabled)
        if (!desiredEnabled) await this.options.profileInstaller.setEnabled(persistentBundle.packageName, false)
        await this.removeSupersededProfilePackage(previous, persistentBundle.packageName)
        await this.restoreDisabledProfileLayers(extensionId)
        await deactivatePersistentArkmeExtension(extensionId)
        await this.removeProfilePackages(duplicatePackageNames)
      } catch (error) {
        await this.rollbackLegacyProfileInstall(persistentBundle, previous).catch(() => undefined)
        throw new ArkmePluginError(
          'extension-profile-install-failed',
          `扩展制品已验证，但无法加入 DSH Profile：${error instanceof Error ? error.message : String(error)}`,
          true,
          500,
          { cause: error },
        )
      }
    }
    const installed: ArkmeInstalledExtension = {
      extensionId,
      installedVersion: resolution.version,
      artifactSha256: resolution.artifact_sha256,
      artifactPath,
      manifest: unpacked.manifest,
      enabled: desiredEnabled,
      active: false,
      ...(persistentBundle === undefined ? {} : {
        profilePackageName: persistentBundle.packageName,
        profileBundlePath: persistentBundle.bundleDirectory,
      }),
      permissionSnapshot: [...unpacked.manifest.permissions],
      updateChannel: 'stable',
      installedAtMillis: Date.now(),
      lastCheckedAtMillis: Date.now(),
    }
    this.store.put(installed)

    if (persistentBundle !== undefined && !APPLY_PERSISTENT_EXTENSION_TO_DYNAMIC_CORDIS) {
      if (desiredEnabled) {
        this.pendingProfileChanges.set(extensionId, {
          extensionId,
          packageName: persistentBundle.packageName,
          expectActive: true,
          targetBundlePath: persistentBundle.bundleDirectory,
          ...(previous?.profileBundlePath === undefined ? {} : { previousBundlePath: previous.profileBundlePath }),
          cleanupPaths: previous === undefined ? [] : [previous.profileBundlePath, previous.artifactPath]
            .filter((path): path is string => path !== undefined
              && path !== persistentBundle.bundleDirectory && path !== artifactPath),
          ...(previous === undefined ? {} : { previousInstalled: previous }),
        })
      } else {
        this.pendingProfileChanges.delete(extensionId)
      }
      return {
        extension_id: extensionId,
        version: resolution.version,
        state: 'installed',
        installed: true,
        active: false,
        approval_required: false,
        restart_required: desiredEnabled,
        message: desiredEnabled
          ? '扩展已加入 DSH 插件列表；请手动重启 DSH 后生效'
          : '扩展已更新并保持关闭',
      }
    }

    const agentId = (input.agent as AgentLike | undefined)?.id
    if (typeof agentId !== 'string' || agentId.trim() === '') {
      const failure = { ...installed, lastError: '当前工具调用没有可用的 DSH Agent 会话' }
      this.store.put(failure)
      throw new ArkmePluginError('extension-agent-required', '扩展已经安装，但当前没有可应用它的 DSH Agent 会话', false, 409)
    }
    try {
      input.onProgress?.({ phase: 'applying', version: resolution.version, message: '正在应用到当前 DSH 会话' })
      const definition = this.runner.define({
        sessionId: agentId,
        plugin: previous?.active === true && previous.dynamicPluginId !== undefined
          ? { kind: 'existing', pluginId: previous.dynamicPluginId }
          : { kind: 'new', idPrefix: 'arkext'.slice(0, 6) },
        name: unpacked.manifest.name,
        purpose: unpacked.manifest.description || `Arkme 扩展 ${extensionId}@${resolution.version}`,
        code: {
          ...(unpacked.hostCode === undefined ? {} : { host: unpacked.hostCode }),
          ...(unpacked.clientCode === undefined ? {} : { client: unpacked.clientCode }),
        },
      })
      const mode = previous?.active === true && previous.dynamicPluginId === definition.pluginId ? 'update' : 'run'
      const run = await this.runner.run(input.agent, definition.pluginId, definition.packageId, mode, input.signal)
      const active = run.ok && run.status === 'running'
      const approvalRequired = run.ok && run.status === 'awaiting-approval'
      const finalItem: ArkmeInstalledExtension = {
        ...installed,
        active,
        dynamicPluginId: definition.pluginId,
        dynamicPackageId: definition.packageId,
        ...run.ok ? {} : { lastError: run.message ?? 'Dynamic Cordis 拒绝应用扩展' },
      }
      this.store.put(finalItem)
      if (run.ok) this.activeAgents.set(extensionId, input.agent)
      else this.activeAgents.delete(extensionId)
      if (!run.ok) {
        await this.rollbackLegacyProfileInstall(persistentBundle, previous)
        return {
          extension_id: extensionId,
          version: resolution.version,
          state: 'failed', installed: true, active: false, approval_required: false, restart_required: false,
          plugin_id: definition.pluginId, package_id: definition.packageId,
          message: `扩展已安装，但 Dynamic Cordis 应用失败：${run.message ?? '未知错误'}`,
        }
      }
      if (persistentBundle !== undefined && AUTO_RESTART_DSH_AFTER_PROFILE_CHANGE) {
        await this.options.profileInstaller?.restart({
          extensionId,
          packageName: persistentBundle.packageName,
          targetBundlePath: persistentBundle.bundleDirectory,
          ...(previous?.profileBundlePath === undefined ? {} : { previousBundlePath: previous.profileBundlePath }),
          cleanupPaths: previous === undefined ? [] : [previous.profileBundlePath, previous.artifactPath]
            .filter((path): path is string => path !== undefined
              && path !== persistentBundle.bundleDirectory && path !== artifactPath),
          ...(previous === undefined ? {} : { previousInstalled: previous }),
          expectActive: true,
        })
      }
      input.onProgress?.({
        phase: active ? 'active' : approvalRequired ? 'awaiting-approval' : 'installed',
        version: resolution.version,
        message: active
          ? '扩展已安装并在当前 DSH 会话激活'
          : approvalRequired ? '扩展已安装，等待 DSH 用户确认' : '扩展已安装，正在启动',
      })
      return {
        extension_id: extensionId,
        version: resolution.version,
        state: active ? 'active' : 'installed',
        installed: true,
        active,
        approval_required: approvalRequired,
        restart_required: persistentBundle !== undefined,
        plugin_id: definition.pluginId,
        package_id: definition.packageId,
        message: active
          ? '扩展已安装并在当前 DSH 会话激活'
          : approvalRequired
            ? '扩展已安装，Client 能力正在等待 DSH 用户确认；确认完成前不声明为 active'
            : '扩展已安装，Dynamic Cordis 正在启动；尚未确认 active',
      }
    } catch (error) {
      this.activeAgents.delete(extensionId)
      await this.rollbackLegacyProfileInstall(persistentBundle, previous).catch(() => undefined)
      this.store.put({ ...installed, lastError: error instanceof Error ? error.message : String(error) })
      throw new ArkmePluginError(
        'extension-apply-failed',
        `扩展已经安装，但无法在当前 DSH 会话应用：${error instanceof Error ? error.message : String(error)}`,
        false,
        409,
        { cause: error },
      )
    }
  }

  private async applyNativeBundleV3(
    input: {
      agent: unknown
      extensionId: string
      version?: string
      signal?: AbortSignal
      onProgress?: (progress: ArkmeExtensionInstallProgress) => void
    },
    resolution: NativeBundleInstallResolution,
    previous: ArkmeInstalledExtension | undefined,
  ): Promise<ArkmeExtensionApplyResult> {
    const extensionId = resolution.extension_id
    input.onProgress?.({
      phase: 'downloading', version: resolution.version, downloadedBytes: 0, totalBytes: resolution.bundle_size,
      message: '正在下载原生 DSH V3 Package',
    })
    const bytes = await this.client.downloadArtifact(
      resolution.bundle_url,
      resolution.bundle_headers ?? {},
      input.signal,
      progress => input.onProgress?.({
        phase: 'downloading', version: resolution.version, downloadedBytes: progress.downloadedBytes,
        totalBytes: progress.totalBytes ?? resolution.bundle_size, message: '正在下载原生 DSH V3 Package',
      }),
    )
    input.onProgress?.({
      phase: 'verifying', version: resolution.version, downloadedBytes: bytes.byteLength,
      totalBytes: resolution.bundle_size, message: '正在校验 V3 摘要、签名、package identity 和原生能力',
    })
    if (bundleSha256(bytes) !== resolution.bundle_sha256) {
      throw new ArkmePluginError('extension-bundle-sha256', '下载的原生 DSH V3 Package 摘要不匹配', false, 502)
    }
    const inspected = inspectNativeBundleArtifactV3(bytes)
    if (inspected.packageName !== resolution.package_name || inspected.version !== resolution.version
      || inspected.packageJsonSha256 !== resolution.package_json_sha256
      || JSON.stringify(inspected.nativeCapabilities) !== JSON.stringify(resolution.native_capabilities)) {
      throw new ArkmePluginError('extension-bundle-identity-mismatch', '原生 DSH V3 Package 与发布记录不一致', false, 502)
    }
    verifyNativeBundleResolutionSignature(resolution, this.trustedKeys)
    input.onProgress?.({ phase: 'persisting', version: resolution.version, message: '正在安全保存不可变 V3 Package' })
    const artifactPath = this.persistArtifact(extensionId, resolution.version, bytes, 'native-v3.tgz')
    if (this.options.profileInstaller === undefined || this.options.profileDirectory === undefined) {
      this.removeArtifact(artifactPath)
      throw new ArkmePluginError('extension-profile-install-unavailable', '当前 DSH 运行方式不支持安装原生 V3 Package', false, 503)
    }
    const desiredEnabled = previous?.enabled ?? true
    const duplicatePackageNames = this.profileExtensionOwnerConflicts(
      extensionId,
      arkmeClientContentDigestFromSource(inspected.files),
      resolution.package_name,
    )
    input.onProgress?.({ phase: 'registering', version: resolution.version, message: '正在通过官方 DSH CLI 加入原生 V3 Package' })
    try {
      await this.options.profileInstaller.installTarball(artifactPath)
      if (!desiredEnabled) await this.options.profileInstaller.setEnabled(resolution.package_name, false)
      await this.removeSupersededProfilePackage(previous, resolution.package_name)
      await this.restoreDisabledProfileLayers(extensionId)
      await this.removeProfilePackages(duplicatePackageNames)
    } catch (error) {
      try {
        await this.restorePreviousProfilePackage(previous, resolution.package_name)
      } catch { /* Preserve the original install error. */ }
      this.removeArtifact(artifactPath)
      throw new ArkmePluginError(
        'extension-profile-install-failed',
        `原生 V3 Package 已验证，但无法加入 DSH Profile：${error instanceof Error ? error.message : String(error)}`,
        true,
        500,
        { cause: error },
      )
    }
    const manifest: ArkmeInstalledExtension['manifest'] = {
      format: 'arkme-cordis-extension',
      format_version: 1,
      name: resolution.package_name,
      description: '',
      version: resolution.version,
      runtime: { dsh: '*', arkme_provider_contract: ARKME_PROVIDER_CONTRACT_VERSION },
      halves: { host: true, client: inspected.files.has('package/lib/client.js') },
      permissions: [],
      entrypoints: { host: 'host.js', ...(inspected.files.has('package/lib/client.js') ? { client: 'client.js' as const } : {}) },
    }
    const installed: ArkmeInstalledExtension = {
      extensionId,
      installedVersion: resolution.version,
      artifactSha256: resolution.bundle_sha256,
      artifactPath,
      manifest,
      enabled: desiredEnabled,
      active: false,
      profilePackageName: resolution.package_name,
      profileBundlePath: artifactPath,
      executionModel: 'dsh-native',
      artifactContractVersion: 3,
      nativeCapabilities: [...resolution.native_capabilities],
      packageJsonSha256: resolution.package_json_sha256,
      sourceSha256: resolution.source_sha256,
      permissionSnapshot: [...resolution.native_capabilities],
      updateChannel: 'stable',
      installedAtMillis: Date.now(),
      lastCheckedAtMillis: Date.now(),
    }
    this.store.put(installed)
    if (desiredEnabled) {
      this.pendingProfileChanges.set(extensionId, {
        extensionId,
        packageName: resolution.package_name,
        expectActive: true,
        targetBundlePath: artifactPath,
        ...(previous?.profileBundlePath === undefined ? {} : { previousBundlePath: previous.profileBundlePath }),
        cleanupPaths: previous === undefined ? [] : [previous.profileBundlePath, previous.artifactPath]
          .filter((path): path is string => path !== undefined && path !== artifactPath),
        ...(previous === undefined ? {} : { previousInstalled: previous }),
      })
    } else {
      this.pendingProfileChanges.delete(extensionId)
    }
    return {
      extension_id: extensionId,
      version: resolution.version,
      state: 'installed',
      installed: true,
      active: false,
      approval_required: false,
      restart_required: desiredEnabled,
      message: desiredEnabled
        ? '原生 DSH V3 Package 已安装；它拥有完整 DSH 插件权限，请重启 DSH 后生效'
        : '原生 DSH V3 Package 已安装但保持停用',
    }
  }

  private async applyBundleV2(
    input: {
      agent: unknown
      extensionId: string
      version?: string
      signal?: AbortSignal
      onProgress?: (progress: ArkmeExtensionInstallProgress) => void
    },
    resolution: BundleInstallResolution,
    previous: ArkmeInstalledExtension | undefined,
  ): Promise<ArkmeExtensionApplyResult> {
    const extensionId = resolution.extension_id
    input.onProgress?.({
      phase: 'downloading', version: resolution.version, downloadedBytes: 0, totalBytes: resolution.bundle_size,
      message: '正在下载 DSH Bundle',
    })
    const bytes = await this.client.downloadArtifact(
      resolution.bundle_url,
      resolution.bundle_headers ?? {},
      input.signal,
      progress => input.onProgress?.({
        phase: 'downloading', version: resolution.version, downloadedBytes: progress.downloadedBytes,
        totalBytes: progress.totalBytes ?? resolution.bundle_size, message: '正在下载 DSH Bundle',
      }),
    )
    input.onProgress?.({
      phase: 'verifying', version: resolution.version, downloadedBytes: bytes.byteLength,
      totalBytes: resolution.bundle_size, message: '正在校验 Bundle 摘要、签名和 package identity',
    })
    if (bundleSha256(bytes) !== resolution.bundle_sha256) {
      throw new ArkmePluginError('extension-bundle-sha256', '下载的 DSH Bundle 摘要不匹配', false, 502)
    }
    const inspected = inspectBundleArtifact(bytes)
    if (inspected.packageName !== resolution.package_name || inspected.version !== resolution.version
      || inspected.executionModel !== resolution.execution_model
      || inspected.packageJsonSha256 !== resolution.package_json_sha256) {
      throw new ArkmePluginError('extension-bundle-identity-mismatch', 'DSH Bundle 与发布记录不一致', false, 502)
    }
    verifyBundleResolutionSignature(resolution, this.trustedKeys)
    input.onProgress?.({ phase: 'persisting', version: resolution.version, message: '正在安全保存不可变 Bundle' })
    const artifactPath = this.persistArtifact(extensionId, resolution.version, bytes, 'bundle.tgz')
    if (this.options.profileInstaller === undefined || this.options.profileDirectory === undefined) {
      this.removeArtifact(artifactPath)
      throw new ArkmePluginError('extension-profile-install-unavailable', '当前 DSH 运行方式不支持安装 Bundle', false, 503)
    }
    const desiredEnabled = previous?.enabled ?? true
    const duplicatePackageNames = this.profileExtensionOwnerConflicts(
      extensionId,
      arkmeClientContentDigestFromSource(inspected.files),
      resolution.package_name,
    )
    input.onProgress?.({ phase: 'registering', version: resolution.version, message: '正在通过 DSH CLI 加入 Bundle' })
    try {
      await this.options.profileInstaller.installTarball(artifactPath)
      if (!desiredEnabled) await this.options.profileInstaller.setEnabled(resolution.package_name, false)
      await this.removeSupersededProfilePackage(previous, resolution.package_name)
      await this.restoreDisabledProfileLayers(extensionId)
      await this.removeProfilePackages(duplicatePackageNames)
    } catch (error) {
      try {
        await this.restorePreviousProfilePackage(previous, resolution.package_name)
      } catch { /* Preserve the original install error. */ }
      this.removeArtifact(artifactPath)
      throw new ArkmePluginError(
        'extension-profile-install-failed',
        `Bundle 已验证，但无法加入 DSH Profile：${error instanceof Error ? error.message : String(error)}`,
        true,
        500,
        { cause: error },
      )
    }
    const manifest: ArkmeInstalledExtension['manifest'] = {
      format: 'arkme-cordis-extension',
      format_version: 1,
      name: resolution.package_name,
      description: '',
      version: resolution.version,
      runtime: { dsh: '*', arkme_provider_contract: ARKME_PROVIDER_CONTRACT_VERSION },
      halves: { host: true, client: inspected.files.has('package/lib/client.js') },
      permissions: [],
      entrypoints: { host: 'host.js', ...(inspected.files.has('package/lib/client.js') ? { client: 'client.js' as const } : {}) },
    }
    const installed: ArkmeInstalledExtension = {
      extensionId,
      installedVersion: resolution.version,
      artifactSha256: resolution.bundle_sha256,
      artifactPath,
      manifest,
      enabled: desiredEnabled,
      active: false,
      profilePackageName: resolution.package_name,
      profileBundlePath: artifactPath,
      executionModel: resolution.execution_model,
      artifactContractVersion: 2,
      packageJsonSha256: resolution.package_json_sha256,
      sourceSha256: resolution.source_sha256,
      permissionSnapshot: [],
      updateChannel: 'stable',
      installedAtMillis: Date.now(),
      lastCheckedAtMillis: Date.now(),
    }
    this.store.put(installed)
    if (desiredEnabled) {
      this.pendingProfileChanges.set(extensionId, {
        extensionId,
        packageName: resolution.package_name,
        expectActive: true,
        targetBundlePath: artifactPath,
        ...(previous?.profileBundlePath === undefined ? {} : { previousBundlePath: previous.profileBundlePath }),
        cleanupPaths: previous === undefined ? [] : [previous.profileBundlePath, previous.artifactPath]
          .filter((path): path is string => path !== undefined && path !== artifactPath),
        ...(previous === undefined ? {} : { previousInstalled: previous }),
      })
    } else {
      this.pendingProfileChanges.delete(extensionId)
    }
    return {
      extension_id: extensionId,
      version: resolution.version,
      state: 'installed',
      installed: true,
      active: false,
      approval_required: false,
      restart_required: desiredEnabled,
      message: desiredEnabled
        ? resolution.execution_model === 'dsh-native'
          ? '原生 DSH Bundle 已安装；它拥有 DSH 插件进程权限，请重启 DSH 后生效'
          : 'Arkme 沙箱 Bundle 已安装；请重启 DSH 后生效'
        : 'Bundle 已更新并保持关闭',
    }
  }

  async uninstall(input: { agent: unknown; extensionId: string }): Promise<ArkmeExtensionUninstallResult> {
    const extensionId = requiredId(input.extensionId, 'extension_id')
    const installed = this.store.get(extensionId)
    if (installed === undefined) {
      void this.reportInstallationState(extensionId, false)
      return { extension_id: extensionId, installed: false, active: false, restart_required: false, message: '扩展未安装' }
    }
    if (installed.dynamicPluginId !== undefined) {
      if (this.runner.undefine === undefined) {
        throw new ArkmePluginError('extension-uninstall-runtime-unavailable', '当前 Dynamic Cordis 不支持卸载扩展', false, 503)
      }
      const agent = this.activeAgents.get(extensionId) ?? input.agent
      const result = await this.runner.undefine(agent, installed.dynamicPluginId)
      if (!result.ok && result.reason !== 'plugin-missing') {
        throw new ArkmePluginError(
          'extension-uninstall-failed',
          result.message?.trim() || 'Dynamic Cordis 无法卸载扩展',
          false,
          409,
        )
      }
    }
    await deactivatePersistentArkmeExtension(extensionId)
    if (installed.profilePackageName !== undefined) await deactivateArkmeBundle(installed.profilePackageName)
    if (installed.profilePackageName !== undefined && this.options.profileInstaller !== undefined) {
      try {
        await this.options.profileInstaller.remove(installed.profilePackageName)
        await this.restoreDisabledProfileLayers(extensionId)
      } catch (error) {
        throw new ArkmePluginError(
          'extension-profile-remove-failed',
          `无法从 DSH Profile 卸载扩展：${error instanceof Error ? error.message : String(error)}`,
          true,
          500,
          { cause: error },
        )
      }
    }
    this.store.remove(extensionId)
    this.activeAgents.delete(extensionId)
    void this.reportInstallationState(extensionId, false)
    if (installed.profilePackageName !== undefined) {
      this.pendingProfileChanges.set(extensionId, {
        extensionId,
        packageName: installed.profilePackageName,
        expectActive: false,
        ...(installed.profileBundlePath === undefined ? {} : { previousBundlePath: installed.profileBundlePath }),
        cleanupPaths: [installed.profileBundlePath, installed.artifactPath]
          .filter((path): path is string => path !== undefined),
        previousInstalled: installed,
      })
      if (AUTO_RESTART_DSH_AFTER_PROFILE_CHANGE) {
        await this.options.profileInstaller?.restart({
          extensionId,
          packageName: installed.profilePackageName,
          ...(installed.profileBundlePath === undefined ? {} : { previousBundlePath: installed.profileBundlePath }),
          cleanupPaths: [installed.profileBundlePath, installed.artifactPath]
            .filter((path): path is string => path !== undefined),
          previousInstalled: installed,
          expectActive: false,
        })
      }
    } else {
      this.removeArtifact(installed.artifactPath)
    }
    return {
      extension_id: extensionId,
      installed: false,
      active: false,
      restart_required: installed.profilePackageName !== undefined,
      message: '扩展已卸载',
    }
  }

  private async reportOpen(extensionId: string, signal?: AbortSignal): Promise<void> {
    const recordOpen = (this.client as Partial<ExtensionPublishClient>).recordOpen
    if (typeof recordOpen !== 'function') return
    try {
      await recordOpen.call(this.client, extensionId, signal)
    } catch {
      // Engagement telemetry is best effort and must never hide a successfully loaded detail.
    }
  }

  private async reportInstallationState(extensionId: string, installed: boolean, signal?: AbortSignal): Promise<void> {
    const setInstallationState = (this.client as Partial<ExtensionPublishClient>).setInstallationState
    if (typeof setInstallationState !== 'function') return
    try {
      await setInstallationState.call(this.client, {
        extension_id: extensionId,
        installation_id: this.installationInstanceId,
        installed,
      }, signal)
    } catch {
      // The next startup snapshot repairs missed reports without rolling back local lifecycle success.
    }
  }

  private async syncInstallationSnapshot(): Promise<void> {
    const syncInstallationStates = (this.client as Partial<ExtensionPublishClient>).syncInstallationStates
    if (typeof syncInstallationStates !== 'function') return
    try {
      await syncInstallationStates.call(this.client, {
        installation_id: this.installationInstanceId,
        installed_extension_ids: this.store.list().map(item => item.extensionId),
      })
    } catch {
      // Older services and temporary network failures are compatible; a later startup retries the snapshot.
    }
  }

  async restartProfileChange(extensionIdValue: string): Promise<{ restarting: true }> {
    const extensionId = requiredId(extensionIdValue, 'extension_id')
    const pending = this.pendingProfileChanges.get(extensionId)
    if (pending === undefined || this.options.profileInstaller === undefined) {
      throw new ArkmePluginError('extension-restart-not-pending', '该扩展当前没有等待重启的变更', false, 409)
    }
    await this.options.profileInstaller.restart(pending)
    return { restarting: true }
  }

  private installedClientInstanceKey(item: ArkmeInstalledExtension): string {
    return `instance-v1-${createHash('sha256').update([
      item.extensionId,
      item.profilePackageName ?? '',
      item.installedVersion,
      item.artifactSha256,
    ].join('\0')).digest('hex')}`
  }

  private installedClientContentDigest(item: ArkmeInstalledExtension): string | undefined {
    if (!item.manifest.halves.client || !existsSync(item.artifactPath)) return undefined
    try {
      const bytes = readFileSync(item.artifactPath)
      if (sha256Hex(bytes) !== item.artifactSha256) return undefined
      if (item.executionModel === undefined) {
        const unpacked = unpackArkmeExtension(bytes)
        return unpacked.clientCode === undefined ? undefined : arkmeClientContentDigest(unpacked.clientCode)
      }
      const inspected = item.artifactContractVersion === 3
        ? inspectNativeBundleArtifactV3(bytes)
        : inspectBundleArtifact(bytes)
      return arkmeClientContentDigestFromSource(inspected.files)
    } catch {
      return undefined
    }
  }

  private profileExtensionOwnerConflicts(
    extensionId: string,
    contentDigest: string | undefined,
    packageName: string,
  ): string[] {
    if (this.options.profileDirectory === undefined) return []
    const managedPackageOwners = new Map(this.store.list()
      .filter((item): item is ArkmeInstalledExtension & { profilePackageName: string } => item.profilePackageName !== undefined)
      .map(item => [item.profilePackageName, item.extensionId]))
    return activeProfileExtensionOwnerConflicts({
      profileDirectory: this.options.profileDirectory,
      extensionId,
      ...(contentDigest === undefined ? {} : { contentDigest }),
      packageName,
      managedPackageOwners,
    })
  }

  private refreshPersistentClientWrappers(): void {
    for (const item of this.store.list()) {
      if (item.executionModel !== undefined || item.profileBundlePath === undefined || !item.manifest.halves.client
        || item.profilePackageName === undefined || !this.profileContains(item.profilePackageName, false)) continue
      const bundleDirectory = this.resolveLegacyBundlePath(item.profileBundlePath)
      if (bundleDirectory === undefined) continue
      try {
        const bytes = readFileSync(item.artifactPath)
        if (sha256Hex(bytes) !== item.artifactSha256) throw new Error('installed extension artifact digest mismatch')
        const unpacked = unpackArkmeExtension(bytes)
        if (unpacked.manifest.version !== item.installedVersion || unpacked.clientCode === undefined) {
          throw new Error('installed extension Client identity mismatch')
        }
        refreshPersistentClientWrapper({
          bundleDirectory,
          packageName: item.profilePackageName,
          extensionId: item.extensionId,
          version: item.installedVersion,
          name: item.manifest.name,
          clientCode: unpacked.clientCode,
          ...(this.options.clientApiPath === undefined ? {} : { clientApiPath: this.options.clientApiPath }),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        try { quarantinePersistentExtension(bundleDirectory, item.extensionId, error) } catch { /* Profile disable remains best effort. */ }
        this.store.put({ ...item, enabled: false, active: false, lastError: message.slice(0, 2_000) })
        void this.options.profileInstaller?.setEnabled(item.profilePackageName, false).catch(disableError => {
          console.error(`[arkme-extension:${item.extensionId}] failed to disable an unrepairable Client wrapper`, disableError)
        })
      }
    }
  }

  private async reconcileProfileClientOwners(): Promise<void> {
    if (this.options.profileInstaller === undefined) return
    for (const item of this.store.list()) {
      if (!item.enabled || item.profilePackageName === undefined) continue
      const conflicts = this.profileExtensionOwnerConflicts(
        item.extensionId,
        this.installedClientContentDigest(item),
        item.profilePackageName,
      )
      if (conflicts.length === 0) continue
      try {
        await this.removeProfilePackages(conflicts)
        console.warn(`[arkme-extension:${item.extensionId}] replaced duplicate Profile Client owners: ${conflicts.join(', ')}`)
      } catch (error) {
        console.error(`[arkme-extension:${item.extensionId}] failed to replace duplicate Profile Client owners`, error)
      }
    }
  }

  private assertCompatible(runtime: { dsh: string; arkme_provider_contract: number }): void {
    if (runtime.arkme_provider_contract !== ARKME_PROVIDER_CONTRACT_VERSION) {
      throw new ArkmePluginError('extension-arkme-incompatible', '扩展需要不兼容的 Arkme Provider 合同版本', false, 409)
    }
    const range = runtime.dsh.trim()
    if (range === '*' || range === '') return
    if (range.startsWith('>=')) {
      if (!atLeast(this.dshRuntimeVersion, range.slice(2).trim())) {
        throw new ArkmePluginError('extension-dsh-incompatible', `扩展需要 DSH ${range}`, false, 409)
      }
      return
    }
    if (range !== this.dshRuntimeVersion) {
      throw new ArkmePluginError('extension-dsh-range-unsupported', `无法安全判断扩展 DSH 兼容范围：${range}`, false, 409)
    }
  }

  private removeLegacyBundle(bundlePath: string): void {
    if (this.options.profileDirectory === undefined) return
    if (!existsSync(bundlePath)) return
    const target = this.resolveLegacyBundlePath(bundlePath)
    if (target === undefined) {
      throw new ArkmePluginError('extension-bundle-path-invalid', '本地扩展 Bundle 路径无效，拒绝删除', false, 500)
    }
    rmSync(target, { recursive: true, force: true })
  }

  private async rollbackLegacyProfileInstall(
    persistentBundle: ReturnType<typeof materializePersistentExtensionBundle> | undefined,
    previous: ArkmeInstalledExtension | undefined,
  ): Promise<void> {
    if (persistentBundle === undefined || this.options.profileInstaller === undefined) return
    await this.restorePreviousProfilePackage(previous, persistentBundle.packageName)
    this.removeLegacyBundle(persistentBundle.bundleDirectory)
  }

  private async removeSupersededProfilePackage(
    previous: ArkmeInstalledExtension | undefined,
    nextPackageName: string,
  ): Promise<void> {
    const packageNames = new Set<string>()
    if (previous?.profilePackageName !== undefined && previous.profilePackageName !== nextPackageName) {
      packageNames.add(previous.profilePackageName)
    }
    packageNames.delete(nextPackageName)
    await this.removeProfilePackages([...packageNames])
  }

  private async removeProfilePackages(packageNames: readonly string[]): Promise<void> {
    if (this.options.profileInstaller === undefined || packageNames.length === 0) return
    const unique = [...new Set(packageNames)]
    if (this.options.profileInstaller.removeMany !== undefined) {
      await this.options.profileInstaller.removeMany(unique)
      return
    }
    for (const packageName of unique) await this.options.profileInstaller.remove(packageName)
  }

  private async restorePreviousProfilePackage(
    previous: ArkmeInstalledExtension | undefined,
    newPackageName: string,
  ): Promise<void> {
    if (this.options.profileInstaller === undefined) return
    if (previous?.profileBundlePath === undefined) {
      await this.options.profileInstaller.remove(newPackageName)
      return
    }
    if (previous.profilePackageName !== undefined && previous.profilePackageName !== newPackageName) {
      await this.options.profileInstaller.remove(newPackageName)
    }
    if (previous.profileBundlePath.endsWith('.tgz')) {
      await this.options.profileInstaller.installTarball(previous.profileBundlePath)
    } else {
      await this.options.profileInstaller.install(previous.profileBundlePath)
    }
    if (!previous.enabled && previous.profilePackageName !== undefined) {
      await this.options.profileInstaller.setEnabled(previous.profilePackageName, false)
    }
  }

  private removeArtifact(artifactPath: string): void {
    const root = resolve(this.options.artifactDirectory)
    const target = resolve(artifactPath)
    const pathFromRoot = relative(root, target)
    if (pathFromRoot.startsWith('..') || pathFromRoot === '' || pathFromRoot.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
      throw new ArkmePluginError('extension-artifact-path-invalid', '本地扩展制品路径无效，拒绝删除', false, 500)
    }
    rmSync(target, { force: true })
    for (const directory of [dirname(target), dirname(dirname(target))]) {
      try { rmdirSync(directory) } catch (error) {
        if (!['ENOTEMPTY', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      }
    }
  }

  private writeActivation(bundlePath: string, extensionId: string, enabled: boolean): void {
    if (this.options.profileDirectory === undefined) {
      throw new ArkmePluginError('extension-bundle-path-invalid', '当前 DSH Profile 路径不可用', false, 500)
    }
    const target = this.resolveLegacyBundlePath(bundlePath)
    if (target === undefined) {
      throw new ArkmePluginError('extension-bundle-path-invalid', '本地扩展 Bundle 路径无效，拒绝修改启用状态', false, 500)
    }
    writePersistentExtensionActivation(target, extensionId, enabled)
  }

  private resolveLegacyBundlePath(bundlePath: string): string | undefined {
    if (this.options.profileDirectory === undefined) return undefined
    try {
      const root = realpathSync(resolve(this.options.profileDirectory, 'arkme-extensions'))
      const target = realpathSync(resolve(bundlePath))
      const pathFromRoot = relative(root, target)
      if (pathFromRoot === '' || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`)
        || isAbsolute(pathFromRoot)) return undefined
      return target
    } catch {
      return undefined
    }
  }

  private profileContains(packageName: string, enabled = true): boolean {
    if (this.options.profileDirectory === undefined) return false
    try {
      const manifest = JSON.parse(readFileSync(join(this.options.profileDirectory, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
        dsh?: { profile?: { bundles?: string[] } }
      }
      return manifest.dependencies?.[packageName] !== undefined
        && (!enabled || manifest.dsh?.profile?.bundles?.includes(packageName) === true)
    } catch {
      return false
    }
  }

  private async restoreDisabledProfileLayers(
    exceptExtensionId: string,
    onError?: (item: ArkmeInstalledExtension, error: unknown) => void,
  ): Promise<ArkmeInstalledExtension[]> {
    const repaired: ArkmeInstalledExtension[] = []
    if (this.options.profileInstaller === undefined) return repaired
    for (const item of this.store.list()) {
      if (item.extensionId === exceptExtensionId || item.enabled || item.profilePackageName === undefined) continue
      if (!this.profileContains(item.profilePackageName, false)) continue
      const included = this.profileContains(item.profilePackageName, true)
      try {
        await this.options.profileInstaller.setEnabled(item.profilePackageName, false)
        if (included) repaired.push(item)
      } catch (error) {
        if (onError === undefined) throw error
        onError(item, error)
      }
    }
    return repaired
  }

  private rememberActivationRestart(
    previousInstalled: ArkmeInstalledExtension,
    previousProfileIncluded: boolean,
    expectActive: boolean,
  ): void {
    if (previousInstalled.profilePackageName === undefined) return
    const existing = this.pendingProfileChanges.get(previousInstalled.extensionId)
    const rollbackBaseline = existing?.activationChange === true ? existing : undefined
    this.pendingProfileChanges.set(previousInstalled.extensionId, {
      extensionId: previousInstalled.extensionId,
      packageName: previousInstalled.profilePackageName,
      expectActive,
      cleanupPaths: [],
      previousInstalled: rollbackBaseline?.previousInstalled ?? previousInstalled,
      activationChange: true,
      previousProfileIncluded: rollbackBaseline?.previousProfileIncluded ?? previousProfileIncluded,
    })
  }

  private persistArtifact(extensionId: string, version: string, bytes: Uint8Array, filename = 'extension.arkext'): string {
    requiredId(version, 'version')
    const directory = join(this.options.artifactDirectory, extensionId, version)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
    const target = join(directory, filename)
    const temporary = join(directory, `.${filename}.${randomUUID()}.tmp`)
    writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' })
    renameSync(temporary, target)
    chmodSync(target, 0o600)
    return target
  }

  private persistAuthoredBundle(source: ArkmeBundlePublishSource): { path: string; created: boolean } {
    const packageKey = bundleSha256(source.bundle.packageName).slice(0, 32)
    const directory = join(this.options.artifactDirectory, 'authored', packageKey, source.bundle.version)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
    const target = join(directory, 'bundle.tgz')
    if (existsSync(target)) {
      const existingDigest = bundleSha256(readFileSync(target))
      if (existingDigest !== source.bundle.bundleSha256) {
        throw new ArkmePluginError(
          'extension-profile-version-conflict',
          `插件 ${source.bundle.packageName}@${source.bundle.version} 已保存不同内容，请使用新版本号`,
          false,
          409,
        )
      }
      return { path: target, created: false }
    }
    const temporary = join(directory, `.bundle.tgz.${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, source.bundle.bytes, { mode: 0o600, flag: 'wx' })
      try {
        // A hard link is an atomic no-overwrite publish on the same filesystem. Unlike
        // rename, it cannot replace a bundle written concurrently by another process.
        linkSync(temporary, target)
        chmodSync(target, 0o600)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const existingDigest = bundleSha256(readFileSync(target))
        if (existingDigest !== source.bundle.bundleSha256) {
          throw new ArkmePluginError(
            'extension-profile-version-conflict',
            `插件 ${source.bundle.packageName}@${source.bundle.version} 已保存不同内容，请使用新版本号`,
            false,
            409,
          )
        }
        return { path: target, created: false }
      }
    } finally {
      rmSync(temporary, { force: true })
    }
    return { path: target, created: true }
  }
}
