import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { ArkmePluginError } from '../arkme-service.js'
import { ARKME_PROVIDER_CONTRACT_VERSION } from '../types.js'
import { materializeCordisBundle } from './bundle-materializer.js'
import type { ArkmeBundlePublishSource } from './bundle-artifact.js'
import { bundleSha256, inspectBundleArtifact } from './bundle-artifact.js'
import { arkmeBundleActive, deactivateArkmeBundle } from './bundle-runtime.js'
import { ArkmeExtensionInstallStore } from './install-store.js'
import { ExtensionPublishClient } from './publish-client.js'
import type { ArkmeExtensionProfileInstaller } from './profile-installer.js'
import { deactivatePersistentArkmeExtension, persistentArkmeExtensionActive } from './persistent-runtime.js'
import { verifyBundleResolutionSignature, verifyExtensionResolutionSignature } from './signature.js'
export { verifyExtensionResolutionSignature } from './signature.js'
import {
  type ArkmeExtensionCatalogItem, type ArkmeExtensionCatalogPage,
  type ArkmeExtensionDeleteResult, type ArkmeExtensionInstallPreview, type ArkmeExtensionInstallResolution,
  type ArkmeExtensionPublishResult, type ArkmeExtensionUpdateResolution, type ArkmeExtensionVisibility,
  type ArkmeExtensionInstallProgress, type ArkmeInstalledExtension, type DynamicCordisPackageInspectionLike,
  type DynamicCordisRunnerLike,
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
  profileInstaller?: Pick<ArkmeExtensionProfileInstaller, 'install' | 'installTarball' | 'remove' | 'restart'>
  clientApiPath?: string
  pluginInventory?: ArkmePluginInventoryLike
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

function bundleInstallResolution(value: ArkmeExtensionInstallResolution): boolean {
  return value.artifact_contract_version === 2 && value.artifact_kind === 'dsh-bundle-tgz'
    && typeof value.package_name === 'string' && value.package_name.trim() !== ''
    && (value.execution_model === 'arkme-sandboxed' || value.execution_model === 'dsh-native')
    && typeof value.bundle_url === 'string' && value.bundle_url.trim() !== ''
    && typeof value.bundle_size === 'number' && value.bundle_size > 0
    && typeof value.bundle_sha256 === 'string' && typeof value.package_json_sha256 === 'string'
    && typeof value.source_sha256 === 'string'
}

function completedPublishSession(
  session: import('./types.js').ArkmeBundlePublishSession,
  fallbackVersion: string,
): ArkmeExtensionPublishResult | undefined {
  return session.status === 'published'
    ? { extension_id: session.extension_id, version: session.version ?? fallbackVersion, status: 'published' }
    : undefined
}

function requireBundleUploadSlots(session: import('./types.js').ArkmeBundlePublishSession): {
  bundle: NonNullable<typeof session.bundle_upload>
  source: NonNullable<typeof session.source_upload>
} {
  if (session.bundle_upload === undefined || session.source_upload === undefined) {
    throw new ArkmePluginError('extension-publish-contract-invalid', '扩展市场没有返回完整的 Bundle/source 上传槽', false, 502)
  }
  return { bundle: session.bundle_upload, source: session.source_upload }
}

interface PendingProfileChange {
  extensionId: string
  packageName: string
  expectActive: boolean
  targetBundlePath?: string
  previousBundlePath?: string
  cleanupPaths: string[]
  previousInstalled?: ArkmeInstalledExtension
}

function requiredId(value: string, label: string): string {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized)) {
    throw new ArkmePluginError('extension-id-invalid', `${label}无效`, false)
  }
  return normalized
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

export class ArkmeExtensionManager {
  private readonly trustedKeys: Map<string, string>
  private readonly activeAgents = new Map<string, unknown>()
  private readonly pendingProfileChanges = new Map<string, PendingProfileChange>()

  constructor(
    readonly client: ExtensionPublishClient,
    readonly store: ArkmeExtensionInstallStore,
    private readonly runner: DynamicCordisRunnerLike,
    private readonly options: ArkmeExtensionManagerOptions,
  ) {
    this.trustedKeys = parseTrustedKeys(options.trustedSigningKeys)
    mkdirSync(options.artifactDirectory, { recursive: true, mode: 0o700 })
    chmodSync(options.artifactDirectory, 0o700)
  }

  /** Profile installation is Host-owned and does not need a live conversation Agent. */
  canInstallWithoutAgent(): boolean {
    return this.options.profileDirectory !== undefined && this.options.profileInstaller !== undefined
  }

  /** Profile-only extensions can be removed without touching a legacy dynamic Agent. */
  canUninstallWithoutAgent(extensionIdValue: string): boolean {
    const extensionId = requiredId(extensionIdValue, 'extension_id')
    return this.store.get(extensionId)?.dynamicPluginId === undefined
  }

