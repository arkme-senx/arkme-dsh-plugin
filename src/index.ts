import { homedir } from 'node:os'
import { readFileSync, realpathSync } from 'node:fs'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import Schema from '@deepseek-ai/schemastery'

export { createOpenClawCliAdapter } from './openclaw/index.js'
import { createOpenClawCliAdapter, createOpenClawCommandRunner, createOpenClawFileSecretStore, createOpenClawProvisioner } from './openclaw/index.js'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { registerDSHAgentInputRecordSync } from './dsh-agent-input-sync.js'
import { createArkmeHostApi } from './host-api.js'
import { openDshHostPath } from './dsh-host-capabilities.js'
import { ARKME_HARNESS_EMBED_PATH } from './harness-embed-contract.js'
import {
  createHarnessEmbedRouteHandler,
  dshRootDocumentHeaders,
  type DshWebBootGraph,
} from './harness-embed-route.js'
import { createOutgoingCallAssetHandler } from './outgoing-call-assets.js'
import { createArkmeMediaHandler, createArkmeUploadHandler, createArkmeLocalFileHandler } from './rich-media-routes.js'
import { createArkmeRecordingImportHandler, scavengeRecordingImportTemporaryFiles } from './recording-import-routes.js'
import { createArkmeVoiceprintEnrollmentHandler } from './voiceprint-routes.js'
import { createArkmeSecureValueStore, createArkmeSessionStore } from './keychain-store.js'
import { HttpManagedOpenApiControlPlane } from './openapi-mcp/control-plane.js'
import { ManagedOpenApiMcpController } from './openapi-mcp/controller.js'
import { SecureManagedOpenApiCredentialStore } from './openapi-mcp/credential-store.js'
import { registerManagedOpenApiMcpExecutionFence } from './openapi-mcp/execution-fence.js'
import { HttpOpenApiMcpManifestSource } from './openapi-mcp/manifest-source.js'
import { CordisOpenApiMcpRuntime } from './openapi-mcp/mcp-runtime.js'
import { HttpOpenApiCapabilityGateway } from './openapi-capability-gateway.js'
import { TeamService } from './services/team-service.js'
import { FileOpenApiMcpReconcileLock, managedOpenApiMcpReconcileLockPath } from './openapi-mcp/reconcile-lock.js'
import { ObservedArkmeSessionStore } from './openapi-mcp/session-observer.js'
import { registerOpenApiMcpLifecycleTools } from './openapi-mcp/status-tool.js'
import { ArkmeLocalDatabase } from './local-database.js'
import { registerManagedAiProvider } from './managed-ai/adapter.js'
import {
  ArkmePluginUpdateManager,
  validatePluginUpdateArtifactOrigin,
  validatePluginUpdateServiceOrigin,
} from './plugin-update.js'
import { ArkmeRealtimeEvents } from './realtime-events.js'
import { ArkmeService } from './arkme-service.js'
import { ArkmeExtensionInstallStore } from './extensions/install-store.js'
import { ArkmeDesktopExtensionQuarantine } from './extensions/desktop-quarantine.js'
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
import { DshApiProxyAdapter, type DshPublicApiProxyLike } from './dsh-remote/api-proxy-adapter.js'
import { DshRemoteCommandLedger } from './dsh-remote/command-ledger.js'
import { DshRemoteHttpControlPlane } from './dsh-remote/control-plane.js'
import { createDefaultDshRemoteSocket } from './dsh-remote/default-socket-factory.js'
import { ArkmeRemoteRealtimeHost, type DshRemoteSessionPersistenceLike } from './dsh-remote/host.js'
import { ArkmeRemoteRealtimeTransport, type DshRemoteSocketLike } from './dsh-remote/realtime-transport.js'
import { DshRemoteRuntimeStore } from './dsh-remote/runtime-store.js'
import { DshRemoteRuntimeSecretBroker } from './dsh-remote/runtime-secret-broker.js'
import { DshRemoteSessionOwnershipStore } from './dsh-remote/session-ownership-store.js'
import { DshRemoteTurnUploadOutbox } from './dsh-remote/turn-upload-outbox.js'
import type { DshRemoteHostFacade } from './dsh-remote/types.js'

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
  openApiBaseUrl: string
  openApiMcpEnabled: boolean
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
  recordingWorkbenchEnabled: boolean
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
  dshRemoteFeatureEnabled: boolean
  dshRemoteRealtimeBaseUrl: string
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
  openApiBaseUrl: Schema.string().default(''),
  openApiMcpEnabled: Schema.boolean().default(true),
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
  recordingWorkbenchEnabled: Schema.boolean().default(true),
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
  dshRemoteFeatureEnabled: Schema.boolean().default(false),
  dshRemoteRealtimeBaseUrl: Schema.string().default(''),
})

