import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createArkmeHostApi } from './host-api.js'
import { createArkmeSessionStore } from './keychain-store.js'
import { ArkmeLocalDatabase } from './local-database.js'
import { ArkmeRealtimeEvents } from './realtime-events.js'
import { ArkmeService } from './arkme-service.js'
import { ArkmeStateStore } from './state-store.js'
import { registerArkmeTools } from './tools/index.js'
import type { ArkmeToolProfile } from './tools/index.js'
import type { ArkmeEnvironment } from './types.js'

export interface Config {
  environment: ArkmeEnvironment
  authBaseUrl: string
  recordBaseUrl: string
  chatBaseUrl: string
  imBaseUrl: string
  worldBaseUrl: string
  relationBaseUrl: string
  intelligentBaseUrl: string
  routePath: string
  requestTimeoutMs: number
  maxTextLength: number
  toolProfile: ArkmeToolProfile
  geetestCaptchaId: string
  stateDirectory: string
  keychainServicePrefix: string
  allowNonLoopback: boolean
  allowProduction: boolean
}

export const Config: Schema<Config> = Schema.object({
  environment: Schema.union(['test', 'prod']).default('test'),
  authBaseUrl: Schema.string().default('https://jotmo.senguo.me'),
  recordBaseUrl: Schema.string().default('https://jotmo-record.senguo.me'),
  chatBaseUrl: Schema.string().default('https://jotmo-chat.senguo.me'),
  imBaseUrl: Schema.string().default('https://jotmo-im.senguo.me'),
  worldBaseUrl: Schema.string().default('https://jotmo-world.senguo.me'),
  relationBaseUrl: Schema.string().default('https://jotmo-relation.senguo.me'),
  intelligentBaseUrl: Schema.string().default('https://jotmo-intelligent.senguo.me'),
  routePath: Schema.string().default('/arkme-self/api'),
  requestTimeoutMs: Schema.number().min(1000).max(120000).default(30000),
  maxTextLength: Schema.number().min(1).max(100000).default(20000),
  toolProfile: Schema.union(['business', 'atomic', 'hybrid', 'disabled']).default('business'),
  geetestCaptchaId: Schema.string().default('ec81315ab8b0f18a7bfa13602d01e307'),
  stateDirectory: Schema.string().default(''),
  keychainServicePrefix: Schema.string().default('com.senqisi.dsh-arkme'),
  allowNonLoopback: Schema.boolean().default(false),
  allowProduction: Schema.boolean().default(false),
})

export const name = 'dsh-arkme'
export const inject = ['webServer', 'tools', 'systemPrompt']

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Headless Arkme data provider for trusted Host-side consumer plugins. */
    arkmeData: ArkmeService
  }
}

export function apply(ctx: Context, config: Config): void {
  validateConfig(ctx, config)
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const stateDirectory = config.stateDirectory.trim() || join(dshHome, 'arkme-self', config.environment)
  const stateStore = new ArkmeStateStore(stateDirectory)
  const localDatabase = new ArkmeLocalDatabase(stateDirectory, stateStore)
  const sessionStore = createArkmeSessionStore(`${config.keychainServicePrefix}.${config.environment}`)
  const service = new ArkmeService(config, sessionStore, localDatabase)
  ctx.provide('arkmeData', service)
  registerArkmeTools(ctx, service, config.toolProfile)
  const handler = createArkmeHostApi(service, {
    expectedPort: ctx.webServer.port,
    allowNonLoopback: config.allowNonLoopback,
  })
  const realtimeEvents = new ArkmeRealtimeEvents(service, {
    expectedPort: ctx.webServer.port,
    allowNonLoopback: config.allowNonLoopback,
  })
  ctx.effect(() => () => { localDatabase.close() }, 'dsh-arkme: local cache database')
  ctx.effect(() => service.startChatRealtime(), 'dsh-arkme: Chat SSE receive runtime')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: config.routePath,
    handler,
  }), 'dsh-arkme: local BFF route')
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

function validateConfig(ctx: Context, config: Config): void {
  if (config.environment === 'prod' && !config.allowProduction) {
    throw new Error('dsh-arkme: production environment requires allowProduction: true')
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
  for (const [label, raw] of [
    ['authBaseUrl', config.authBaseUrl],
    ['recordBaseUrl', config.recordBaseUrl],
    ['chatBaseUrl', config.chatBaseUrl],
    ['imBaseUrl', config.imBaseUrl],
    ['worldBaseUrl', config.worldBaseUrl],
    ['relationBaseUrl', config.relationBaseUrl],
    ['intelligentBaseUrl', config.intelligentBaseUrl],
  ] as const) {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.pathname !== '/') {
      throw new Error(`dsh-arkme: ${label} must be an HTTPS origin without credentials or path`)
    }
  }
}

export type {
  ArkmeAiVideoJob,
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
  ArkmeIdAvailabilityReason,
  ArkmeIdAvailabilitySnapshot,
  ArkmeIdMutationResult,
  ArkmePendingWrite,
  ArkmeImageMediaType,
  ArkmeImagePayload,
  ArkmeSourceDirectory,
  ArkmeSourceItem,
  ArkmeSourceKind,
  ArkmeSourceList,
  ArkmeSourceReadResult,
  ArkmeSourceSendResult,
  ArkmeTimelineCursor,
  ArkmeTimelineItem,
  ArkmeTimelinePage,
  ArkmeRecordCursor,
  ArkmeSelfRecordItem,
  ArkmeSelfRecordList,
  ArkmeSelfSummary,
  ArkmeProviderCapabilities,
  ArkmeProviderState,
  ArkmeUserProfile,
  ArkmeUserProfileSnapshot,
  ArkmeWorldPublishResult,
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
export { ARKME_PROVIDER_CONTRACT_VERSION } from './types.js'
export { ArkmeService } from './arkme-service.js'
