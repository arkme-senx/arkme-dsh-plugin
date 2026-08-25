import { createHash } from 'node:crypto'
import { ArkmePluginError } from '../arkme-service.js'
import type { ArkmeExtensionCatalogItem, ArkmeExtensionCatalogPage, ArkmeExtensionCompleteDeleteResult,
  ArkmeExtensionDeleteResult, ArkmeExtensionPublishResult,
  ArkmeExtensionVisibility, DynamicCordisInventoryPackageLike, DynamicCordisInventoryRowLike,
  DynamicCordisRunnerLike,
} from './types.js'
import type { ArkmeExtensionPublishArtifactKind, ArkmeExtensionPublishRoute,
  ArkmeMyExtensionItem, ArkmeMyExtensionPage, ArkmeMyExtensionProfileSaveInput,
  ArkmeMyExtensionProfileSaveResult, ArkmeMyExtensionPublishInput,
  ArkmeMyExtensionState, ArkmeMyExtensionWarning, ArkmePreparedExtensionPublish,
} from './owned-types.js'
import type { ArkmeOwnedExtensionRefs } from './owned-refs.js'
import type { ArkmeOwnedExtensionStore } from './owned-store.js'
import { scanOwnedProfileExtensions } from './profile-owned-inventory.js'
import {
  packLocalBundleDirectory, packLocalNativeBundleDirectoryV3, readLocalBundleTarball,
  readNativeBundleTarballV3, type ArkmeBundlePublishSource, type ArkmeNativeBundlePublishSource,
} from './bundle-artifact.js'
import type { ArkmeOwnedExtensionTarget } from './owned-refs.js'

interface MutableOwnedItem {
  key: string
  name: string
  description: string
  halves: { host: boolean; client: boolean }
  cordis?: { row: DynamicCordisInventoryRowLike; packageId: string; sourceKey: string }
  persisted?: { packageName: string; version?: string; active: boolean; artifactContractVersion?: 2 | 3; publishable: boolean; publishReason?: string; target?: ArkmeOwnedExtensionTarget }
  published?: ArkmeExtensionCatalogItem
}

interface AgentRegistryLike {
  get(sessionId: string): unknown
}

interface ProviderStateLike {
  authStatus: string
  userId?: number
}

interface ExistingPublishIdentity {
  extensionId?: string
  packageName?: string
}

interface PublishInput {
  agent: unknown
  pluginId: string
  packageId: string
  packageName: string
  extensionId?: string
  name: string
  description: string
  version: string
  visibility: ArkmeExtensionVisibility
  changelog?: string
	githubRepositoryUrl?: string
  idempotencyKey: string
  signal?: AbortSignal
}

interface PublishSandboxBundleInput {
  source: ArkmeBundlePublishSource
  extensionId?: string
  name: string
  description: string
  visibility: ArkmeExtensionVisibility
  changelog?: string
	githubRepositoryUrl?: string
  idempotencyKey: string
  signal?: AbortSignal
}

interface PublishNativeBundleInput {
  source: ArkmeNativeBundlePublishSource
  extensionId?: string
  name: string
  description: string
  visibility: ArkmeExtensionVisibility
  changelog?: string
	githubRepositoryUrl?: string
  idempotencyKey: string
  signal?: AbortSignal
}

interface ArkmeOwnedExtensionLifecycle {
  deleteCloud(extensionId: string, signal?: AbortSignal): Promise<ArkmeExtensionDeleteResult>
  uninstall(input: { agent: unknown; extensionId: string }): Promise<{
    extension_id: string
    installed: false
    active: false
    restart_required: boolean
    message: string
  }>
  canUninstallWithoutAgent(extensionId: string): boolean
  installedProfilePackageName(extensionId: string): string | undefined
  removeProfilePackage(packageName: string): Promise<boolean>
}

export interface ArkmeOwnedExtensionInventoryOptions {
  hostInstanceId: string
  profileDirectory: string
  profileName: string
  store: ArkmeOwnedExtensionStore
  refs: ArkmeOwnedExtensionRefs
  providerState(): Promise<ProviderStateLike>
  cloudList(input: { cursor?: string; limit: number }, signal?: AbortSignal): Promise<ArkmeExtensionCatalogPage>
  runner: DynamicCordisRunnerLike
  agents: AgentRegistryLike
  publish(input: PublishInput): Promise<ArkmeExtensionPublishResult>
  persistCordis?(input: {
    agent: unknown
    pluginId: string
    packageId: string
    packageName: string
    name: string
    description: string
    version: string
  }): Promise<{
    source: ArkmeBundlePublishSource
    packageName: string
    version: string
    installed: true
    active: false
    restartRequired: true
    message: string
  }>
  publishSandboxBundle?(input: PublishSandboxBundleInput): Promise<ArkmeExtensionPublishResult>
  publishBundle?(input: PublishNativeBundleInput): Promise<ArkmeExtensionPublishResult>
  lifecycle?: ArkmeOwnedExtensionLifecycle
}