export const name = 'dsh-arkme'
export const inject = ['webServer', 'tools', 'systemPrompt', 'pluginInventory', 'clientModules']

interface DshClientModulesLike {
  graph(): DshWebBootGraph
}

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

export function resolvePluginUpdateEnabled(
  configured: boolean,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return configured && environment.ARKME_RUNTIME_MANAGED !== '1'
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Headless Arkme data provider for trusted Host-side consumer plugins. */
    arkmeData: ArkmeService
    /** Public DSH gateway detected at runtime; only the remote allowlist is consumed. */
    apiProxy: DshPublicApiProxyLike
    /** Optional Host-owned authenticated Realtime socket carrier. */
    arkmeRemoteSocketFactory: ArkmeRemoteAuthenticatedSocketFactory
  }
}

export type ArkmeRemoteAuthenticatedSocketFactory = (input: {
  profileRef: string
  clientRef: string
  accessToken: string
  signal: AbortSignal
}) => DshRemoteSocketLike | Promise<DshRemoteSocketLike>

function dshRemoteClientId(accessToken: string): number | undefined {
  const parts = accessToken.split('.')
  if (parts.length !== 3) return undefined
  try {
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>
    const clientId = claims.client_id ?? claims.clientId
    return typeof clientId === 'number' && Number.isSafeInteger(clientId) && clientId > 0 ? clientId : undefined
  } catch { return undefined }
}

