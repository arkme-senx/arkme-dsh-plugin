import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createJotmoHostApi } from './host-api.js'
import { JotmoKeychainStore } from './keychain-store.js'
import { JotmoLocalDatabase } from './local-database.js'
import { JotmoService } from './jotmo-service.js'
import { registerJotmoConversationTools } from './jotmo-tools.js'
import { JotmoStateStore } from './state-store.js'
import type { JotmoEnvironment } from './types.js'

export interface Config {
  environment: JotmoEnvironment
  authBaseUrl: string
  recordBaseUrl: string
  chatBaseUrl: string
  audioBaseUrl: string
  routePath: string
  requestTimeoutMs: number
  maxTextLength: number
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
  audioBaseUrl: Schema.string().default('https://jotmo-audio.senguo.me'),
  routePath: Schema.string().default('/jotmo-self/api'),
  requestTimeoutMs: Schema.number().min(1000).max(120000).default(30000),
  maxTextLength: Schema.number().min(1).max(100000).default(20000),
  geetestCaptchaId: Schema.string().default('ec81315ab8b0f18a7bfa13602d01e307'),
  stateDirectory: Schema.string().default(''),
  keychainServicePrefix: Schema.string().default('com.senqisi.dsh-jotmo'),
  allowNonLoopback: Schema.boolean().default(false),
  allowProduction: Schema.boolean().default(false),
})

export const name = 'dsh-jotmo'
export const inject = ['webServer', 'tools', 'systemPrompt']

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Headless Jiwo data provider for trusted Host-side consumer plugins. */
    jotmoData: JotmoService
  }
}

export function apply(ctx: Context, config: Config): void {
  validateConfig(ctx, config)
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const stateDirectory = config.stateDirectory.trim() || join(dshHome, 'jotmo-self', config.environment)
  const stateStore = new JotmoStateStore(stateDirectory)
  const localDatabase = new JotmoLocalDatabase(stateDirectory, stateStore)
  const keychain = new JotmoKeychainStore(`${config.keychainServicePrefix}.${config.environment}`)
  const service = new JotmoService(config, keychain, localDatabase)
  ctx.provide('jotmoData', service)
  registerJotmoConversationTools(ctx, service)
  const handler = createJotmoHostApi(service, {
    expectedPort: ctx.webServer.port,
    allowNonLoopback: config.allowNonLoopback,
  })
  ctx.effect(() => () => { localDatabase.close() }, 'dsh-jotmo: local cache database')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: config.routePath,
    handler,
  }), 'dsh-jotmo: local BFF route')
  ctx.logger.info('dsh-jotmo: mounted %s for %s environment', config.routePath, config.environment)
}

function validateConfig(ctx: Context, config: Config): void {
  if (config.environment === 'prod' && !config.allowProduction) {
    throw new Error('dsh-jotmo: production environment requires allowProduction: true')
  }
  if (!config.allowNonLoopback && ctx.webServer.host !== '127.0.0.1') {
    throw new Error('dsh-jotmo: Web UI must bind 127.0.0.1 unless allowNonLoopback is true')
  }
  if (!/^\/[A-Za-z0-9/_-]+$/.test(config.routePath) || config.routePath.endsWith('/')) {
    throw new Error('dsh-jotmo: routePath must be an absolute path without a trailing slash')
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(config.geetestCaptchaId)) {
    throw new Error('dsh-jotmo: geetestCaptchaId is invalid')
  }
  for (const [label, raw] of [
    ['authBaseUrl', config.authBaseUrl],
    ['recordBaseUrl', config.recordBaseUrl],
    ['chatBaseUrl', config.chatBaseUrl],
    ['audioBaseUrl', config.audioBaseUrl],
  ] as const) {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.pathname !== '/') {
      throw new Error(`dsh-jotmo: ${label} must be an HTTPS origin without credentials or path`)
    }
  }
}

export type {
  JotmoAuthSnapshot,
  JotmoCachedQueryResult,
  JotmoCachedSnapshot,
  JotmoConversationWriteResult,
  JotmoCreateTextResult,
  JotmoPendingWrite,
  JotmoImageMediaType,
  JotmoImagePayload,
  JotmoSourceDirectory,
  JotmoSourceItem,
  JotmoSourceKind,
  JotmoSourceList,
  JotmoSourceSendResult,
  JotmoTimelineCursor,
  JotmoTimelineItem,
  JotmoTimelinePage,
  JotmoRecordCursor,
  JotmoSelfRecordItem,
  JotmoSelfRecordList,
  JotmoSelfSummary,
  JotmoProviderCapabilities,
  JotmoProviderState,
  JotmoUserProfile,
  JotmoUserProfileSnapshot,
} from './types.js'
export { JOTMO_PROVIDER_CONTRACT_VERSION } from './types.js'
export { JotmoService } from './jotmo-service.js'