/** Host owner for current-account Cordis, Profile-local and cloud extension projections. */
export class ArkmeOwnedExtensionInventory {
  constructor(private readonly options: ArkmeOwnedExtensionInventoryOptions) {}

  captureCordisDefinition(input: { agentId: string; pluginId: string; creatorUserId: number }): void {
    this.options.store.claim('cordis', this.cordisSourceKey(input.agentId, input.pluginId), input.creatorUserId)
  }

  async list(input: { currentSessionId?: string; signal?: AbortSignal } = {}): Promise<ArkmeMyExtensionPage> {
    const userId = await this.currentUserId()
    const warnings = new Set<ArkmeMyExtensionWarning>()
    const cloudItems = await this.cloudItems(input.signal).catch(() => {
      warnings.add('cloud-unavailable')
      return []
    })
    const cloudIds = new Set(cloudItems.map(item => item.extension_id))
    const profile = scanOwnedProfileExtensions({
      profileDirectory: this.options.profileDirectory,
      profileName: this.options.profileName,
      userId,
      cloudOwnedExtensionIds: cloudIds,
      store: this.options.store,
    })
    if (profile.invalidEntries > 0) warnings.add('profile-entry-invalid')
    const cordisRows = this.options.runner.inventory?.()
    if (cordisRows === undefined) warnings.add('cordis-unavailable')
    const rows = new Map<string, MutableOwnedItem>()
    const profileRowKeys = new Map<string, string>()

    for (const cloud of cloudItems) {
      rows.set(`cloud:${cloud.extension_id}`, {
        key: `cloud:${cloud.extension_id}`,
        name: cloud.name,
        description: cloud.description,
        halves: cloud.manifest?.halves ?? { host: false, client: false },
        published: cloud,
      })
    }
    for (const local of profile.items) {
      const key = local.extensionId !== undefined && cloudIds.has(local.extensionId)
        ? `cloud:${local.extensionId}`
        : `profile:${local.sourceKey}`
      const row = rows.get(key) ?? {
        key,
        name: local.name,
        description: local.description,
        halves: local.halves,
      }
      row.persisted = {
        packageName: local.packageName,
        ...(local.version === undefined ? {} : { version: local.version }),
        active: local.active,
	    publishable: local.publishable,
	    ...(local.publishReason === undefined ? {} : { publishReason: local.publishReason }),
	    ...(local.artifactContractVersion === undefined ? {} : { artifactContractVersion: local.artifactContractVersion }),
	    ...(local.target === undefined ? {} : { target: local.target }),
      }
      row.halves = mergeHalves(row.halves, local.halves)
      rows.set(key, row)
      profileRowKeys.set(local.sourceKey, key)
    }
    for (const cordis of cordisRows ?? []) {
      const sourceKey = this.cordisSourceKey(cordis.agentId, cordis.pluginId)
      let owner = this.options.store.owner('cordis', sourceKey)
      if (owner === undefined && cordis.agentId === input.currentSessionId) {
        this.options.store.claim('cordis', sourceKey, userId)
        owner = userId
      }
      if (owner !== userId) continue
      const packageId = selectPublishPackage(cordis)
      if (packageId === undefined) continue
      const selected = cordis.packages.find(item => item.packageId === packageId)
      if (selected === undefined) continue
      const cloudId = this.options.store.cloudLink('cordis', sourceKey, userId)
      const linkedProfileRow = profileRowKeys.get(this.options.store.profileLink(sourceKey, userId) ?? '')
      const key = cloudId === undefined ? linkedProfileRow ?? `cordis:${sourceKey}` : `cloud:${cloudId}`
      const row = rows.get(key) ?? cordisItem(key, selected)
      row.name = selected.name
      row.description = selected.purpose
      row.cordis = { row: cordis, packageId, sourceKey }
      row.halves = mergeHalves(row.halves, { host: selected.hasHostHalf, client: selected.hasClientHalf })
      rows.set(key, row)
    }

    return {
      items: [...rows.values()].map(row => this.project(userId, row)),
      warnings: [...warnings],
    }
  }

