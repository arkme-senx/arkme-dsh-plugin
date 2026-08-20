import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { ArkmePluginError } from '../arkme-service.js'
import { ARKME_PROVIDER_CONTRACT_VERSION } from '../types.js'
import {
  canonicalExtensionJson, sha256Hex, unpackArkmeExtension,
} from './artifact.js'
import { materializeCordisBundle } from './bundle-materializer.js'
import type { ArkmeBundlePublishSource } from './bundle-artifact.js'
import { bundleSha256, inspectBundleArtifact } from './bundle-artifact.js'
import { arkmeBundleActive, deactivateArkmeBundle } from './bundle-runtime.js'
import { ArkmeExtensionInstallStore } from './install-store.js'
import { ExtensionPublishClient } from './publish-client.js'
import { materializePersistentExtensionBundle } from './persistent-bundle.js'
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

function bundleInstallResolution(value: ArkmeExtensionInstallResolution): value is BundleInstallResolution {
  return value.artifact_contract_version === 2 && value.artifact_kind === 'dsh-bundle-tgz'
    && typeof value.package_name === 'string' && value.package_name.trim() !== ''
    && (value.execution_model === 'arkme-sandboxed' || value.execution_model === 'dsh-native')
    && typeof value.bundle_url === 'string' && value.bundle_url.trim() !== ''
    && typeof value.bundle_size === 'number' && value.bundle_size > 0
    && typeof value.bundle_sha256 === 'string' && typeof value.package_json_sha256 === 'string'
    && typeof value.source_sha256 === 'string'
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

export class ArkmeExtensionManager {
  private readonly trustedKeys: Map<string, string>
  private readonly dshRuntimeVersion: string
  private readonly activeAgents = new Map<string, unknown>()
  private readonly pendingProfileChanges = new Map<string, PendingProfileChange>()

  constructor(
    readonly client: ExtensionPublishClient,
    readonly store: ArkmeExtensionInstallStore,
    private readonly runner: DynamicCordisRunnerLike,
    private readonly options: ArkmeExtensionManagerOptions,
  ) {
    this.trustedKeys = parseTrustedKeys(options.trustedSigningKeys)
    this.dshRuntimeVersion = options.dshRuntimeVersion ?? '0.1.0-rc.7'
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
      packageName: `@arkme-generated/${sha256Hex(`cordis\0${input.pluginId}`).slice(0, 24)}`,
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
    try {
      await this.client.uploadBundle(session.bundle_upload, source.bundle, input.signal)
      await this.client.uploadSource(session.source_upload, source.source, input.signal)
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
    try {
      await this.client.uploadBundle(session.bundle_upload, input.source.bundle, input.signal)
      await this.client.uploadSource(session.source_upload, input.source.source, input.signal)
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
      return {
        extension_id: resolution.extension_id,
        version: resolution.version,
        package_name: resolution.package_name,
        execution_model: resolution.execution_model,
        bundle_size: resolution.bundle_size,
        requires_native_confirmation: resolution.requires_native_confirmation === true,
        manifest: resolution.manifest,
        revoked: resolution.revoked,
        ...(resolution.revocation_reason === undefined ? {} : { revocation_reason: resolution.revocation_reason }),
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
    return this.store.list().map(item => {
      const active = item.executionModel === 'arkme-sandboxed' && item.profilePackageName !== undefined
        ? arkmeBundleActive(item.profilePackageName)
        : persistentArkmeExtensionActive(item.extensionId)
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
      return await this.applyBundleV2(input, resolution, previous)
    }
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
      input.onProgress?.({ phase: 'registering', version: resolution.version, message: '正在加入 DSH 插件列表' })
      try {
        await this.options.profileInstaller.install(persistentBundle.bundleDirectory)
        await deactivatePersistentArkmeExtension(extensionId)
      } catch (error) {
        await this.rollbackProfileInstall(persistentBundle, previous).catch(() => undefined)
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
      enabled: true,
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
      return {
        extension_id: extensionId,
        version: resolution.version,
        state: 'installed',
        installed: true,
        active: false,
        approval_required: false,
        restart_required: true,
        message: '扩展已加入 DSH 插件列表；请手动重启 DSH 后生效',
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
        await this.rollbackProfileInstall(persistentBundle, previous)
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
      await this.rollbackProfileInstall(persistentBundle, previous).catch(() => undefined)
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

  private removeBundle(bundlePath: string): void {
    if (this.options.profileDirectory === undefined) return
    const root = resolve(this.options.profileDirectory, 'arkme-extensions')
    const target = resolve(bundlePath)
    const pathFromRoot = relative(root, target)
    if (pathFromRoot.startsWith('..') || pathFromRoot === '') {
      throw new ArkmePluginError('extension-bundle-path-invalid', '本地扩展 Bundle 路径无效，拒绝删除', false, 500)
    }
    rmSync(target, { recursive: true, force: true })
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

  private async rollbackProfileInstall(
    persistentBundle: ReturnType<typeof materializePersistentExtensionBundle> | undefined,
    previous: ArkmeInstalledExtension | undefined,
  ): Promise<void> {
    if (persistentBundle === undefined || this.options.profileInstaller === undefined) return
    if (previous?.profileBundlePath !== undefined) await this.options.profileInstaller.install(previous.profileBundlePath)
    else await this.options.profileInstaller.remove(persistentBundle.packageName)
    this.removeBundle(persistentBundle.bundleDirectory)
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