  inspectPackage(agent: unknown, pluginId: string, packageId: string): DynamicCordisPackageInspectionLike {
    return this.runner.inspectPackage(agent, requiredId(pluginId, 'plugin_id'), requiredId(packageId, 'package_id'))
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
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<ArkmeExtensionPublishResult> {
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
    }, input.signal)
    const completed = completedPublishSession(session, source.bundle.version)
    if (completed !== undefined) return completed
    const slots = requireBundleUploadSlots(session)
    try {
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
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<ArkmeExtensionPublishResult> {
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
    }, input.signal)
    const completed = completedPublishSession(session, input.source.bundle.version)
    if (completed !== undefined) return completed
    const slots = requireBundleUploadSlots(session)
    try {
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

  async search(query = '', limit = 20, signal?: AbortSignal): Promise<ArkmeExtensionCatalogPage> {
    return await this.client.list({ query: query.trim(), limit: Math.min(50, Math.max(1, Math.trunc(limit))) }, signal)
  }

  async inspect(extensionId: string, signal?: AbortSignal): Promise<ArkmeExtensionCatalogItem> {
    return await this.client.detail(requiredId(extensionId, 'extension_id'), signal)
  }

  async previewInstall(extensionId: string, version?: string, signal?: AbortSignal): Promise<ArkmeExtensionInstallPreview> {
    const requestedId = requiredId(extensionId, 'extension_id')
    const resolution = await this.client.resolveInstall(requestedId, version, signal)
    if (resolution.extension_id !== requestedId) {
      throw new ArkmePluginError('extension-install-contract-invalid', '扩展市场返回了错误的扩展身份', false, 502)
    }
    if (bundleInstallResolution(resolution)) {
      const bundle = resolution as BundleInstallResolution
      return {
        extension_id: bundle.extension_id,
        version: bundle.version,
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

  async myList(signal?: AbortSignal): Promise<ArkmeExtensionCatalogPage> {
    return await this.client.myList({ limit: 50 }, signal)
  }

  async delete(extensionId: string, signal?: AbortSignal): Promise<ArkmeExtensionDeleteResult> {
    return await this.client.deleteExtension(requiredId(extensionId, 'extension_id'), signal)
  }

  listInstalled(): ArkmeInstalledExtension[] {
    const loaderEntries = this.options.pluginInventory?.list().entries ?? []
    return this.store.list().map(item => {
      const loaderActive = item.profilePackageName !== undefined && loaderEntries.some(entry =>
        entry.moduleName === item.profilePackageName && entry.enabled && entry.fiberPhase === 'active')
      const active = loaderActive || (item.executionModel === 'arkme-sandboxed' && item.profilePackageName !== undefined
        ? arkmeBundleActive(item.profilePackageName)
        : persistentArkmeExtensionActive(item.extensionId))
      return active ? { ...item, active: true } : item
    })
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
    if (previous?.profilePackageName !== undefined && !this.profileContains(previous.profilePackageName)) {
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
      throw new ArkmePluginError('extension-install-contract-invalid', '扩展市场返回了错误的扩展身份', false, 502)
    }
    if (bundleInstallResolution(resolution)) {
      return await this.applyBundleV2(input, resolution as BundleInstallResolution, previous)
    }
    throw new ArkmePluginError(
      'extension-artifact-legacy-unsupported',
      '该扩展版本仍使用旧 .arkext 制品，请先完成 Bundle v2 迁移后再安装',
      false,
      409,
    )
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
    input.onProgress?.({ phase: 'registering', version: resolution.version, message: '正在通过 DSH CLI 加入 Bundle' })
    try {
      await this.options.profileInstaller.installTarball(artifactPath)
    } catch (error) {
      try {
        if (previous?.profileBundlePath !== undefined) {
          if (previous.profileBundlePath.endsWith('.tgz')) await this.options.profileInstaller.installTarball(previous.profileBundlePath)
          else await this.options.profileInstaller.install(previous.profileBundlePath)
        } else {
          await this.options.profileInstaller.remove(resolution.package_name)
        }
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
      enabled: true,
      active: false,
      profilePackageName: resolution.package_name,
      profileBundlePath: artifactPath,
      executionModel: resolution.execution_model,
      packageJsonSha256: resolution.package_json_sha256,
      sourceSha256: resolution.source_sha256,
      permissionSnapshot: [],
      updateChannel: 'stable',
      installedAtMillis: Date.now(),
      lastCheckedAtMillis: Date.now(),
    }
    this.store.put(installed)
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
    return {
      extension_id: extensionId,
      version: resolution.version,
      state: 'installed',
      installed: true,
      active: false,
      approval_required: false,
      restart_required: true,
      message: resolution.execution_model === 'dsh-native'
        ? '原生 DSH Bundle 已安装；它拥有 DSH 插件进程权限，请重启 DSH 后生效'
        : 'Arkme 沙箱 Bundle 已安装；请重启 DSH 后生效',
    }
  }

  async uninstall(input: { agent: unknown; extensionId: string }): Promise<ArkmeExtensionUninstallResult> {
    const extensionId = requiredId(input.extensionId, 'extension_id')
    const installed = this.store.get(extensionId)
    if (installed === undefined) {
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

  async restartProfileChange(extensionIdValue: string): Promise<{ restarting: true }> {
    const extensionId = requiredId(extensionIdValue, 'extension_id')
    const pending = this.pendingProfileChanges.get(extensionId)
    if (pending === undefined || this.options.profileInstaller === undefined) {
      throw new ArkmePluginError('extension-restart-not-pending', '该扩展当前没有等待重启的变更', false, 409)
    }
    await this.options.profileInstaller.restart(pending)
    return { restarting: true }
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

  private profileContains(packageName: string): boolean {
    if (this.options.profileDirectory === undefined) return false
    try {
      const manifest = JSON.parse(readFileSync(join(this.options.profileDirectory, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
        dsh?: { profile?: { bundles?: string[] } }
      }
      return manifest.dependencies?.[packageName] !== undefined
        && manifest.dsh?.profile?.bundles?.includes(packageName) === true
    } catch {
      return false
    }
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
}