  async publish(input: ArkmeMyExtensionPublishInput & { signal?: AbortSignal }): Promise<ArkmeExtensionPublishResult> {
    const userId = await this.currentUserId()
    const target = this.options.refs.resolve(userId, input.ownedRef)
	if (target.kind !== 'cordis') return await this.publishProfileTarget(userId, target, input)
    const agent = this.options.agents.get(target.agentId)
    if (agent === undefined) throw new ArkmePluginError('extension-agent-unavailable', '创建该扩展的 DSH 会话已不可用', false, 409)
    return await this.publishTarget(userId, target, agent, input)
  }

  async saveToProfile(input: ArkmeMyExtensionProfileSaveInput): Promise<ArkmeMyExtensionProfileSaveResult> {
    const userId = await this.currentUserId()
    const target = this.options.refs.resolve(userId, input.ownedRef)
    if (target.kind !== 'cordis') {
      throw new ArkmePluginError('extension-profile-already-persisted', '该插件已经是 Profile 来源', false, 409)
    }
    const agent = this.options.agents.get(target.agentId)
    if (agent === undefined) throw new ArkmePluginError('extension-agent-unavailable', '创建该扩展的 DSH 会话已不可用', false, 409)
    const saved = await this.persistCordisTarget(userId, target, agent, input)
    return {
      packageName: saved.profile.packageName,
      version: saved.profile.version,
      artifactContractVersion: 2,
      artifactKind: 'dsh-bundle-tgz',
      installed: true,
      active: false,
      restartRequired: true,
      message: saved.profile.message,
    }
  }

  /**
   * Preserve registry rows/artifacts for rollback, while removing every current-account runtime,
   * Profile dependency, install row, lineage row, and short-lived source reference.
   */
  async delete(input: { extensionId: string; agent?: unknown; signal?: AbortSignal }): Promise<ArkmeExtensionCompleteDeleteResult> {
    const extensionId = requiredExtensionId(input.extensionId)
    const userId = await this.currentUserId()
    const lifecycle = this.options.lifecycle
    if (lifecycle === undefined) {
      throw new ArkmePluginError('extension-delete-unavailable', '当前 Arkme 版本不支持完整删除扩展', false, 503)
    }
    if (input.agent === undefined && !lifecycle.canUninstallWithoutAgent(extensionId)) {
      throw new ArkmePluginError('extension-delete-agent-unavailable', '该扩展仍由旧版会话运行，请在原 DSH 会话中删除', false, 409)
    }

    const linkedSources = this.options.store.cloudReferences(userId, extensionId)
    const cordisInventory = this.options.runner.inventory?.()
    const cordisSources = linkedSources.flatMap(source => {
      if (source.kind !== 'cordis') return []
      if (cordisInventory === undefined) {
        throw new ArkmePluginError('extension-delete-runtime-unavailable', '无法确认并移除该扩展的 Cordis 运行引用', false, 503)
      }
      const row = cordisInventory.find(candidate => this.cordisSourceKey(candidate.agentId, candidate.pluginId) === source.key)
      if (row === undefined) return []
      if (this.options.runner.undefine === undefined || this.options.agents.get(row.agentId) === undefined) {
        throw new ArkmePluginError('extension-delete-runtime-unavailable', '无法确认并移除该扩展的 Cordis 运行引用', false, 503)
      }
      return [row]
    })
    const installedPackageName = lifecycle.installedProfilePackageName(extensionId)
    const profilePackages = [...new Set(linkedSources.flatMap(source => {
      if (source.kind !== 'profile') return []
      const prefix = `${this.options.profileName}\0`
      if (!source.key.startsWith(prefix)) {
        throw new ArkmePluginError('extension-delete-profile-reference-invalid', '扩展 Profile 引用无效', false, 500)
      }
      const packageName = source.key.slice(prefix.length)
      return packageName === installedPackageName ? [] : [packageName]
    }))]

    const ownedCloudItems = await this.cloudItems(input.signal)
    if (!ownedCloudItems.some(item => item.extension_id === extensionId)) {
      throw new ArkmePluginError('extension-delete-target-not-owned', '待删除扩展不属于当前 Arkme 账号或已删除', false, 404)
    }
    const uninstalled = await lifecycle.uninstall({ agent: input.agent, extensionId })
    let restartRequired = uninstalled.restart_required
    for (const source of cordisSources) {
      const agent = this.options.agents.get(source.agentId)
      const result = await this.options.runner.undefine!(agent, source.pluginId)
      if (!result.ok && result.reason !== 'plugin-missing') {
        throw new ArkmePluginError(
          'extension-delete-runtime-failed', result.message?.trim() || '无法移除扩展的 Cordis 运行引用', true, 500,
        )
      }
    }
    for (const packageName of profilePackages) {
      if (await lifecycle.removeProfilePackage(packageName)) restartRequired = true
    }
    const deleted = await lifecycle.deleteCloud(extensionId, input.signal)
    if (deleted.extension_id !== extensionId || deleted.status !== 'deleted') {
      throw new ArkmePluginError('extension-delete-contract-invalid', '市集返回了不一致的删除结果', false, 502)
    }
    const removedSources = this.options.store.removeCloudReferences(userId, extensionId)
    this.options.refs.clearUser(userId)
    return {
      ...deleted,
      installed: false,
      active: false,
      references_removed: true,
      removed_source_count: removedSources.length,
      restart_required: restartRequired,
      message: restartRequired
        ? '扩展已删除；服务端保留可恢复数据，当前 DSH 重启后完成本地移除'
        : '扩展已删除；服务端保留可恢复数据，本地引用和运行状态已完全移除',
    }
  }

