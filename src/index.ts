import { homedir } from 'node:os'
import { readFileSync, realpathSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export { createOpenClawCliAdapter } from './openclaw/index.js'
import { createOpenClawCliAdapter, createOpenClawCommandRunner, createOpenClawFileSecretStore, createOpenClawProvisioner } from './openclaw/index.js'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { registerDSHAgentInputRecordSync } from './dsh-agent-input-sync.js'
import { createArkmeHostApi } from './host-api.js'
import { createOutgoingCallAssetHandler } from './outgoing-call-assets.js'
import { createArkmeMediaHandler, createArkmeUploadHandler } from './rich-media-routes.js'
import { createArkmeVoiceprintEnrollmentHandler } from './voiceprint-routes.js'
import { createArkmeSessionStore } from './keychain-store.js'
import { ArkmeLocalDatabase } from './local-database.js'
import {
  ArkmePluginUpdateManager,
  validatePluginUpdateArtifactOrigin,
  validatePluginUpdateServiceOrigin,
} from './plugin-update.js'
import { ArkmeRealtimeEvents } from './realtime-events.js'
import { ArkmeService } from './arkme-service.js'
import { ArkmeExtensionInstallStore } from './extensions/install-store.js'
import { ArkmeExtensionInstallTasks, type ArkmeAgentRegistryLike } from './extensions/install-tasks.js'
import { createArkmeExtensionIconReadHandler, createArkmeExtensionIconUploadHandler } from './extensions/icon-routes.js'
import { createArkmeExtensionPreviewReadHandler, createArkmeExtensionPreviewUploadHandler } from './extensions/preview-routes.js'
import { ArkmeExtensionManager } from './extensions/manager.js'
import { ExtensionPublishClient } from './extensions/publish-client.js'
import {
  ArkmeExtensionShareDiscoveryRelay,
  DEFAULT_EXTENSION_SHARE_DISCOVERY_PORT,
} from './extensions/share-discovery-relay.js'
import {
  ARKME_DESKTOP_MANAGED_RESTART_EXIT_CODE,
  ArkmeExtensionProfileInstaller,
} from './extensions/profile-installer.js'
import { ArkmeOwnedExtensionInventory } from './extensions/owned-inventory.js'
import { ArkmeOwnedExtensionRefs } from './extensions/owned-refs.js'
import { ArkmeOwnedExtensionStore } from './extensions/owned-store.js'
import type { DynamicCordisRunnerLike } from './extensions/types.js'
import { ArkmeStateStore } from './state-store.js'
import { registerArkmeExtensionTools } from './tools/extensions/index.js'
import { registerArkmeTools } from './tools/index.js'
import type { ArkmeToolProfile } from './tools/index.js'
import { ARKME_DEFAULT_SHARE_WEBSITE, type ArkmeEnvironment } from './types.js'

export interface Config {
  environment: ArkmeEnvironment
  authBaseUrl: string
  subjectBaseUrl: string
  recordBaseUrl: string
  dataBaseUrl: string
  chatBaseUrl: string
  botBaseUrl: string
  imBaseUrl: string
  webrtcBaseUrl: string
  worldBaseUrl: string
  relationBaseUrl: string
  intelligentBaseUrl: string
  audioBaseUrl: string
  extensionPublishBaseUrl: string
  extensionArtifactDirectory: string
  extensionTrustedSigningKeys: string
  extensionShareDiscoveryEnabled: boolean
  extensionShareDiscoveryPort: number
  routePath: string
  requestTimeoutMs: number
  maxTextLength: number
  toolProfile: ArkmeToolProfile
  relatedRecordingsEnabled: boolean
  geetestCaptchaId: string
  interwovenMomentsEnabled: boolean
  chatMemberJoinEventsEnabled: boolean
  richMediaRenderEnabled: boolean
  richMediaSendEnabled: boolean
  maxUploadBytes: number
  stateDirectory: string
  keychainServicePrefix: string
  allowNonLoopback: boolean
  allowProduction: boolean
  updateCheckEnabled: boolean
  updateChannel: 'stable' | 'next'
  updateServiceBaseUrl: string
  updateArtifactBaseUrl: string
  appVersion: string
  updateCheckIntervalHours: number
  updateAllowLocalInstall: boolean
  openclawProfile: string
  shareWebsite: string
}

export const ARKME_PRODUCTION_TRUSTED_SIGNING_KEYS = '{"prod-ed25519-20260819-1":"m1MKKU16hyu1b1KKIXMG+zKEr/GmhmvyUEreJzthTxs="}'
export const Config: Schema<Config> = Schema.object({
  environment: Schema.union(['test', 'prod']).default('test'),
  authBaseUrl: Schema.string().default('https://jotmo.senguo.me'),
  subjectBaseUrl: Schema.string().default('https://jotmo-subject.senguo.me'),
  recordBaseUrl: Schema.string().default('https://jotmo-record.senguo.me'),
  dataBaseUrl: Schema.string().default(''),
  chatBaseUrl: Schema.string().default('https://jotmo-chat.senguo.me'),
  botBaseUrl: Schema.string().default('https://jotmo-bot.senguo.me'),
  imBaseUrl: Schema.string().default('https://jotmo-im.senguo.me'),
  webrtcBaseUrl: Schema.string().default('https://jotmo-webrtc.senguo.me'),
  worldBaseUrl: Schema.string().default('https://jotmo-world.senguo.me'),
  relationBaseUrl: Schema.string().default('https://jotmo-relation.senguo.me'),
  intelligentBaseUrl: Schema.string().default('https://jotmo-intelligent.senguo.me'),
  audioBaseUrl: Schema.string().default('https://jotmo-audio.senguo.me'),
  extensionPublishBaseUrl: Schema.string().default(''),
  extensionArtifactDirectory: Schema.string().default(''),
  extensionTrustedSigningKeys: Schema.string().default(ARKME_PRODUCTION_TRUSTED_SIGNING_KEYS),
  extensionShareDiscoveryEnabled: Schema.boolean().default(true),
  extensionShareDiscoveryPort: Schema.number().min(1).max(65535).default(DEFAULT_EXTENSION_SHARE_DISCOVERY_PORT),
  routePath: Schema.string().default('/arkme-self/api'),
  requestTimeoutMs: Schema.number().min(1000).max(120000).default(30000),
  maxTextLength: Schema.number().min(1).max(100000).default(20000),
  toolProfile: Schema.union(['business', 'atomic', 'hybrid', 'disabled']).default('business'),
  relatedRecordingsEnabled: Schema.boolean().default(true),
  geetestCaptchaId: Schema.string().default('ec81315ab8b0f18a7bfa13602d01e307'),
  interwovenMomentsEnabled: Schema.boolean().default(true),
  chatMemberJoinEventsEnabled: Schema.boolean().default(true),
  stateDirectory: Schema.string().default(''),
  keychainServicePrefix: Schema.string().default('com.senqisi.dsh-arkme'),
  allowNonLoopback: Schema.boolean().default(false),
  allowProduction: Schema.boolean().default(false),
  updateCheckEnabled: Schema.boolean().default(true),
  updateChannel: Schema.union(['stable', 'next']).default('stable'),
  updateServiceBaseUrl: Schema.string().default('https://api.jotmo.cc'),
  updateArtifactBaseUrl: Schema.string().default(''),
  appVersion: Schema.string().default(''),
  updateCheckIntervalHours: Schema.number().min(1).max(168).default(12),
  updateAllowLocalInstall: Schema.boolean().default(true),
  richMediaRenderEnabled: Schema.boolean().default(true),
  richMediaSendEnabled: Schema.boolean().default(true),
  maxUploadBytes: Schema.number().min(1024).max(1024 * 1024 * 1024).default(100 * 1024 * 1024),
  openclawProfile: Schema.string().default('dev'),
  shareWebsite: Schema.string().default(ARKME_DEFAULT_SHARE_WEBSITE),
})

export const name = 'dsh-arkme'
export const inject = ['webServer', 'tools', 'systemPrompt', 'pluginInventory']

export function readDshRuntimeVersion(dshBinPath: string): string | undefined {
  if (dshBinPath.trim() === '') return undefined
  // A source checkout can carry an unreleased/stale package version while its
  // workspace code already implements the current DSH contract. Only a built
  // CLI entry is authoritative release metadata; source runs keep the existing
  // extension compatibility baseline owned by ArkmeExtensionManager.
  if (dshBinPath.endsWith('/src/bin.ts') || dshBinPath.endsWith('\\src\\bin.ts')) return undefined
  try {
    let resolvedBinPath = dshBinPath
    try { resolvedBinPath = realpathSync(dshBinPath) } catch { /* Preserve metadata-only probes. */ }
    const manifest = JSON.parse(readFileSync(join(dirname(resolvedBinPath), '..', 'package.json'), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)
      ? manifest.version
      : undefined
  } catch {
    return undefined
  }
}

export function resolveArkmeAppVersion(
  configuredAppVersion: string,
  environment: { ARKME_APP_VERSION?: string } = process.env,
): string | undefined {
  const configured = configuredAppVersion.trim()
  if (configured !== '') return configured
  const injected = environment.ARKME_APP_VERSION?.trim()
  return injected === undefined || injected === '' ? undefined : injected
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Headless Arkme data provider for trusted Host-side consumer plugins. */
    arkmeData: ArkmeService
  }
}

export function apply(ctx: Context, config: Config): void {
  config = resolveArkmeConfig(ctx, config)
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const dshBinPath = process.argv[1] ?? ''
  const dshRuntimeVersion = readDshRuntimeVersion(dshBinPath)
  const appVersion = resolveArkmeAppVersion(config.appVersion)
  const stateDirectory = config.stateDirectory.trim() || join(dshHome, 'arkme-self', config.environment)
  const stateStore = new ArkmeStateStore(stateDirectory)
  const localDatabase = new ArkmeLocalDatabase(stateDirectory, stateStore)
  const sessionStore = createArkmeSessionStore(`${config.keychainServicePrefix}.${config.environment}`)
  const pendingSessionStore = createArkmeSessionStore(`${config.keychainServicePrefix}.${config.environment}.pending-binding`)
  const service = new ArkmeService(config, sessionStore, localDatabase, fetch, pendingSessionStore)
  const openClawStateDirectory = join(stateDirectory, 'openclaw')
  const openClawCli = createOpenClawCliAdapter({
    profile: config.openclawProfile,
    run: createOpenClawCommandRunner({ timeoutMs: config.requestTimeoutMs }),
  })
  service.attachOpenClawProvisioner(createOpenClawProvisioner({
    cli: openClawCli,
    secretStore: createOpenClawFileSecretStore({ rootDir: join(openClawStateDirectory, 'secrets') }),
    workspaceRoot: join(openClawStateDirectory, 'workspaces'),
    isRuntimeOnline: async botRef => (await service.listBots()).items.some(bot => bot.botRef === botRef && bot.status === 'online'),
  }))
  const extensionDirectory = config.extensionArtifactDirectory.trim() || join(dshHome, 'arkme-self', 'extensions')
  const extensionStore = new ArkmeExtensionInstallStore(extensionDirectory)
  const updateManager = new ArkmePluginUpdateManager({
    enabled: config.updateCheckEnabled,
    channel: config.updateChannel,
    updateServiceBaseUrl: config.updateServiceBaseUrl,
    ...(config.updateArtifactBaseUrl.trim() === '' ? {} : { updateArtifactBaseUrl: config.updateArtifactBaseUrl }),
    ...(appVersion === undefined ? {} : { appVersion }),
    ...(dshRuntimeVersion === undefined ? {} : { dshVersion: dshRuntimeVersion }),
    intervalMs: config.updateCheckIntervalHours * 60 * 60_000,
    stateDirectory,
    logger: ctx.logger,
    installRuntime: {
      dshHome,
      profileName: 'web',
      healthUrl: `http://127.0.0.1:${String(ctx.webServer.port)}${config.routePath}`,
      allowLocalInstall: config.updateAllowLocalInstall,
      disabledProfilePackages: () => extensionStore.list().flatMap(item =>
        !item.enabled && item.profilePackageName !== undefined ? [item.profilePackageName] : []),
      ...(process.env.ARKME_DESKTOP_MANAGED_RESTART === '1'
        && process.env.ARKME_DESKTOP_MANAGED_RESTART_PLAN_PATH !== undefined
        ? {
            supervisedExitCode: ARKME_DESKTOP_MANAGED_RESTART_EXIT_CODE,
            supervisedPlanPath: process.env.ARKME_DESKTOP_MANAGED_RESTART_PLAN_PATH,
          }
        : {}),
    },
  })
  const extensionShareDiscovery = new ArkmeExtensionShareDiscoveryRelay({
    actualPort: ctx.webServer.port,
    discoveryPort: config.extensionShareDiscoveryPort ?? DEFAULT_EXTENSION_SHARE_DISCOVERY_PORT,
    enabled: config.extensionShareDiscoveryEnabled !== false,
    logger: ctx.logger,
  })
  const extensionProfileDirectory = join(dshHome, 'profiles', 'web')
  const extensionProfileInstaller = new ArkmeExtensionProfileInstaller({
    dshHome,
    profileName: 'web',
    execPath: process.execPath,
    dshBinPath,
    execArgv: process.execArgv,
    stateDirectory,
    healthUrl: `http://127.0.0.1:${String(ctx.webServer.port)}${config.routePath}`,
    restartArgv: [...process.execArgv, ...process.argv.slice(1)],
    helperPath: fileURLToPath(new URL('../lib/extension-profile-restart-helper.js', import.meta.url)),
    installStoreDirectory: extensionDirectory,
    ...(process.env.ARKME_DESKTOP_MANAGED_RESTART === '1'
      && process.env.ARKME_DESKTOP_MANAGED_RESTART_PLAN_PATH !== undefined
      ? {
          supervisedExitCode: ARKME_DESKTOP_MANAGED_RESTART_EXIT_CODE,
          supervisedPlanPath: process.env.ARKME_DESKTOP_MANAGED_RESTART_PLAN_PATH,
        }
      : {}),
  })
  const ownedExtensionStore = new ArkmeOwnedExtensionStore(extensionDirectory)
  const ownedExtensionRefs = new ArkmeOwnedExtensionRefs()
  const ownedExtensionHostInstanceId = randomUUID()
  const extensionClient = new ExtensionPublishClient(
    async <T>(path: string, body: Record<string, unknown>, signal?: AbortSignal) => await service.extensionPost<T>(path, body, signal),
    fetch,
    config.requestTimeoutMs,
  )
  let extensionManager: ArkmeExtensionManager | undefined
  let extensionInstallTasks: ArkmeExtensionInstallTasks | undefined
  let ownedExtensionInventory: ArkmeOwnedExtensionInventory | undefined
  ctx.provide('arkmeData', service)
  registerDSHAgentInputRecordSync(ctx, service)
  registerArkmeTools(ctx, service, config.toolProfile)
  ctx.inject(['dynamicCordisRunner', 'agents'], dynamicCtx => {
    const runner = (dynamicCtx as Context & { dynamicCordisRunner: DynamicCordisRunnerLike }).dynamicCordisRunner
    const agents = (dynamicCtx as Context & { agents: ArkmeAgentRegistryLike }).agents
    const manager = new ArkmeExtensionManager(
      extensionClient,
      extensionStore,
      runner,
      {
        artifactDirectory: extensionDirectory,
        trustedSigningKeys: config.extensionTrustedSigningKeys,
        profileDirectory: extensionProfileDirectory,
        profileInstaller: extensionProfileInstaller,
        clientApiPath: config.routePath,
        pluginInventory: ctx.get('pluginInventory') as import('./extensions/manager.js').ArkmePluginInventoryLike,
        ...(dshRuntimeVersion === undefined ? {} : { dshRuntimeVersion }),
      },
    )
    extensionManager = manager
    void manager.reconcileInstallationMetrics().catch(error => {
      ctx.logger.warn('Arkme extension startup reconciliation failed: %s', error instanceof Error ? error.message : String(error))
    })
    const inventory = new ArkmeOwnedExtensionInventory({
      hostInstanceId: ownedExtensionHostInstanceId,
      profileDirectory: extensionProfileDirectory,
      profileName: 'web',
      store: ownedExtensionStore,
      refs: ownedExtensionRefs,
      providerState: async () => await service.providerState(),
      cloudList: async (input, signal) => await extensionClient.myList(input, signal),
      runner,
      agents,
      publish: async input => await manager.publish(input),
      publishBundle: async input => await manager.publishNativeBundleSource(input),
      lifecycle: {
        deleteCloud: async (extensionId, signal) => await manager.delete(extensionId, signal),
        uninstall: async input => await manager.uninstall(input),
        canUninstallWithoutAgent: extensionId => manager.canUninstallWithoutAgent(extensionId),
        installedProfilePackageName: extensionId => manager.installedProfilePackageName(extensionId),
        removeProfilePackage: async packageName => await manager.removeOwnedProfilePackage(packageName),
      },
    })
    ownedExtensionInventory = inventory
    const tasks = new ArkmeExtensionInstallTasks(
      manager,
      agents,
    )
    extensionInstallTasks = tasks
    registerArkmeExtensionTools(dynamicCtx, manager, inventory, service, config.toolProfile)
    dynamicCtx.on('tools/result', (exec, result) => {
      if (exec.name !== 'cordis_define' || result.isError || exec.agent === undefined
        || result.value === null || typeof result.value !== 'object' || Array.isArray(result.value)) return
      const value = result.value as Record<string, unknown>
      if (typeof value.pluginId !== 'string' || value.pluginId.trim() === '') return
      void service.providerState().then(state => {
        if (state.authStatus === 'authenticated' && state.userId !== undefined) {
          inventory.captureCordisDefinition({ agentId: exec.agent!.id, pluginId: value.pluginId as string, creatorUserId: state.userId })
        }
      }).catch(() => { ctx.logger.warn('dsh-arkme: failed to bind Cordis extension ownership') })
    })
    dynamicCtx.effect(() => () => {
      if (extensionManager === manager) extensionManager = undefined
      if (extensionInstallTasks === tasks) extensionInstallTasks = undefined
      if (ownedExtensionInventory === inventory) ownedExtensionInventory = undefined
      tasks.dispose()
    }, 'dsh-arkme: marketplace dynamic runner bridge')
  })
  const handler = createArkmeHostApi(service, {
    expectedPort: ctx.webServer.port,
    allowNonLoopback: config.allowNonLoopback,
    updateManager,
    extensionManager: () => extensionManager,
    extensionInstallTasks: () => extensionInstallTasks,
    ownedExtensionInventory: () => ownedExtensionInventory,
  })
  const callAssetHandler = createOutgoingCallAssetHandler({ routePrefix: `${config.routePath}/call` })
  const richMediaOptions = {
    expectedPort: ctx.webServer.port,
    allowNonLoopback: config.allowNonLoopback,
    temporaryDirectory: join(stateDirectory, 'uploads'),
    maxUploadBytes: config.maxUploadBytes,
  }
  const uploadHandler = createArkmeUploadHandler(service, richMediaOptions)
  const mediaHandler = createArkmeMediaHandler(service, richMediaOptions)
  const voiceprintEnrollmentHandler = createArkmeVoiceprintEnrollmentHandler(service, {
    expectedPort: ctx.webServer.port,
    allowNonLoopback: config.allowNonLoopback,
  })
  const extensionIconOptions = {
    expectedPort: ctx.webServer.port,
    allowNonLoopback: config.allowNonLoopback,
    manager: () => extensionManager,
  }
  const extensionIconUploadHandler = createArkmeExtensionIconUploadHandler(extensionIconOptions)
  const extensionIconReadHandler = createArkmeExtensionIconReadHandler(extensionIconOptions)
  const extensionPreviewUploadHandler = createArkmeExtensionPreviewUploadHandler(extensionIconOptions)
  const extensionPreviewReadHandler = createArkmeExtensionPreviewReadHandler(extensionIconOptions)
  const realtimeEvents = new ArkmeRealtimeEvents(service, {
    expectedPort: ctx.webServer.port,
    allowNonLoopback: config.allowNonLoopback,
  })
  ctx.effect(() => () => {
    service.dispose()
    localDatabase.close()
    extensionStore.close()
    ownedExtensionStore.close()
  }, 'dsh-arkme: local cache database')
  ctx.effect(() => service.startChatRealtime(), 'dsh-arkme: Chat SSE receive runtime')
  ctx.effect(() => updateManager.start(), 'dsh-arkme: plugin update notification runtime')
  ctx.effect(async () => {
    await extensionShareDiscovery.start()
    return async () => { await extensionShareDiscovery.dispose() }
  }, 'dsh-arkme: extension share discovery relay')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: config.routePath,
    handler,
  }), 'dsh-arkme: local BFF route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: `${config.routePath}/call`,
    handler: callAssetHandler,
  }), 'dsh-arkme: outgoing call assets')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${config.routePath}/upload`,
    handler: uploadHandler,
  }), 'dsh-arkme: rich content upload route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${config.routePath}/media`,
    handler: mediaHandler,
  }), 'dsh-arkme: rich content media route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${config.routePath}/voiceprint/enroll`,
    handler: voiceprintEnrollmentHandler,
  }), 'dsh-arkme: voiceprint enrollment route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${config.routePath}/extension-icon/upload`,
    handler: extensionIconUploadHandler,
  }), 'dsh-arkme: extension icon upload route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${config.routePath}/extension-icon`,
    handler: extensionIconReadHandler,
  }), 'dsh-arkme: extension icon read route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${config.routePath}/extension-preview/upload`,
    handler: extensionPreviewUploadHandler,
  }), 'dsh-arkme: extension preview upload route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${config.routePath}/extension-preview`,
    handler: extensionPreviewReadHandler,
  }), 'dsh-arkme: extension preview read route')
  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'exact',
      path: `${config.routePath}/events`,
      handler: realtimeEvents.handler,
    })
    return () => {
      disposeRoute()
      realtimeEvents.close()
    }
  }, 'dsh-arkme: local realtime events route')
  ctx.logger.info('dsh-arkme: mounted %s for %s environment', config.routePath, config.environment)
}