export function resolveDshRemoteProfileRef(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const value = env.ARKME_DSH_RUNTIME_SCOPE_REF?.trim() || env.DSH_PROFILE?.trim() || 'web'
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : 'web'
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
  const rawSessionStore = createArkmeSessionStore(`${config.keychainServicePrefix}.${config.environment}`)
  const sessionStore = new ObservedArkmeSessionStore(rawSessionStore)
  const pendingSessionStore = createArkmeSessionStore(`${config.keychainServicePrefix}.${config.environment}.pending-binding`)
  const service = new ArkmeService({ ...config, fileStateDirectory: join(stateDirectory, 'files') }, sessionStore, localDatabase, fetch, pendingSessionStore)
  const openApiMcpCredentialNamespace = `${config.keychainServicePrefix}.${config.environment}.openapi-mcp`
  const openApiMcpController = new ManagedOpenApiMcpController({
    mountMcp: config.openApiMcpEnabled,
    sessionStore,
    accessCredentialProvider: service,
    controlPlane: new HttpManagedOpenApiControlPlane(config.openApiBaseUrl, fetch, config.requestTimeoutMs),
    manifestSource: new HttpOpenApiMcpManifestSource(config.openApiBaseUrl, fetch, config.requestTimeoutMs),
    credentialStore: new SecureManagedOpenApiCredentialStore(createArkmeSecureValueStore(openApiMcpCredentialNamespace)),
    runtime: new CordisOpenApiMcpRuntime(ctx, config.openApiBaseUrl, config.requestTimeoutMs),
    reconcileLock: new FileOpenApiMcpReconcileLock(managedOpenApiMcpReconcileLockPath(openApiMcpCredentialNamespace)),
    logger: ctx.logger,
  })
  const teamService = new TeamService(
    new HttpOpenApiCapabilityGateway(config.openApiBaseUrl, openApiMcpController, fetch),
  )
  sessionStore.attach(openApiMcpController)
  ctx.effect(
    () => ctx.tools.guard(execution => openApiMcpController.guardToolExecution(execution.name)),
    'dsh-arkme: managed OpenAPI MCP account guard',
  )
  ctx.effect(
    () => registerManagedOpenApiMcpExecutionFence(ctx, openApiMcpController),
    'dsh-arkme: managed OpenAPI MCP execution fence',
  )
  service.attachLocalFileOpener(async (path, signal) => {
    await openDshHostPath(ctx, path, signal)
  })
  let remoteHost: DshRemoteHostFacade | undefined
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
  const clientModules = (ctx as Context & { clientModules: DshClientModulesLike }).clientModules
  const updateManager = new ArkmePluginUpdateManager({
    enabled: resolvePluginUpdateEnabled(config.updateCheckEnabled),
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
            ...(process.env.ARKME_HARNESS_LOG_PATH === undefined
              ? {}
              : { harnessLogPath: process.env.ARKME_HARNESS_LOG_PATH }),
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
          ...(process.env.ARKME_RUNTIME_RELEASE_ID === undefined
            ? {}
            : { runtimeReleaseId: process.env.ARKME_RUNTIME_RELEASE_ID }),
        }
      : {}),
  })
  const pluginInventory = ctx.get('pluginInventory') as import('./extensions/manager.js').ArkmePluginInventoryLike
  const desktopQuarantine = new ArkmeDesktopExtensionQuarantine({
    dshHome,
    environment: config.environment,
    installStore: extensionStore,
    setProfileEnabled: async (packageName, enabled) => {
      await extensionProfileInstaller.setEnabled(packageName, enabled)
    },
    requestRestart: async ({ packageName }) => {
      await extensionProfileInstaller.restartDesktopQuarantine({ packageName })
    },
    isPackageActive: packageName => pluginInventory.list().entries.some(entry =>
      entry.moduleName === packageName && entry.enabled && entry.fiberPhase === 'active'),
  })
  void desktopQuarantine.reconcile().catch(error => {
    ctx.logger.warn('Arkme desktop extension quarantine reconciliation failed: %s', error instanceof Error ? error.message : String(error))
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
  ctx.effect(async () => {
    await service.accountScope.start()
    return () => undefined
  }, 'dsh-arkme: desktop account scope attestation')
  ctx.inject(['llm'], modelCtx => {
    registerManagedAiProvider(modelCtx, {
      intelligentBaseUrl: config.intelligentBaseUrl,
      credentialOwner: service,
    })
  })
  registerDSHAgentInputRecordSync(ctx, service)
  registerArkmeTools(ctx, service, config.toolProfile)
  if (config.openApiMcpEnabled) registerOpenApiMcpLifecycleTools(ctx, openApiMcpController)
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
        pluginInventory,
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
  ctx.inject(['apiProxy'], apiCtx => {
    const agentDefaultModel = apiCtx.get('agentDefaultModel') as {
      currentSelection?: () => unknown
    } | undefined
    const sessionPersistence = apiCtx.get('sessionPersistence') as DshRemoteSessionPersistenceLike | undefined
    const apiProxy = new DshApiProxyAdapter(
      apiCtx.apiProxy as unknown as DshPublicApiProxyLike,
      {
        ...(typeof agentDefaultModel?.currentSelection !== 'function'
          ? {}
          : { defaultModelSelection: () => agentDefaultModel.currentSelection!() }),
      },
    )
    service.accountScope.attachGuestConversationProbe(async () => {
      try {
        let cursor: string | undefined
        for (let page = 0; page < 200; page += 1) {
          const sessions = await apiProxy.sessions({ limit: 50, ...(cursor === undefined ? {} : { cursor }) })
          if (sessions.items.some(session => !session.blank)) return true
          if (sessions.nextCursor === undefined) return false
          cursor = sessions.nextCursor
        }
      } catch { /* An unreadable guest profile is claimed whole rather than silently discarded. */ }
      return true
    })
    // The default-off feature must not construct platform credential stores,
    // open DSH muxes or otherwise affect the existing Arkme plugin lifecycle.
    if (!config.dshRemoteFeatureEnabled) return
    const injectedSocketFactory = apiCtx.get('arkmeRemoteSocketFactory') as ArkmeRemoteAuthenticatedSocketFactory | undefined
    const authenticatedSocketFactory: ArkmeRemoteAuthenticatedSocketFactory = injectedSocketFactory
      ?? (input => createDefaultDshRemoteSocket({
        realtimeBaseUrl: config.dshRemoteRealtimeBaseUrl,
        accessToken: input.accessToken,
        signal: input.signal,
      }))
    const profileRef = resolveDshRemoteProfileRef()
    const hostClientRef = `host_${createHash('sha256').update(`dsh-remote-host-client-v1\n${stateDirectory}\n${profileRef}`).digest('base64url')}`
    const realtime = new ArkmeRemoteRealtimeTransport(async input => {
      const session = await service.accountScope.scopedSession()
      if (session === undefined) throw new Error('Arkme session is unavailable')
      return await authenticatedSocketFactory({ ...input, accessToken: session.accessToken })
    })
    const secretBroker = new DshRemoteRuntimeSecretBroker(createArkmeSecureValueStore(
      `${config.keychainServicePrefix}.${config.environment}.dsh-remote-desktop`,
    ))
    const controlPlane = new DshRemoteHttpControlPlane({
      post: async (path, body, signal) => await service.dshRemotePost<Record<string, unknown>>(path, body, signal),
    })
    const host = new ArkmeRemoteRealtimeHost({
      featureEnabled: config.dshRemoteFeatureEnabled,
      transportAvailable: true,
      profileRef, hostClientRef, secretBroker,
      runtimeStore: new DshRemoteRuntimeStore(stateDirectory),
      sessionOwnership: new DshRemoteSessionOwnershipStore(stateDirectory, profileRef),
      controlPlane,
      realtime, apiProxy,
      ...(sessionPersistence === undefined ? {} : { sessionPersistence }),
      readSession: async () => {
        const session = await service.accountScope.scopedSession()
        if (session === undefined) return undefined
        const clientId = dshRemoteClientId(session.accessToken)
        return clientId === undefined ? undefined : { userId: session.userId, clientId }
      },
      ledgerForAccount: (accountId, key) => new DshRemoteCommandLedger(join(
        stateDirectory, 'dsh-remote', 'ledger',
        createHash('sha256').update(`dsh-remote-ledger-account-v1\n${accountId}`).digest('base64url'),
      ), key),
      turnUploadForAccount: (accountId, key, maxObjectBytes, callbacks) => new DshRemoteTurnUploadOutbox({
        directory: join(
          stateDirectory, 'dsh-remote', 'history',
          createHmac('sha256', key)
            .update(`dsh-remote-history-account-v1\n${accountId}\n${profileRef}`)
            .digest('base64url'),
        ),
        profileRef,
        key,
        maxObjectBytes,
        controlPlane,
        onError: (error, sessionRef) => {
          callbacks.onError(error, sessionRef)
          ctx.logger.warn('dsh-arkme: Turn OSS upload deferred: %s', error instanceof Error ? error.message : String(error))
        },
        onFinalized: callbacks.onFinalized,
      }),
    })
    remoteHost = host
    apiCtx.effect(async () => {
      let lifecycleTail: Promise<void> = Promise.resolve()
      const reconcile = () => {
        lifecycleTail = lifecycleTail.then(
          async () => { if (service.accountScope.ready()) await host.start(); else await host.suspend() },
          async () => { if (service.accountScope.ready()) await host.start(); else await host.suspend() },
        )
      }
      const unsubscribe = service.accountScope.subscribe(reconcile)
      service.accountScope.attachScopeCloseBarrier(async () => { await lifecycleTail })
      await lifecycleTail
      return async () => {
        unsubscribe()
        await lifecycleTail
        if (remoteHost === host) remoteHost = undefined
        await host.stop()
      }
    }, 'dsh-arkme: DSH remote Host lifecycle')
  })
  const handler = createArkmeHostApi(service, {
    expectedPort: ctx.webServer.port,
    allowNonLoopback: config.allowNonLoopback,
    updateManager,
    extensionManager: () => extensionManager,
    extensionInstallTasks: () => extensionInstallTasks,
    ownedExtensionInventory: () => ownedExtensionInventory,
    remoteHost: () => remoteHost,
    desktopQuarantine,
    openApiMcpController,
    teamService,
  })
  const callAssetHandler = createOutgoingCallAssetHandler({ routePrefix: `${config.routePath}/call` })
  const richMediaOptions = {
    expectedPort: ctx.webServer.port,
    allowNonLoopback: config.allowNonLoopback,
    temporaryDirectory: join(stateDirectory, 'uploads'),
    maxUploadBytes: config.maxUploadBytes,
  }
  const uploadHandler = createArkmeUploadHandler(service, richMediaOptions)
  const stageHandler = createArkmeUploadHandler(service, richMediaOptions, 'stage')
  const localFileHandler = createArkmeLocalFileHandler(service, richMediaOptions)
  const recordingImportHandler = createArkmeRecordingImportHandler(service, {
    expectedPort: ctx.webServer.port,
    allowNonLoopback: config.allowNonLoopback,
    temporaryDirectory: join(stateDirectory, 'recording-imports'),
  })
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
  const harnessEmbedHandler = createHarnessEmbedRouteHandler({
    getGraph: () => clientModules.graph(),
    installedPackageNames: () => extensionStore.list().flatMap(item =>
      item.profilePackageName === undefined ? [] : [item.profilePackageName]),
    readRootHtml: async request => {
      const response = await fetch(`http://127.0.0.1:${String(ctx.webServer.port)}/`, {
        headers: dshRootDocumentHeaders(request),
        signal: AbortSignal.timeout(Math.min(config.requestTimeoutMs, 5_000)),
      })
      if (!response.ok) throw new Error(`DSH root document returned HTTP ${String(response.status)}`)
      return await response.text()
    },
    onError: error => {
      ctx.logger.warn('dsh-arkme: core-only Harness document failed: %s', error instanceof Error ? error.message : String(error))
    },
  })
  ctx.effect(() => () => {
    service.dispose()
    localDatabase.close()
    extensionStore.close()
    ownedExtensionStore.close()
  }, 'dsh-arkme: local cache database')
  ctx.effect(() => {
    openApiMcpController.start()
    return async () => { await openApiMcpController.dispose() }
  }, 'dsh-arkme: managed OpenAPI credential and MCP lifecycle')
  ctx.effect(() => service.startChatRealtime(), 'dsh-arkme: Chat SSE receive runtime')
  ctx.effect(async () => {
    const protectedRecordingPaths = new Set((await stateStore.listAllRecordingImportJobs())
      .filter(job => !['accepted', 'cancelled'].includes(job.phase) && job.sourceHandle !== '')
      .map(job => job.sourceHandle))
    await scavengeRecordingImportTemporaryFiles(
      join(stateDirectory, 'recording-imports'),
      Date.now(),
      undefined,
      protectedRecordingPaths,
    ).catch(() => undefined)
    await service.resumeRecordingImports().catch(() => undefined)
    return () => undefined
  }, 'dsh-arkme: recording import recovery')
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
    kind: 'exact',
    path: ARKME_HARNESS_EMBED_PATH,
    handler: harnessEmbedHandler,
  }), 'dsh-arkme: core-only DeepSeek Harness iframe route')
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
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: `${config.routePath}/files/stage`, handler: stageHandler }), 'dsh-arkme: local file preparation')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: `${config.routePath}/files/local`, handler: localFileHandler }), 'dsh-arkme: authorized local file bytes')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${config.routePath}/recording/import`,
    handler: recordingImportHandler,
  }), 'dsh-arkme: recording import route')
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
  const resolved = {
    ...config,
    dataBaseUrl: config.dataBaseUrl.trim() === ''
      ? config.environment === 'prod' ? 'https://data.jotmo.cc' : 'https://jotmo-data.senguo.me'
      : config.dataBaseUrl,
    openApiBaseUrl: (config.openApiBaseUrl.trim() === ''
      ? config.environment === 'prod' ? 'https://openapi.jotmo.cc' : 'https://jotmo-openapi.senguo.me'
      : config.openApiBaseUrl).replace(/\/+$/, ''),
  }
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
      config.subjectBaseUrl,
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
      config.openApiBaseUrl,
      ...(config.dshRemoteFeatureEnabled ? [config.dshRemoteRealtimeBaseUrl] : []),
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
  if (config.dshRemoteFeatureEnabled && config.dshRemoteRealtimeBaseUrl.trim() === '') {
    throw new Error('dsh-arkme: enabled DSH remote requires dshRemoteRealtimeBaseUrl')
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
    ['openApiBaseUrl', config.openApiBaseUrl],
    ['shareWebsite', config.shareWebsite],
    ...(config.dshRemoteFeatureEnabled
      ? [['dshRemoteRealtimeBaseUrl', config.dshRemoteRealtimeBaseUrl] as const]
      : []),
  ] as const) {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.pathname !== '/'
      || label === 'openApiBaseUrl' && (url.search !== '' || url.hash !== '')) {
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
  ArkmeRecordTagItem,
  ArkmeRecordTagList,
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
  ArkmeFavoriteSticker,
  ArkmeFavoriteStickerList,
  ArkmeFavoriteStickerAddInput,
  ArkmeFavoriteStickerManageAction,
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
  ArkmeMessageReportResult,
  ArkmeMessageReportType,
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
export type { OpenApiMcpState, OpenApiMcpStatus } from './openapi-mcp/types.js'
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