  async preparePublish(input: ArkmeMyExtensionPublishInput, signal?: AbortSignal): Promise<ArkmePreparedExtensionPublish> {
    const userId = await this.currentUserId()
    const target = this.options.refs.resolve(userId, input.ownedRef)
    const identity = await this.preparePublishIdentity(
      target.kind === 'cordis' ? 'cordis' : 'profile', target.sourceKey, userId, input.extensionId, signal,
    )
    const extensionId = identity.extensionId
    const preparedInput = { ...input }
    if (extensionId === undefined) delete preparedInput.extensionId
    else preparedInput.extensionId = extensionId
    if (target.kind === 'cordis') {
      const agent = this.options.agents.get(target.agentId)
      if (agent === undefined) throw new ArkmePluginError('extension-agent-unavailable', '创建该扩展的 DSH 会话已不可用', false, 409)
      const live = this.options.runner.inventory?.().find(row => row.agentId === target.agentId && row.pluginId === target.pluginId)
      if (live === undefined || !live.packages.some(item => item.packageId === target.packageId)) {
        throw new ArkmePluginError('extension-cordis-stale', 'Cordis 扩展已失效，请刷新列表', false, 409)
      }
      const inspected = this.options.runner.inspectPackage(agent, target.pluginId, target.packageId)
      const sourceFingerprint = createHash('sha256').update(JSON.stringify({
        kind: 'cordis',
        sourceKey: target.sourceKey,
        pluginId: inspected.pluginId,
        packageId: inspected.packageId,
        code: {
          ...(inspected.code.host === undefined ? {} : { host: inspected.code.host.replace(/\r\n?/g, '\n') }),
          ...(inspected.code.client === undefined ? {} : { client: inspected.code.client.replace(/\r\n?/g, '\n') }),
        },
      })).digest('hex')
      return {
        input: preparedInput,
        sourceFingerprint,
        publishRoute: 'dynamic-cordis-v2',
        artifactContractVersion: 2,
        artifactKind: 'dsh-bundle-tgz',
      }
    }
    if (this.options.store.owner('profile', target.sourceKey) !== userId
      || this.options.store.specDigest('profile', target.sourceKey) !== target.specDigest) {
      throw new ArkmePluginError('extension-owner-mismatch', '该本地扩展不属于当前 Arkme 账号', false, 403)
    }
    const profileSource = readProfileTargetSource(target)
    const source = profileSource.source
    if (source.bundle.packageName !== target.packageName) {
      throw new ArkmePluginError('extension-profile-stale', '本地 Bundle package identity 已变化，请刷新列表', false, 409)
    }
    this.assertUpdatePackageIdentity(source.bundle.packageName, identity.packageName)
    if (source.bundle.version !== input.version) {
      throw new ArkmePluginError('extension-version-mismatch', '发布版本必须与 Bundle package.json.version 一致', false, 409)
    }
    return {
      input: preparedInput,
      sourceFingerprint: createHash('sha256')
        .update(`${source.bundle.bundleSha256}\0${source.source.sourceSha256}`)
        .digest('hex'),
      publishRoute: profileSource.artifactContractVersion === 2 ? 'profile-sandbox-v2' : 'profile-native-v3',
      artifactContractVersion: profileSource.artifactContractVersion,
      artifactKind: profileSource.artifactContractVersion === 2 ? 'dsh-bundle-tgz' : 'dsh-native-package-tgz',
      ...(profileSource.artifactContractVersion === 2
        ? {}
        : { nativeCapabilities: [...profileSource.source.bundle.nativeCapabilities] }),
    }
  }

  async publishCordis(input: ArkmeMyExtensionPublishInput & { signal?: AbortSignal }): Promise<ArkmeExtensionPublishResult> {
    return await this.publish(input)
  }

