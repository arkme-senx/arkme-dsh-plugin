import { createHash } from 'node:crypto'
import { ArkmePluginError } from '../arkme-service.js'
import type { ArkmeExtensionCatalogItem, ArkmeExtensionCatalogPage, ArkmeExtensionPublishResult,
  ArkmeExtensionVisibility, DynamicCordisInventoryPackageLike, DynamicCordisInventoryRowLike,
  DynamicCordisRunnerLike,
} from './types.js'
import type { ArkmeMyExtensionItem, ArkmeMyExtensionPage, ArkmeMyExtensionPublishInput,
  ArkmeMyExtensionState, ArkmeMyExtensionWarning,
} from './owned-types.js'
import type { ArkmeOwnedExtensionRefs } from './owned-refs.js'
import type { ArkmeOwnedExtensionStore } from './owned-store.js'
import { scanOwnedProfileExtensions } from './profile-owned-inventory.js'
import { packLocalBundleDirectory, readLocalBundleTarball, type ArkmeBundlePublishSource } from './bundle-artifact.js'
import type { ArkmeOwnedExtensionTarget } from './owned-refs.js'

interface MutableOwnedItem {
  key: string
  name: string
  description: string
  halves: { host: boolean; client: boolean }
  cordis?: { row: DynamicCordisInventoryRowLike; packageId: string; sourceKey: string }
  persisted?: { packageName: string; version?: string; active: boolean; publishable: boolean; publishReason?: string; target?: ArkmeOwnedExtensionTarget }
  published?: ArkmeExtensionCatalogItem
}

interface AgentRegistryLike {
  get(sessionId: string): unknown
}

interface ProviderStateLike {
  authStatus: string
  userId?: number
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
  idempotencyKey: string
  signal?: AbortSignal
}

interface PublishBundleInput {
  source: ArkmeBundlePublishSource
  extensionId?: string
  name: string
  description: string
  visibility: ArkmeExtensionVisibility
  changelog?: string
  idempotencyKey: string
  signal?: AbortSignal
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
  publishBundle?(input: PublishBundleInput): Promise<ArkmeExtensionPublishResult>
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
	    ...(local.target === undefined ? {} : { target: local.target }),
      }
      row.halves = mergeHalves(row.halves, local.halves)
      rows.set(key, row)
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
      const key = cloudId === undefined ? `cordis:${sourceKey}` : `cloud:${cloudId}`
      const row = rows.get(key) ?? cordisItem(key, selected)
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
    const extensionId = input.extensionId?.trim() || this.options.store.cloudLink('cordis', target.sourceKey, userId)
    const result = await this.options.publish({
      agent,
      pluginId: target.pluginId,
      packageId: target.packageId,
      packageName: `@arkme-generated/${createHash('sha256').update(`${String(userId)}\0${target.sourceKey}`).digest('hex').slice(0, 24)}`,
      ...(extensionId === undefined ? {} : { extensionId }),
      name: input.name,
      description: input.description,
      version: input.version,
      visibility: input.visibility,
      ...(input.changelog === undefined || input.changelog.trim() === '' ? {} : { changelog: input.changelog.trim() }),
      idempotencyKey: createHash('sha256')
        .update(`my-extension-publish\0${String(userId)}\0${target.sourceKey}\0${input.version}\0${input.clientMutationId}`)
        .digest('hex'),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    if (result.status === 'published') this.options.store.linkCloud('cordis', target.sourceKey, userId, result.extension_id)
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
    const source = target.kind === 'profile-directory'
      ? packLocalBundleDirectory(target.sourcePath)
      : readLocalBundleTarball(target.sourcePath)
    if (source.bundle.packageName !== target.packageName) {
      throw new ArkmePluginError('extension-profile-stale', '本地 Bundle package identity 已变化，请刷新列表', false, 409)
    }
    if (source.bundle.version !== input.version) {
      throw new ArkmePluginError('extension-version-mismatch', '发布版本必须与 Bundle package.json.version 一致', false, 409)
    }
    if (this.options.publishBundle === undefined) {
      throw new ArkmePluginError('extension-bundle-publish-unavailable', '当前 Arkme 版本不支持发布本地 Bundle', false, 503)
    }
    const extensionId = this.options.store.cloudLink('profile', target.sourceKey, userId)
    const result = await this.options.publishBundle({
      source,
      ...(extensionId === undefined ? {} : { extensionId }),
      name: input.name,
      description: input.description,
      visibility: input.visibility,
      ...(input.changelog === undefined || input.changelog.trim() === '' ? {} : { changelog: input.changelog.trim() }),
      idempotencyKey: createHash('sha256')
        .update(`my-extension-bundle-publish\0${String(userId)}\0${target.sourceKey}\0${input.version}\0${input.clientMutationId}`)
        .digest('hex'),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    if (result.status === 'published') this.options.store.linkCloud('profile', target.sourceKey, userId, result.extension_id)
    return result
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
        },
      }),
      ...(row.published === undefined ? {} : {
        published: {
          extensionId: row.published.extension_id,
          ...(row.published.version === undefined && row.published.latest_stable_version === undefined
            ? {}
            : { version: row.published.version ?? row.published.latest_stable_version }),
          visibility: row.published.visibility,
        },
      }),
	  publish: row.published !== undefined
	    ? { allowed: false, reason: '该扩展已发布' }
	    : target !== undefined
	      ? { allowed: true, mode: 'new' }
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