export function resolveArkmeConfig(ctx: Context, config: Config): Config {
  const resolved = config.dataBaseUrl.trim() === ''
    ? {
        ...config,
        dataBaseUrl: config.environment === 'prod'
          ? 'https://data.jotmo.cc'
          : 'https://jotmo-data.senguo.me',
      }
    : config
  validateConfig(ctx, resolved)
  return resolved
}

function validateConfig(ctx: Context, config: Config): void {
  if (config.environment === 'prod' && !config.allowProduction) {
    throw new Error('dsh-arkme: production environment requires allowProduction: true')
  }
  if (config.environment === 'prod') {
    const testDefaults = [
      config.authBaseUrl,
      config.recordBaseUrl,
      config.dataBaseUrl,
      config.chatBaseUrl,
      config.botBaseUrl,
      config.imBaseUrl,
      config.webrtcBaseUrl,
      config.worldBaseUrl,
      config.relationBaseUrl,
      config.intelligentBaseUrl,
      config.audioBaseUrl,
    ].filter(origin => new URL(origin).hostname.endsWith('.senguo.me'))
    if (testDefaults.length > 0) {
      throw new Error('dsh-arkme: production environment must explicitly configure every service origin')
    }
  }
  if (!config.allowNonLoopback && ctx.webServer.host !== '127.0.0.1') {
    throw new Error('dsh-arkme: Web UI must bind 127.0.0.1 unless allowNonLoopback is true')
  }
  if (!/^\/[A-Za-z0-9/_-]+$/.test(config.routePath) || config.routePath.endsWith('/')) {
    throw new Error('dsh-arkme: routePath must be an absolute path without a trailing slash')
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(config.geetestCaptchaId)) {
    throw new Error('dsh-arkme: geetestCaptchaId is invalid')
  }
  validatePluginUpdateServiceOrigin(config.updateServiceBaseUrl)
  if (config.updateArtifactBaseUrl.trim() !== '') validatePluginUpdateArtifactOrigin(config.updateArtifactBaseUrl)
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(config.openclawProfile)) {
    throw new Error('dsh-arkme: openclawProfile must be a fixed profile name')
  }
  for (const [label, raw] of [
    ['authBaseUrl', config.authBaseUrl],
    ['subjectBaseUrl', config.subjectBaseUrl],
    ['recordBaseUrl', config.recordBaseUrl],
    ['dataBaseUrl', config.dataBaseUrl],
    ['chatBaseUrl', config.chatBaseUrl],
    ['botBaseUrl', config.botBaseUrl],
    ['imBaseUrl', config.imBaseUrl],
    ['webrtcBaseUrl', config.webrtcBaseUrl],
    ['worldBaseUrl', config.worldBaseUrl],
    ['relationBaseUrl', config.relationBaseUrl],
    ['intelligentBaseUrl', config.intelligentBaseUrl],
    ['audioBaseUrl', config.audioBaseUrl],
    ['shareWebsite', config.shareWebsite],
  ] as const) {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.pathname !== '/') {
      throw new Error(`dsh-arkme: ${label} must be an HTTPS origin without credentials or path`)
    }
  }
  if (config.extensionPublishBaseUrl.trim() !== '') {
    const url = new URL(config.extensionPublishBaseUrl)
    const localHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
    if ((!localHttp && url.protocol !== 'https:') || url.username !== '' || url.password !== '' || url.pathname !== '/') {
      throw new Error('dsh-arkme: extensionPublishBaseUrl must be an HTTPS origin or loopback HTTP origin without credentials or path')
    }
  }
}