  async publishCordisPackage(input: Omit<ArkmeMyExtensionPublishInput, 'ownedRef'> & {
    agent: unknown
    pluginId: string
    packageId: string
    extensionId?: string
    signal?: AbortSignal
  }): Promise<ArkmeExtensionPublishResult> {
    const userId = await this.currentUserId()
    const agentId = (input.agent as { id?: unknown } | undefined)?.id
    if (typeof agentId !== 'string' || agentId.trim() === '') {
      throw new ArkmePluginError('extension-agent-unavailable', '该扩展操作必须在真实 DSH 会话中执行', false, 409)
    }
    const sourceKey = this.cordisSourceKey(agentId, input.pluginId)
    const owner = this.options.store.owner('cordis', sourceKey)
    if (owner === undefined) this.options.store.claim('cordis', sourceKey, userId)
    else if (owner !== userId) throw new ArkmePluginError('extension-owner-mismatch', '该 Cordis 扩展不属于当前 Arkme 账号', false, 403)
    return await this.publishTarget(userId, {
      sourceKey, agentId, pluginId: input.pluginId, packageId: input.packageId,
    }, input.agent, input)
  }

  private async publishTarget(
    userId: number,
    target: { sourceKey: string; agentId: string; pluginId: string; packageId: string },
    agent: unknown,
    input: Omit<ArkmeMyExtensionPublishInput, 'ownedRef'> & { extensionId?: string; signal?: AbortSignal },
  ): Promise<ArkmeExtensionPublishResult> {
    const live = this.options.runner.inventory?.().find(row => row.agentId === target.agentId && row.pluginId === target.pluginId)
    if (live === undefined || !live.packages.some(item => item.packageId === target.packageId)) {
      throw new ArkmePluginError('extension-cordis-stale', 'Cordis 扩展已失效，请刷新列表', false, 409)
    }
    const extensionId = this.publishExtensionId('cordis', target.sourceKey, userId, input.extensionId)
    const packageName = extensionId === undefined
      ? `@arkme-generated/${createHash('sha256').update(`${String(userId)}\0${target.sourceKey}`).digest('hex').slice(0, 24)}`
      : await this.ownedCloudPackageName(extensionId, input.signal)
    if (this.options.persistCordis !== undefined && this.options.publishSandboxBundle !== undefined) {
      const saved = await this.persistCordisTarget(userId, target, agent, input, packageName)
      let result: ArkmeExtensionPublishResult
      try {
        result = await this.options.publishSandboxBundle({
          source: saved.profile.source,
          ...(extensionId === undefined ? {} : { extensionId }),
          name: input.name,
          description: input.description,
          visibility: input.visibility,
          ...(input.changelog === undefined || input.changelog.trim() === '' ? {} : { changelog: input.changelog.trim() }),
		  ...(input.githubRepositoryUrl === undefined || input.githubRepositoryUrl.trim() === '' ? {} : { githubRepositoryUrl: input.githubRepositoryUrl.trim() }),
          idempotencyKey: createHash('sha256')
            .update(`my-extension-publish\0${String(userId)}\0${target.sourceKey}\0${input.version}\0${input.clientMutationId}`)
            .digest('hex'),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        })
      } catch (error) {
        throw new ArkmePluginError(
          'extension-publish-after-profile-save-failed',
          `插件已保存到 Profile，但市集发布失败：${error instanceof Error ? error.message : String(error)}`,
          error instanceof ArkmePluginError ? error.retryable : true,
          error instanceof ArkmePluginError ? error.httpStatus : 503,
          { cause: error },
        )
      }
      if (result.status === 'published') {
        this.linkPublishedTarget('cordis', target.sourceKey, userId, extensionId, result.extension_id)
        this.linkPublishedTarget('profile', saved.profileSourceKey, userId, extensionId, result.extension_id)
      }
      return result
    }
    const result = await this.options.publish({
      agent,
      pluginId: target.pluginId,
      packageId: target.packageId,
      packageName,
      ...(extensionId === undefined ? {} : { extensionId }),
      name: input.name,
      description: input.description,
      version: input.version,
      visibility: input.visibility,
      ...(input.changelog === undefined || input.changelog.trim() === '' ? {} : { changelog: input.changelog.trim() }),
		...(input.githubRepositoryUrl === undefined || input.githubRepositoryUrl.trim() === '' ? {} : { githubRepositoryUrl: input.githubRepositoryUrl.trim() }),
      idempotencyKey: createHash('sha256')
        .update(`my-extension-publish\0${String(userId)}\0${target.sourceKey}\0${input.version}\0${input.clientMutationId}`)
        .digest('hex'),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    if (result.status === 'published') {
      this.linkPublishedTarget('cordis', target.sourceKey, userId, extensionId, result.extension_id)
    }
    return result
  }

  private async publishProfileTarget(
    userId: number,
    target: Exclude<ArkmeOwnedExtensionTarget, { kind: 'cordis' }>,
    input: ArkmeMyExtensionPublishInput & { signal?: AbortSignal },
  ): Promise<ArkmeExtensionPublishResult> {
    if (this.options.store.owner('profile', target.sourceKey) !== userId
      || this.options.store.specDigest('profile', target.sourceKey) !== target.specDigest) {
      throw new ArkmePluginError('extension-owner-mismatch', '该本地扩展不属于当前 Arkme 账号', false, 403)
    }
    const profileSource = readProfileTargetSource(target)
    const source = profileSource.source
    if (source.bundle.packageName !== target.packageName) {
      throw new ArkmePluginError('extension-profile-stale', '本地 Bundle package identity 已变化，请刷新列表', false, 409)
    }
    if (source.bundle.version !== input.version) {
      throw new ArkmePluginError('extension-version-mismatch', '发布版本必须与 Bundle package.json.version 一致', false, 409)
    }
    const publishBundle = profileSource.artifactContractVersion === 2
      ? this.options.publishSandboxBundle
      : this.options.publishBundle
    if (publishBundle === undefined) {
      throw new ArkmePluginError('extension-bundle-publish-unavailable', '当前 Arkme 版本不支持发布本地 Bundle', false, 503)
    }
    const extensionId = this.publishExtensionId('profile', target.sourceKey, userId, input.extensionId)
    const packageName = extensionId === undefined
      ? undefined
      : await this.ownedCloudPackageName(extensionId, input.signal)
    this.assertUpdatePackageIdentity(source.bundle.packageName, packageName)
    const result = await publishBundle({
      source,
      ...(extensionId === undefined ? {} : { extensionId }),
      name: input.name,
      description: input.description,
      visibility: input.visibility,
      ...(input.changelog === undefined || input.changelog.trim() === '' ? {} : { changelog: input.changelog.trim() }),
		...(input.githubRepositoryUrl === undefined || input.githubRepositoryUrl.trim() === '' ? {} : { githubRepositoryUrl: input.githubRepositoryUrl.trim() }),
      idempotencyKey: createHash('sha256')
        .update(`my-extension-bundle-publish\0${String(userId)}\0${target.sourceKey}\0${input.version}\0${input.clientMutationId}`)
        .digest('hex'),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    if (result.status === 'published') {
      this.linkPublishedTarget('profile', target.sourceKey, userId, extensionId, result.extension_id)
    }
    return result
  }

  private async persistCordisTarget(
    userId: number,
    target: { sourceKey: string; agentId: string; pluginId: string; packageId: string },
    agent: unknown,
    input: Pick<ArkmeMyExtensionProfileSaveInput, 'name' | 'description' | 'version'>,
    resolvedPackageName?: string,
  ): Promise<{
    profile: Awaited<ReturnType<NonNullable<ArkmeOwnedExtensionInventoryOptions['persistCordis']>>>
    profileSourceKey: string
  }> {
    const live = this.options.runner.inventory?.().find(row => row.agentId === target.agentId && row.pluginId === target.pluginId)
    if (live === undefined || !live.packages.some(item => item.packageId === target.packageId)) {
      throw new ArkmePluginError('extension-cordis-stale', 'Cordis 扩展已失效，请刷新列表', false, 409)
    }
    if (this.options.persistCordis === undefined) {
      throw new ArkmePluginError('extension-profile-save-unavailable', '当前 Arkme 版本不支持保存插件到 Profile', false, 503)
    }
    const linkedExtensionId = this.options.store.cloudLink('cordis', target.sourceKey, userId)
    const packageName = resolvedPackageName ?? (linkedExtensionId === undefined
      ? `@arkme-generated/${createHash('sha256').update(`${String(userId)}\0${target.sourceKey}`).digest('hex').slice(0, 24)}`
      : await this.ownedCloudPackageName(linkedExtensionId))
    const profileSourceKey = `${this.options.profileName}\0${packageName}`
    const profileOwner = this.options.store.owner('profile', profileSourceKey)
    if (profileOwner !== undefined && profileOwner !== userId) {
      throw new ArkmePluginError('extension-owner-mismatch', '目标 Profile 插件已属于其他 Arkme 账号', false, 403)
    }
    const profile = await this.options.persistCordis({
      agent,
      pluginId: target.pluginId,
      packageId: target.packageId,
      packageName,
      name: input.name,
      description: input.description,
      version: input.version,
    })
    this.options.store.claim('profile', profileSourceKey, userId, profile.source.bundle.bundleSha256)
    this.options.store.linkProfile(target.sourceKey, profileSourceKey, userId)
    return { profile, profileSourceKey }
  }

  private async cloudItems(signal?: AbortSignal): Promise<ArkmeExtensionCatalogItem[]> {
    const items: ArkmeExtensionCatalogItem[] = []
    const cursors = new Set<string>()
    let cursor: string | undefined
    for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
      const page = await this.options.cloudList({ limit: 50, ...(cursor === undefined ? {} : { cursor }) }, signal)
      items.push(...page.items)
      if (page.next_cursor === undefined) return items
      if (cursors.has(page.next_cursor)) throw new Error('cloud extension cursor loop')
      cursors.add(page.next_cursor)
      cursor = page.next_cursor
    }
    throw new Error('cloud extension page limit exceeded')
  }

  private publishExtensionId(
    kind: 'cordis' | 'profile',
    sourceKey: string,
    userId: number,
    requestedExtensionId?: string,
  ): string | undefined {
    const requestedValue = requestedExtensionId?.trim()
    const requested = requestedValue === '' ? undefined : requestedValue
    if (requested !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(requested)) {
      throw new ArkmePluginError('extension-id-invalid', '已有扩展身份无效', false, 400)
    }
    const linked = this.options.store.cloudLink(kind, sourceKey, userId)
    if (requested !== undefined && linked !== undefined && requested !== linked) {
      throw new ArkmePluginError(
        'extension-lineage-mismatch',
        '该来源已绑定其他云端扩展，不能改绑；请刷新扩展列表后重试',
        false,
        409,
      )
    }
    return requested ?? linked
  }

  private async preparePublishIdentity(
    kind: 'cordis' | 'profile',
    sourceKey: string,
    userId: number,
    requestedExtensionId: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<ExistingPublishIdentity> {
    const extensionId = this.publishExtensionId(kind, sourceKey, userId, requestedExtensionId)
    if (extensionId === undefined) return {}
    return { extensionId, packageName: await this.ownedCloudPackageName(extensionId, signal) }
  }

  private async ownedCloudPackageName(extensionId: string, signal?: AbortSignal): Promise<string> {
    const owned = await this.cloudItems(signal)
    const item = owned.find(candidate => candidate.extension_id === extensionId)
    if (item === undefined) {
      throw new ArkmePluginError(
        'extension-target-not-owned',
        '目标云端扩展不属于当前 Arkme 账号，请刷新扩展列表后重试',
        false,
        403,
      )
    }
    const packageName = item.package_name?.trim()
    if (packageName === undefined || packageName === '') {
      throw new ArkmePluginError(
        'extension-package-identity-unavailable',
        '目标云端扩展缺少 package identity，不能安全发布新版本',
        false,
        409,
      )
    }
    return packageName
  }

  private assertUpdatePackageIdentity(actualPackageName: string, expectedPackageName?: string): void {
    if (expectedPackageName === undefined || actualPackageName === expectedPackageName) return
    throw new ArkmePluginError(
      'extension-package-identity-mismatch',
      `Bundle package.json.name 必须与已有扩展保持一致：${expectedPackageName}`,
      false,
      409,
    )
  }

  private linkPublishedTarget(
    kind: 'cordis' | 'profile',
    sourceKey: string,
    userId: number,
    expectedExtensionId: string | undefined,
    publishedExtensionId: string,
  ): void {
    if (expectedExtensionId !== undefined && publishedExtensionId !== expectedExtensionId) {
      throw new ArkmePluginError(
        'extension-publish-target-mismatch',
        '云端返回的扩展身份与确认目标不一致，本地未记录该发布结果',
        false,
        502,
      )
    }
    this.options.store.linkCloud(kind, sourceKey, userId, publishedExtensionId)
  }

  private project(userId: number, row: MutableOwnedItem): ArkmeMyExtensionItem {
    const states: ArkmeMyExtensionState[] = []
    if (row.cordis !== undefined) states.push('cordis')
    if (row.persisted !== undefined) states.push('persisted')
    if (row.published !== undefined) states.push('published')
	const target = row.published !== undefined
	  ? undefined
	  : row.cordis === undefined ? row.persisted?.target : {
          kind: 'cordis', sourceKey: row.cordis.sourceKey, agentId: row.cordis.row.agentId,
          pluginId: row.cordis.row.pluginId, packageId: row.cordis.packageId,
	    } satisfies ArkmeOwnedExtensionTarget
	const ownedRef = target === undefined
	  ? `owned_view_${createHash('sha256').update(`${String(userId)}\0${row.key}`).digest('hex').slice(0, 32)}`
	  : this.options.refs.issue(userId, target)
    return {
      ownedRef,
      name: row.name,
      description: row.description,
      states,
      halves: row.halves,
      ...(row.cordis === undefined ? {} : {
        cordis: { packageCount: row.cordis.row.packages.length, active: row.cordis.row.activeRun !== undefined },
      }),
      ...(row.persisted === undefined ? {} : {
        persisted: {
          packageName: row.persisted.packageName,
	          ...(row.persisted.version === undefined ? {} : { version: row.persisted.version }),
	          active: row.persisted.active,
	          ...(row.persisted.artifactContractVersion === undefined ? {} : { artifactContractVersion: row.persisted.artifactContractVersion }),
        },
      }),
      ...(row.published === undefined ? {} : {
        published: {
          extensionId: row.published.extension_id,
          ...(row.published.version === undefined && row.published.latest_stable_version === undefined
            ? {}
            : { version: row.published.version ?? row.published.latest_stable_version }),
          visibility: row.published.visibility,
          ...(row.published.icon_ref === undefined ? {} : { iconRef: row.published.icon_ref }),
          ...(row.published.preview_images === undefined ? {} : { previewImages: row.published.preview_images }),
          ...(row.published.preview_revision === undefined ? {} : { previewRevision: row.published.preview_revision }),
			...(row.published.source === undefined ? {} : { source: row.published.source }),
			...(row.published.share === undefined ? {} : { share: row.published.share }),
        },
      }),
	  publish: row.published !== undefined
	    ? { allowed: false, reason: '该扩展已发布' }
	    : target !== undefined
	      ? {
	          allowed: true,
	          mode: 'new',
	          ...publishContractForTarget(target),
	        }
	      : { allowed: false, reason: row.persisted?.publishReason ?? '当前没有可读取的发布源' },
    }
  }

  private async currentUserId(): Promise<number> {
    const state = await this.options.providerState()
    if (state.authStatus !== 'authenticated' || !Number.isSafeInteger(state.userId) || (state.userId ?? 0) <= 0) {
      throw new ArkmePluginError('login-required', '请先登录 Arkme', false, 401)
    }
    return state.userId!
  }

  private cordisSourceKey(agentId: string, pluginId: string): string {
    return `${this.options.hostInstanceId}\0${agentId}\0${pluginId}`
  }
}

function publishContractForTarget(target: ArkmeOwnedExtensionTarget): {
  route: ArkmeExtensionPublishRoute
  artifactContractVersion: 2 | 3
  artifactKind: ArkmeExtensionPublishArtifactKind
} {
  return target.kind === 'cordis'
    ? { route: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz' }
    : target.artifactContractVersion === 2
      ? { route: 'profile-sandbox-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz' }
      : { route: 'profile-native-v3', artifactContractVersion: 3, artifactKind: 'dsh-native-package-tgz' }
}

function readProfileTargetSource(target: Exclude<ArkmeOwnedExtensionTarget, { kind: 'cordis' }> ):
  | { artifactContractVersion: 2; source: ArkmeBundlePublishSource }
  | { artifactContractVersion: 3; source: ArkmeNativeBundlePublishSource } {
  if (target.artifactContractVersion === 2) {
    return {
      artifactContractVersion: 2,
      source: target.kind === 'profile-tarball'
        ? readLocalBundleTarball(target.sourcePath)
        : packLocalBundleDirectory(target.sourcePath),
    }
  }
  return {
    artifactContractVersion: 3,
    source: target.kind === 'profile-tarball'
      ? readNativeBundleTarballV3(target.sourcePath)
      : packLocalNativeBundleDirectoryV3(target.sourcePath),
  }
}

export function selectPublishPackage(input: Pick<DynamicCordisInventoryRowLike, 'packages' | 'currentPackageId'>): string | undefined {
  if (input.currentPackageId !== undefined && input.packages.some(item => item.packageId === input.currentPackageId)) {
    return input.currentPackageId
  }
  return input.packages.at(-1)?.packageId
}

function cordisItem(key: string, selected: DynamicCordisInventoryPackageLike): MutableOwnedItem {
  return {
    key,
    name: selected.name,
    description: selected.purpose,
    halves: { host: selected.hasHostHalf, client: selected.hasClientHalf },
  }
}

function mergeHalves(
  left: { host: boolean; client: boolean },
  right: { host: boolean; client: boolean },
): { host: boolean; client: boolean } {
  return { host: left.host || right.host, client: left.client || right.client }
}

function requiredExtensionId(value: string): string {
  const extensionId = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(extensionId)) {
    throw new ArkmePluginError('extension-id-invalid', 'extension_id无效', false, 400)
  }
  return extensionId
}