export type {
  ArkmeAiVideoJob,
  ArkmeAiVideoListItem,
  ArkmeAiVideoListResult,
  ArkmeAiVideoJobStatus,
  ArkmeAiVideoPreflightResult,
  ArkmeAiVideoSegmentSelector,
  ArkmeAiVideoTranscriptSource,
  ArkmeAuthSnapshot,
  ArkmeCachedQueryResult,
  ArkmeCachedSnapshot,
  ArkmeChatRealtimeState,
  ArkmeConversationWriteResult,
  ArkmeCreateTextResult,
  ArkmeDirectTextSendResult,
  ArkmeGroupAvatarFallback,
  ArkmeGroupAvatarPresentation,
  ArkmeGroupAvatarSlot,
  ArkmeIdAvailabilityReason,
  ArkmeIdAvailabilitySnapshot,
  ArkmeIdMutationResult,
  ArkmePendingWrite,
  ArkmeRelatedRecordingEligibility,
  ArkmeRelatedRecordingItem,
  ArkmeRelatedRecordingMonthBucket,
  ArkmeRelatedRecordingPage,
  ArkmeRelatedRecordingPageOptions,
  ArkmeRelatedRecordingPageState,
  ArkmeRelatedRecordingParticipant,
  ArkmeRelatedRecordingSpeaker,
  ArkmeContentBlock,
  ArkmeContentKind,
  ArkmeRichSendInput,
  ArkmeImageMediaType,
  ArkmeImagePayload,
  ArkmeFileAssetDisplayItem,
  ArkmeRecordSearchResult,
  ArkmeRecordingSearchItem,
  ArkmeRecordingSearchResult,
  ArkmeSearchQueryGuard,
  ArkmeSearchRecordItem,
  ArkmeSearchSceneKind,
  ArkmeSearchSourceAggregate,
  ArkmeSourceDirectory,
  ArkmeSourceItem,
  ArkmeSourceKind,
  ArkmeSourceList,
  ArkmeSourceReadResult,
  ArkmeSourceSendResult,
  ArkmeTimelineCursor,
  ArkmeTimelineItem,
  ArkmeForwardRecordsPreview,
  ArkmeForwardRecordPreviewItem,
  ArkmeForwardTranscriptSegment,
  ArkmeTimelinePage,
  ArkmeUploadedAsset,
  ArkmeRecordCursor,
  ArkmeSelfRecordItem,
  ArkmeSelfRecordList,
  ArkmeSelfSummary,
  ArkmeCallDetail,
  ArkmeCallHistoryItem,
  ArkmeCallHistoryOptions,
  ArkmeCallHistoryPage,
  ArkmeCallMediaType,
  ArkmeCallParticipant,
  ArkmeCallRecentContact,
  ArkmeCallSummaryRetryResult,
  ArkmeCallSummaryStatus,
  ArkmeCallTranscriptSegment,
  ArkmeProviderCapabilities,
  ArkmeProviderState,
  ArkmePluginUpdateAvailability,
  ArkmePluginUpdateLevel,
  ArkmePluginUpdateNotice,
  ArkmePluginUpdateStatus,
  ArkmeUserProfile,
  ArkmeUserProfileSnapshot,
  ArkmeWorldPublishFileAsset,
  ArkmeWorldPublishFileAssetsInput,
  ArkmeWorldPublishResult,
  ArkmeWorldPublishTextInput,
  ArkmeWorldFeedItem,
  ArkmeWorldFeedPage,
  ArkmeWorldVoiceprintAvailability,
  ArkmeWorldVoiceprintAvailabilityItem,
  ArkmeWorldVoiceprintPlaybackChunk,
  ArkmeWorldRecordItem,
  ArkmeWorldRecordList,
  ArkmeWorldVisibility,
  ArkmeWechatCallFilter,
  ArkmeWechatCommonGroupFriend,
  ArkmeWechatCommonGroupPage,
  ArkmeWechatConversation,
  ArkmeWechatConversationDetail,
  ArkmeWechatConversationPage,
  ArkmeWechatGroupMember,
  ArkmeWechatGroupMemberPage,
  ArkmeWechatLocation,
  ArkmeWechatLocationPage,
  ArkmeWechatMessage,
  ArkmeWechatMessageFilter,
  ArkmeWechatMessagePage,
  ArkmeWechatMoneyFlow,
  ArkmeWechatMoneyFlowPage,
  ArkmeWechatPhone,
  ArkmeWechatPhoneEvidence,
  ArkmeWechatPhonePage,
} from './types.js'
export {
  ARKME_PROVIDER_CONTRACT_VERSION,
  ARKME_WORLD_PUBLISH_MAX_IMAGE_BYTES,
  ARKME_WORLD_PUBLISH_MAX_IMAGES,
} from './types.js'
export type {
  ArkmeExtensionRatingSummary,
  ArkmeExtensionReviewAvatarFallback,
  ArkmeExtensionReviewCreateInput,
  ArkmeExtensionReviewCreateResult,
  ArkmeExtensionReviewItem,
  ArkmeExtensionReviewPage,
	ArkmeSharedExtensionDetail,
	ArkmeSharedExtensionPreview,
} from './extensions/types.js'
export type {
  ArkmeOutgoingCallFailureCode,
  ArkmeOutgoingCallIntentClaim,
  ArkmeOutgoingCallIntentResolutionInput,
  ArkmeOutgoingCallMediaType,
  ArkmeOutgoingCallPrepareResult,
  ArkmeOutgoingCallToolResult,
} from './outgoing-call-contract.js'
export { ArkmeOutgoingCallError } from './outgoing-call-contract.js'
export { ArkmeService } from './arkme-service.js'
