import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { ArkmePluginError, ArkmeService } from './arkme-service.js'
import { ArkmePluginUpdateError, ArkmePluginUpdateManager } from './plugin-update.js'
import { ArkmeOutgoingCallError, type ArkmeOutgoingCallFailureCode } from './outgoing-call-contract.js'
import type {
  ArkmeAiVideoJobStatus, ArkmeArrangementListStatus, ArkmeArrangementMutationIntent,
  ArkmePluginRequest, ArkmePluginResponse, ArkmeRecordCursor,
  ArkmeRichSendInput, ArkmeSearchSceneKind, ArkmeSourceDirectory, ArkmeTimelineCursor,
} from './types.js'
import type { ArkmeCaptchaResult } from './types.js'
import type { ArkmeExtensionManager } from './extensions/manager.js'
import type { ArkmeExtensionInstallTasks } from './extensions/install-tasks.js'
import type { ArkmeOwnedExtensionInventory } from './extensions/owned-inventory.js'
import type { ArkmeExtensionCatalogItem, ArkmeExtensionCatalogPage } from './extensions/types.js'
import { invokePersistentArkmeExtension } from './extensions/persistent-runtime.js'
import { invokeArkmeBundle } from './extensions/bundle-runtime.js'

const MAX_REQUEST_BYTES = 128 * 1024
const ARKME_HOST_INSTANCE_ID = randomUUID()

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

async function readRequest(req: IncomingMessage): Promise<ArkmePluginRequest> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_REQUEST_BYTES) {
      throw new ArkmePluginError('request-too-large', '请求内容过大', false, 413)
    }
    chunks.push(buffer)
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    throw new ArkmePluginError('request-invalid', '请求 JSON 无效', false, 400, { cause: error })
  }
  if (value === null || typeof value !== 'object') {
    throw new ArkmePluginError('request-invalid', '请求格式无效', false)
  }
  const source = value as Record<string, unknown>
  if (typeof source.operation !== 'string') {
    throw new ArkmePluginError('operation-required', '缺少操作类型', false)
  }
  return {
    operation: source.operation as ArkmePluginRequest['operation'],
    ...(source.params !== null && typeof source.params === 'object'
      ? { params: source.params as Record<string, unknown> }
      : {}),
  }
}

function writeJson(res: ServerResponse, status: number, body: ArkmePluginResponse): void {
  const encoded = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(encoded),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(encoded)
}

function stringParam(params: Record<string, unknown>, key: string): string {
  return typeof params[key] === 'string' ? params[key] : ''
}

function numberParam(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanParam(params: Record<string, unknown>, key: string): boolean {
  return params[key] === true
}

function requiredBooleanParam(params: Record<string, unknown>, key: string): boolean {
  const value = params[key]
  if (typeof value !== 'boolean') {
    throw new ArkmePluginError('boolean-param-required', `${key}必须是布尔值`, false, 400)
  }
  return value
}

function requiredArrangementReminderEnabledParam(params: Record<string, unknown>): boolean {
  const value = params.enabled
  if (typeof value !== 'boolean') {
    throw new ArkmePluginError('arrangement-reminder-enabled-invalid', '安排提醒开关参数无效', false, 400)
  }
  return value
}

function arrangementListStatusParam(params: Record<string, unknown>): ArkmeArrangementListStatus {
  const status = stringParam(params, 'status')
  return status === 'identified' || status === 'following' || status === 'completed' ? status : 'all'
}

function arrangementMutationIntentParam(params: Record<string, unknown>): ArkmeArrangementMutationIntent {
  const intent = stringParam(params, 'intent')
  if (intent === 'start-follow' || intent === 'cancel-follow' || intent === 'complete'
    || intent === 'cancel-complete' || intent === 'delete') return intent
  throw new ArkmePluginError('arrangement-intent-invalid', '安排操作类型无效', false, 400)
}

function stringListParam(params: Record<string, unknown>, key: string): string[] {
  const value = params[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function optionalPositiveIntegerParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key]
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

async function enrichExtensionAuthors(
  service: ArkmeService,
  items: readonly ArkmeExtensionCatalogItem[],
): Promise<ArkmeExtensionCatalogItem[]> {
  const ownerUserIds = [...new Set(items
    .map(item => item.owner_user_id)
    .filter((userId): userId is number => Number.isSafeInteger(userId) && (userId ?? 0) > 0))]
  if (ownerUserIds.length === 0) return [...items]
  const authors = await service.extensionAuthors(ownerUserIds).catch(() => new Map())
  return items.map(item => {
    if (item.owner_user_id === undefined) return item
    const author = authors.get(item.owner_user_id)
    if (author === undefined) return item
    return {
      ...item,
      owner_name: author.displayName,
      ...(author.arkmeId === undefined ? {} : { owner_arkme_id: author.arkmeId }),
    }
  })
}

async function enrichExtensionPageAuthors(
  service: ArkmeService,
  page: ArkmeExtensionCatalogPage,
): Promise<ArkmeExtensionCatalogPage> {
  return { ...page, items: await enrichExtensionAuthors(service, page.items) }
}

function requiredCallParam(
  params: Record<string, unknown>,
  key: string,
  code: string,
  maxLength = 512,
): string {
  const value = stringParam(params, key).trim()
  if (value === '' || value.length > maxLength) {
    throw new ArkmePluginError(code, '呼叫请求参数无效', false)
  }
  return value
}

function requiredInterwovenParam(params: Record<string, unknown>, key: string): string {
  const value = stringParam(params, key).trim()
  if (value === '' || value.length > 4096) {
    throw new ArkmePluginError('interwoven-param-invalid', '交织瞬间请求参数无效', false, 400)
  }
  return value
}

function outgoingMediaTypeParam(params: Record<string, unknown>): 'audio' | 'video' {
  const value = stringParam(params, 'mediaType')
  if (value !== 'audio' && value !== 'video') {
    throw new ArkmePluginError('call-media-type-invalid', '呼叫媒体类型无效', false)
  }
  return value
}

function arkoWaitMillisParam(params: Record<string, unknown>): number {
  const raw = numberParam(params, 'waitSeconds', 25)
  const seconds = Math.min(55, Math.max(1, Math.trunc(raw)))
  return seconds * 1000
}

const OUTGOING_FAILURE_CODES = new Set<ArkmeOutgoingCallFailureCode>([
  'call-ui-unavailable',
  'call-active',
  'call-source-invalid',
  'call-peer-unavailable',
  'call-permission-denied',
  'call-bootstrap-failed',
  'call-engine-failed',
  'call-cancelled',
])

function outgoingFailureCodeParam(params: Record<string, unknown>): ArkmeOutgoingCallFailureCode {
  const code = stringParam(params, 'code') as ArkmeOutgoingCallFailureCode
  if (!OUTGOING_FAILURE_CODES.has(code)) {
    throw new ArkmePluginError('call-failure-invalid', '呼叫失败类型无效', false)
  }
  return code
}

function cursorParam(params: Record<string, unknown>): ArkmeRecordCursor | undefined {
  const raw = params.cursor
  if (raw === null || typeof raw !== 'object') return undefined
  const cursor = raw as Record<string, unknown>
  const sendAtMillis = numberParam(cursor, 'sendAtMillis', 0)
  const recordUid = stringParam(cursor, 'recordUid')
  return sendAtMillis > 0 && recordUid !== '' ? { sendAtMillis, recordUid } : undefined
}

function timelineCursorParam(params: Record<string, unknown>): ArkmeTimelineCursor | undefined {
  const raw = params.cursor
  if (raw === null || typeof raw !== 'object') return undefined
  const cursor = raw as Record<string, unknown>
  const sendAtMillis = numberParam(cursor, 'sendAtMillis', 0)
  const itemUid = stringParam(cursor, 'itemUid')
  const beforeSequence = numberParam(cursor, 'beforeSequence', 0)
  if (beforeSequence > 0) return { beforeSequence }
  return sendAtMillis > 0 && itemUid !== '' ? { sendAtMillis, itemUid } : undefined
}

function richSendParam(params: Record<string, unknown>): ArkmeRichSendInput {
  const rawAssets = Array.isArray(params.assets) ? params.assets : []
  const thinkingDurationMillis = Math.max(0, Math.trunc(numberParam(params, 'thinkingDurationMillis', 0)))
  return {
    title: stringParam(params, 'title'),
    textContent: stringParam(params, 'textContent'),
    displayKind: numberParam(params, 'displayKind', 0) === 1 ? 1 : 0,
    ...(thinkingDurationMillis === 0 ? {} : { thinkingDurationMillis }),
    assets: rawAssets.flatMap(raw => {
      if (raw === null || typeof raw !== 'object') return []
      const asset = raw as Record<string, unknown>
      const fileKind = numberParam(asset, 'fileKind', 0)
      if (![1, 2, 3, 4].includes(fileKind)) return []
      return [{
        fileAssetUid: stringParam(asset, 'fileAssetUid'),
        fileName: stringParam(asset, 'fileName'),
        mimeType: stringParam(asset, 'mimeType'),
        size: numberParam(asset, 'size', 0),
        fileKind: fileKind as 1 | 2 | 3 | 4,
      }]
    }),
  }
}

function captchaParam(params: Record<string, unknown>): ArkmeCaptchaResult {
  const raw = params.captcha
  const source = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    lot_number: stringParam(source, 'lot_number'),
    captcha_output: stringParam(source, 'captcha_output'),
    pass_token: stringParam(source, 'pass_token'),
    gen_time: stringParam(source, 'gen_time'),
  }
}

export interface ArkmeHostApiOptions {
  expectedPort: number
  allowNonLoopback: boolean
  updateManager?: Pick<
    ArkmePluginUpdateManager,
    'status' | 'check' | 'acknowledge' | 'install' | 'installStatus'
  >
  extensionManager?: () => ArkmeExtensionManager | undefined
  extensionInstallTasks?: () => ArkmeExtensionInstallTasks | undefined
  ownedExtensionInventory?: () => ArkmeOwnedExtensionInventory | undefined
}

export function createArkmeHostApi(service: ArkmeService, options: ArkmeHostApiOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method !== 'POST') {
        throw new ArkmePluginError('method-not-allowed', '只允许 POST 请求', false, 405)
      }
      if (!options.allowNonLoopback && !isLoopback(req.socket.remoteAddress)) {
        throw new ArkmePluginError('loopback-required', 'Arkme 插件仅允许本机访问', false, 403)
      }
      const origin = req.headers.origin
      if (origin !== undefined) {
        let parsed: URL
        try {
          parsed = new URL(origin)
        } catch (error) {
          throw new ArkmePluginError('origin-invalid', '请求来源无效', false, 403, { cause: error })
        }
        const port = parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number(parsed.port)
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || port !== options.expectedPort) {
          throw new ArkmePluginError('origin-rejected', '请求来源不受信任', false, 403)
        }
      }
      const request = await readRequest(req)
      const params = request.params ?? {}
      if (['extensions.delete', 'extensions.reviews.create', 'extensions.install.start', 'extensions.install.pause', 'extensions.install.resume', 'extensions.enabled.set', 'extensions.metadata.update', 'extensions.share.rotate', 'extensions.preview.delete', 'extensions.preview.reorder', 'extensions.uninstall', 'extensions.restart', 'extensions.persistent.invoke', 'extensions.bundle.invoke', 'extensions.mine.publish']
        .includes(request.operation) && origin === undefined) {
        throw new ArkmePluginError('origin-required', '扩展变更必须从当前 DSH 页面发起', false, 403)
      }
      const value = await dispatchArkmeHostOperation(
        service,
        request.operation,
        params,
        options.updateManager,
        options.extensionManager?.(),
        options.extensionInstallTasks?.(),
        options.ownedExtensionInventory?.(),
      )
      writeJson(res, 200, { ok: true, value })
    } catch (error) {
      const known = error instanceof ArkmePluginError
        ? error
        : error instanceof ArkmePluginUpdateError
          ? new ArkmePluginError(error.code, error.message, error.retryable, error.retryable ? 503 : 409)
        : error instanceof ArkmeOutgoingCallError
          ? new ArkmePluginError(error.code, error.message, error.retryable, error.code === 'call-active' ? 409 : 400)
          : new ArkmePluginError('internal-error', 'Arkme 插件处理失败', true, 500, { cause: error })
      writeJson(res, known.httpStatus, {
        ok: false,
        error: { code: known.code, message: known.message, retryable: known.retryable },
      })
    }
  }
}

export async function dispatchArkmeHostOperation(
  service: ArkmeService,
  operation: ArkmePluginRequest['operation'],
  params: Record<string, unknown>,
  updateManager?: Pick<
    ArkmePluginUpdateManager,
    'status' | 'check' | 'acknowledge' | 'install' | 'installStatus'
  >,
  extensionManager?: ArkmeExtensionManager,
  extensionInstallTasks?: ArkmeExtensionInstallTasks,
  ownedExtensionInventory?: ArkmeOwnedExtensionInventory,
): Promise<unknown> {
  switch (operation) {
    case 'provider.capabilities': return service.providerCapabilities()
    case 'provider.instance': return { instanceId: ARKME_HOST_INSTANCE_ID }
    case 'provider.state': return await service.providerState()
    case 'chat.realtime.state': return service.chatRealtimeState()
    case 'plugin.update.status': return await requireUpdateManager(updateManager).status()
    case 'plugin.update.check': return await requireUpdateManager(updateManager).check({ manual: true })
    case 'plugin.update.install': return await requireUpdateManager(updateManager).install()
    case 'plugin.update.install-status': return await requireUpdateManager(updateManager).installStatus()
    case 'plugin.update.acknowledge': {
      const snoozeHours = numberParam(params, 'snoozeHours', 24)
      if (snoozeHours < 0 || snoozeHours > 24) {
        throw new ArkmePluginError('plugin-update-snooze-invalid', '稍后提醒时间无效', false)
      }
      return await requireUpdateManager(updateManager).acknowledge(snoozeHours)
    }
    case 'auth.status': return await service.authStatus()
    case 'auth.config': return service.clientConfig()
    case 'auth.begin': return await service.beginWechatLogin()
    case 'auth.poll': return await service.pollWechatLogin(stringParam(params, 'attemptId'))
    case 'auth.test.login': return await service.testLogin(numberParam(params, 'userId', 0))
    case 'auth.phone.send': return await service.sendPhoneCode(
      stringParam(params, 'phone'),
      captchaParam(params),
    )
    case 'auth.phone.verify': return await service.verifyPhoneCode(
      stringParam(params, 'phone'),
      stringParam(params, 'code'),
    )
    case 'auth.logout': return await service.logout()
    case 'recordings.calendar': return await service.recordingCalendar(
      numberParam(params, 'fromStamp', 0),
      numberParam(params, 'toStamp', 0),
    )
    case 'recordings.day': return await service.recordingDay(numberParam(params, 'dateStamp', 0))
    case 'search.records': return await service.searchRemote({
      query: stringParam(params, 'query'),
      limit: numberParam(params, 'limit', 20),
      ...(stringParam(params, 'cursor') === '' ? {} : { cursor: stringParam(params, 'cursor') }),
      ...(['topic', 'chat_session'].includes(stringParam(params, 'searchScope'))
        ? { searchScope: stringParam(params, 'searchScope') as 'topic' | 'chat_session' }
        : {}),
      ...(stringParam(params, 'sourceUid') === '' ? {} : { sourceUid: stringParam(params, 'sourceUid') }),
    })
    case 'search.scene': {
      const scene = stringParam(params, 'scene') as ArkmeSearchSceneKind
      const limit = numberParam(params, 'limit', 20)
      const cursor = stringParam(params, 'cursor')
      if (scene === 'image_video' && stringParam(params, 'mediaKind') === 'image') {
        return await service.searchImages({ limit, ...(cursor === '' ? {} : { cursor }) })
      }
      return await service.searchScene({ scene, limit, ...(cursor === '' ? {} : { cursor }) })
    }
    case 'search.recordings': return await service.searchRecordings({
      query: stringParam(params, 'query'),
      limit: numberParam(params, 'limit', 20),
      ...(stringParam(params, 'cursor') === '' ? {} : { cursor: stringParam(params, 'cursor') }),
    })
    case 'search.history': return await service.searchHistory(numberParam(params, 'limit', 10))
    case 'search.history.create': return await service.createSearchHistory(stringParam(params, 'query'))
    case 'ai-video.list': return await service.aiVideoList({
      limit: numberParam(params, 'limit', 20),
      ...(stringParam(params, 'cursor') === '' ? {} : { cursor: stringParam(params, 'cursor') }),
      ...(stringListParam(params, 'statuses').length === 0
        ? {}
        : { statuses: stringListParam(params, 'statuses') as ArkmeAiVideoJobStatus[] }),
    })
    case 'files.assets': return await service.queryFileAssets(stringListParam(params, 'fileAssetUids'))
    case 'arko.profile': return await service.arkoProfile()
    case 'arko.session': return await service.arkoEnsureSession()
    case 'arko.new-session': return await service.arkoCreateSession()
    case 'arko.models': return await service.arkoModelCatalog()
    case 'arko.model.activate': return await service.arkoActivateModel(stringParam(params, 'routeKey'))
    case 'arko.history': return await service.arkoHistoryPage(
      numberParam(params, 'limit', 50),
      numberParam(params, 'offset', 0),
    )
    case 'arko.ask': {
      const sessionId = optionalPositiveIntegerParam(params, 'sessionId')
      const clientTurnUid = stringParam(params, 'clientTurnUid')
      const replyToAssistantMsgId = optionalPositiveIntegerParam(params, 'replyToAssistantMsgId')
      const replyToRunUid = stringParam(params, 'replyToRunUid')
      const modelRouteKey = stringParam(params, 'modelRouteKey')
      return await service.arkoAsk(stringParam(params, 'text'), {
        waitMillis: arkoWaitMillisParam(params),
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(clientTurnUid === '' ? {} : { clientTurnUid }),
        ...(modelRouteKey === '' ? {} : { modelRouteKey }),
        ...(replyToRunUid === '' ? {} : { replyToRunUid }),
        ...(replyToAssistantMsgId === undefined ? {} : { replyToAssistantMsgId }),
      })
    }
    case 'arko.run.status': return await service.arkoRunStatus(
      numberParam(params, 'sessionId', 0),
      stringParam(params, 'runUid'),
    )
    case 'arko.cancel': return await service.arkoCancel(
      numberParam(params, 'sessionId', 0),
      numberParam(params, 'assistantMsgId', 0),
      stringParam(params, 'runUid'),
    )
    case 'records.cache': return await service.cachedSnapshot()
    case 'records.refresh': return await service.refreshSnapshot()
    case 'records.search': {
      const beforeMillis = numberParam(params, 'beforeMillis', 0)
      return await service.searchRecords({
        query: stringParam(params, 'query'),
        limit: numberParam(params, 'limit', 10),
        ...(beforeMillis > 0 ? { beforeMillis } : {}),
        syncAll: booleanParam(params, 'syncAll'),
      })
    }
    case 'records.summary': return await service.summary()
    case 'records.list': return await service.list(numberParam(params, 'limit', 30), cursorParam(params))
    case 'records.create': return await service.createText(
      stringParam(params, 'recordUid'),
      stringParam(params, 'textContent'),
    )
    case 'records.outbox': return await service.pendingWrites()
    case 'records.retry': return await service.retryPending(stringParam(params, 'recordUid'))
    case 'user.profile': return await service.cachedProfile()
    case 'user.profile.refresh': return await service.refreshProfile()
    case 'image.read': {
      const image = await service.readImage(stringParam(params, 'imageRef'))
      return {
        mediaType: image.mediaType,
        bytes: image.bytes,
        dataBase64: Buffer.from(image.data).toString('base64'),
      }
    }
    case 'arrangements.list': return await service.listArrangements({
      status: arrangementListStatusParam(params),
      limit: Math.min(50, Math.max(1, Math.trunc(numberParam(params, 'limit', 20)))),
      offset: Math.max(0, Math.trunc(numberParam(params, 'offset', 0))),
    })
    case 'arrangements.detail': return await service.arrangementDetail(stringParam(params, 'arrangementRef'))
    case 'arrangements.mutate': return await service.mutateArrangement(
      stringParam(params, 'arrangementRef'),
      arrangementMutationIntentParam(params),
    )
    case 'arrangements.reminder-enabled': return await service.setArrangementReminderEnabled(
      stringParam(params, 'arrangementRef'),
      requiredArrangementReminderEnabledParam(params),
    )
    case 'arrangements.reminders.summary': return await service.arrangementReminderSummary()
    case 'arrangements.reminders.list': return await service.listArrangementReminders({
      unreadOnly: booleanParam(params, 'unreadOnly'),
      limit: Math.min(50, Math.max(1, Math.trunc(numberParam(params, 'limit', 20)))),
      offset: Math.max(0, Math.trunc(numberParam(params, 'offset', 0))),
    })
    case 'arrangements.reminders.mark-read': {
      const eventRefs = [...new Set(stringListParam(params, 'eventRefs')
        .map(value => value.trim())
        .filter(value => value !== ''))]
      if (eventRefs.length === 0 || eventRefs.length > 50) {
        throw new ArkmePluginError('arrangement-reminder-refs-invalid', '请选择 1 至 50 条安排提醒', false)
      }
      return await service.markArrangementRemindersRead(eventRefs)
    }
    case 'arrangements.reminders.mark-all-read': return await service.markAllArrangementRemindersRead()
    case 'arrangements.reminders.clear': return await service.clearArrangementReminders()
    case 'world.feed': return await service.listWorldFeed({
      limit: Math.min(20, Math.max(1, Math.trunc(numberParam(params, 'limit', 20)))),
      offset: Math.max(0, Math.trunc(numberParam(params, 'offset', 0))),
    })
    case 'world.interactions.list': return await service.listWorldInteractions(
      stringParam(params, 'recordRef'),
      {
        limit: Math.min(50, Math.max(1, Math.trunc(numberParam(params, 'limit', 50)))),
        offset: Math.max(0, Math.trunc(numberParam(params, 'offset', 0))),
      },
    )
    case 'world.interactions.create-text': return await service.createWorldTextInteraction({
      targetRef: stringParam(params, 'targetRef'),
      textContent: stringParam(params, 'textContent'),
      clientMutationId: stringParam(params, 'clientMutationId'),
    })
    case 'world.image.read': {
      const image = await service.readWorldImage(stringParam(params, 'imageRef'))
      return {
        mediaType: image.mediaType,
        bytes: image.bytes,
        dataBase64: Buffer.from(image.data).toString('base64'),
      }
    }
    case 'dsh-beta-community.entry-state': return await service.dshBetaCommunityEntryState()
    case 'dsh-beta-community.join': return await service.joinDSHBetaCommunity()
    case 'topic.create': return await service.createTopic(
      stringParam(params, 'title'),
      stringParam(params, 'parentSourceRef') || undefined,
    )
    case 'sources.list': return await service.listSources(
      stringParam(params, 'directory') as ArkmeSourceDirectory,
      {
        limit: numberParam(params, 'limit', 30),
        ...(stringParam(params, 'cursor') === '' ? {} : { cursor: stringParam(params, 'cursor') }),
        refresh: booleanParam(params, 'refresh'),
      },
    )
    case 'source.timeline': {
      const cursor = timelineCursorParam(params)
      return await service.readSource(
        stringParam(params, 'sourceRef'),
        { limit: numberParam(params, 'limit', 30), ...(cursor === undefined ? {} : { cursor }) },
      )
    }
    case 'source.interwoven-moments': return await service.interwovenMoments(
      requiredInterwovenParam(params, 'sourceRef'),
    )
    case 'source.interwoven-detail': return await service.interwovenMomentDetail(
      requiredInterwovenParam(params, 'sourceRef'),
      requiredInterwovenParam(params, 'momentRef'),
    )
    case 'source.mark-read': return await service.markSourceRead(
      stringParam(params, 'sourceRef'),
      numberParam(params, 'readSequence', 0),
    )
    case 'source.send-text': return await service.sendSourceText(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'textContent'),
      {
        ...(stringParam(params, 'recordUid') === '' ? {} : { recordUid: stringParam(params, 'recordUid') }),
        ...(stringParam(params, 'relationUid') === '' ? {} : { relationUid: stringParam(params, 'relationUid') }),
        ...(booleanParam(params, 'agentAuthored') ? { agentAuthored: true } : {}),
      },
    )
    case 'related-recordings.eligibility': return await service.relatedRecordingEligibility(
      stringParam(params, 'sourceRef'),
    )
    case 'related-recordings.page': return await service.relatedRecordings(
      stringParam(params, 'sourceRef'),
      {
        limit: numberParam(params, 'limit', 10),
        ...(stringParam(params, 'cursor') === '' ? {} : { cursor: stringParam(params, 'cursor') }),
        ...(stringParam(params, 'monthKey') === '' ? {} : { monthKey: stringParam(params, 'monthKey') }),
        timezoneOffsetMillis: numberParam(params, 'timezoneOffsetMillis', 0),
        includeTimeIndex: booleanParam(params, 'includeTimeIndex'),
      },
    )
    case 'source.ai-polish.settings': return await service.inspectGroupAiPolish(
      stringParam(params, 'sourceRef'),
    )
    case 'source.ai-polish.notices': return await service.readGroupAiPolishNotices(
      stringParam(params, 'sourceRef'),
    )
    case 'source.ai-polish.generate-rule': return await service.generateGroupAiPolishRuleForSource(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'requirement'),
    )
    case 'source.ai-polish.confirm-enable': return await service.confirmEnableGroupAiPolish(
      stringParam(params, 'confirmationRef'),
    )
    case 'source.ai-polish.prepare-disable': return await service.prepareDisableGroupAiPolishForSource(
      stringParam(params, 'sourceRef'),
    )
    case 'source.ai-polish.confirm-disable': return await service.confirmDisableGroupAiPolish(
      stringParam(params, 'confirmationRef'),
    )
    case 'source.ai-polish.retry': return await service.retryGroupAiPolish(
      stringParam(params, 'retryRef'),
    )
    case 'group.members': return await service.listGroupMembers(
      stringParam(params, 'sourceRef'),
      { activeOnly: params.activeOnly !== false },
    )
    case 'group.settings': return await service.groupSettings(stringParam(params, 'sourceRef'))
    case 'group.notification.set': return await service.setGroupMessageDnd(
      stringParam(params, 'sourceRef'),
      params.enabled === true,
    )
    case 'group.rename': return await service.renameGroup(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'title'),
    )
    case 'group.leave': return await service.leaveGroup(stringParam(params, 'sourceRef'))
    case 'group.dissolve': return await service.dissolveGroup(stringParam(params, 'sourceRef'))
    case 'group.report': return await service.reportGroup(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'reason'),
    )
    case 'user.card': return await service.userCard(numberParam(params, 'userId', 0))
    case 'chat.private.open': return await service.openPrivateChatFromUser(
      numberParam(params, 'peerUserId', 0),
      { displayName: stringParam(params, 'displayName') },
    )
    case 'source.send-rich': return await service.sendSourceRich(
      stringParam(params, 'sourceRef'),
      richSendParam(params),
      {
        ...(stringParam(params, 'recordUid') === '' ? {} : { recordUid: stringParam(params, 'recordUid') }),
        ...(stringParam(params, 'relationUid') === '' ? {} : { relationUid: stringParam(params, 'relationUid') }),
      },
    )
    case 'source.long-article.detail': return await service.longArticleDetail(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'itemUid'),
    )
    case 'source.long-article.update': return await service.updateLongArticle(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'itemUid'),
      {
        title: stringParam(params, 'title'),
        textContent: stringParam(params, 'textContent'),
        version: Math.trunc(numberParam(params, 'version', 0)),
        editDurationMillis: Math.max(0, Math.trunc(numberParam(params, 'editDurationMillis', 0))),
      },
    )
    case 'source.long-article.draft.get': return await service.getLongArticleDraft(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'itemUid') || undefined,
    )
    case 'source.long-article.draft.put': return await service.putLongArticleDraft({
      sourceRef: stringParam(params, 'sourceRef'),
      ...(stringParam(params, 'itemUid') === '' ? {} : { itemUid: stringParam(params, 'itemUid') }),
      title: stringParam(params, 'title'),
      textContent: stringParam(params, 'textContent'),
      durationMillis: Math.max(0, Math.trunc(numberParam(params, 'durationMillis', 0))),
      updatedAtMillis: Date.now(),
    })
    case 'source.long-article.draft.delete': return await service.removeLongArticleDraft(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'itemUid') || undefined,
    )
    case 'calls.outgoing.intent.claim': return await service.claimOutgoingCallIntent()
    case 'calls.outgoing.intent.resolve': {
      const intentId = requiredCallParam(params, 'intentId', 'call-intent-invalid')
      const claimToken = requiredCallParam(params, 'claimToken', 'call-intent-invalid')
      const status = stringParam(params, 'status')
      if (status === 'calling') {
        return await service.resolveOutgoingCallIntent({
          intentId,
          claimToken,
          outcome: { status: 'calling' },
        })
      }
      if (status !== 'failed') {
        throw new ArkmePluginError('call-intent-invalid', '呼叫意图状态无效', false)
      }
      return await service.resolveOutgoingCallIntent({
        intentId,
        claimToken,
        outcome: {
          status: 'failed',
          code: outgoingFailureCodeParam(params),
          message: requiredCallParam(params, 'message', 'call-failure-invalid', 500),
        },
      })
    }
    case 'calls.outgoing.prepare': return await service.prepareOutgoingCall({
      sourceRef: requiredCallParam(params, 'sourceRef', 'call-source-invalid', 4096),
      mediaType: outgoingMediaTypeParam(params),
      callRequestId: requiredCallParam(params, 'callRequestId', 'call-request-invalid'),
    })
    case 'calls.outgoing.heartbeat': return await service.heartbeatOutgoingCall(
      requiredCallParam(params, 'callRequestId', 'call-request-invalid'),
    )
    case 'calls.outgoing.release': return await service.releaseOutgoingCall(
      requiredCallParam(params, 'callRequestId', 'call-request-invalid'),
    )
    case 'extensions.catalog.list': return await requireExtensionManager(extensionManager).search(
      stringParam(params, 'query'),
      numberParam(params, 'limit', 20),
    )
    case 'extensions.catalog.detail': {
      const item = await requireExtensionManager(extensionManager).inspect(stringParam(params, 'extensionId'))
      return (await enrichExtensionAuthors(service, [item]))[0]
    }
    case 'extensions.reviews.list': return await service.listExtensionReviews(
      stringParam(params, 'extensionId'),
      {
        limit: Math.min(100, Math.max(1, Math.trunc(numberParam(params, 'limit', 20)))),
        offset: Math.max(0, Math.trunc(numberParam(params, 'offset', 0))),
      },
    )
    case 'extensions.reviews.create': return await service.createExtensionReview({
      extensionId: stringParam(params, 'extensionId'),
      textContent: stringParam(params, 'textContent'),
      ...(numberParam(params, 'rating', 0) <= 0 ? {} : { rating: Math.trunc(numberParam(params, 'rating', 0)) }),
      ...(stringParam(params, 'parentReviewRef') === '' ? {} : { parentReviewRef: stringParam(params, 'parentReviewRef') }),
      clientMutationId: stringParam(params, 'clientMutationId'),
    })
    case 'extensions.my-list': return await enrichExtensionPageAuthors(
      service,
      await requireExtensionManager(extensionManager).myList(),
    )
    case 'extensions.metadata.update': return await requireExtensionManager(extensionManager).updateMetadata({
      extensionId: stringParam(params, 'extensionId'),
      name: stringParam(params, 'name'),
      description: stringParam(params, 'description'),
      visibility: extensionEditableVisibilityParam(params),
      clientMutationId: stringParam(params, 'clientMutationId'),
    })
	case 'extensions.share.rotate': return await requireExtensionManager(extensionManager).rotateShareLink({
		extensionId: stringParam(params, 'extensionId'),
		clientMutationId: stringParam(params, 'clientMutationId'),
	})
    case 'extensions.delete': return await requireExtensionManager(extensionManager).delete(
      stringParam(params, 'extensionId'),
    )
    case 'extensions.installed-list': return requireExtensionManager(extensionManager).listInstalled()
    case 'extensions.mine.list': return await requireOwnedExtensionInventory(ownedExtensionInventory).list({
      ...(stringParam(params, 'currentSessionId').trim() === '' ? {} : { currentSessionId: stringParam(params, 'currentSessionId').trim() }),
    })
    case 'extensions.mine.publish': return await requireOwnedExtensionInventory(ownedExtensionInventory).publish({
      ownedRef: stringParam(params, 'ownedRef'),
      name: stringParam(params, 'name'),
      description: stringParam(params, 'description'),
      version: stringParam(params, 'version'),
      visibility: extensionVisibilityParam(params),
      ...(stringParam(params, 'changelog').trim() === '' ? {} : { changelog: stringParam(params, 'changelog') }),
		...(stringParam(params, 'githubRepositoryUrl').trim() === '' ? {} : { githubRepositoryUrl: stringParam(params, 'githubRepositoryUrl') }),
      clientMutationId: stringParam(params, 'clientMutationId'),
    })
    case 'extensions.enabled-state': return requireExtensionManager(extensionManager).enabledState(
      stringParam(params, 'extensionId'),
    )
    case 'extensions.enabled.set': return await requireExtensionManager(extensionManager).setEnabled({
      agent: undefined,
      extensionId: stringParam(params, 'extensionId'),
      enabled: requiredBooleanParam(params, 'enabled'),
    })
    case 'extensions.preview.delete': return await requireExtensionManager(extensionManager).deletePreview({
      extensionId: stringParam(params, 'extensionId'),
      previewRef: stringParam(params, 'previewRef'),
      expectedRevision: numberParam(params, 'expectedRevision', -1),
    })
    case 'extensions.preview.reorder': return await requireExtensionManager(extensionManager).reorderPreviews({
      extensionId: stringParam(params, 'extensionId'),
      orderedPreviewRefs: stringListParam(params, 'orderedPreviewRefs'),
      expectedRevision: numberParam(params, 'expectedRevision', -1),
    })
    case 'extensions.updates': return await requireExtensionManager(extensionManager).updates()
    case 'extensions.install.preview': return await requireExtensionManager(extensionManager).previewInstall(
      stringParam(params, 'extensionId'),
      stringParam(params, 'version') || undefined,
    )
    case 'extensions.install.start': return requireExtensionInstallTasks(extensionInstallTasks).start({
      extensionId: stringParam(params, 'extensionId'),
      ...(stringParam(params, 'version') === '' ? {} : { version: stringParam(params, 'version') }),
      sessionId: stringParam(params, 'sessionId'),
    })
    case 'extensions.install.status': return requireExtensionInstallTasks(extensionInstallTasks).status(
      stringParam(params, 'taskId'),
      stringParam(params, 'sessionId'),
    )
    case 'extensions.install.pause': return requireExtensionInstallTasks(extensionInstallTasks).pause(
      stringParam(params, 'taskId'),
      stringParam(params, 'sessionId'),
    )
    case 'extensions.install.resume': return requireExtensionInstallTasks(extensionInstallTasks).resume(
      stringParam(params, 'taskId'),
      stringParam(params, 'sessionId'),
    )
    case 'extensions.uninstall': return await requireExtensionInstallTasks(extensionInstallTasks).uninstall({
      extensionId: stringParam(params, 'extensionId'),
      sessionId: stringParam(params, 'sessionId'),
    })
    case 'extensions.restart': return await requireExtensionInstallTasks(extensionInstallTasks).restart(
      stringParam(params, 'extensionId'),
    )
    case 'extensions.persistent.invoke': return await invokePersistentArkmeExtension(
      stringParam(params, 'extensionId'),
      stringParam(params, 'method'),
      params.args,
    )
    case 'extensions.bundle.invoke': return await invokeArkmeBundle(
      stringParam(params, 'packageName'),
      stringParam(params, 'method'),
      params.args,
    )
    default: throw new ArkmePluginError('operation-unknown', '不支持的Arkme 插件操作', false, 404)
  }
}

function requireUpdateManager(
  updateManager: Pick<
    ArkmePluginUpdateManager,
    'status' | 'check' | 'acknowledge' | 'install' | 'installStatus'
  > | undefined,
): Pick<
  ArkmePluginUpdateManager,
  'status' | 'check' | 'acknowledge' | 'install' | 'installStatus'
> {
  if (updateManager === undefined) {
    throw new ArkmePluginError('plugin-update-unavailable', '插件更新检查暂不可用', true, 503)
  }
  return updateManager
}

function requireExtensionInstallTasks(tasks: ArkmeExtensionInstallTasks | undefined): ArkmeExtensionInstallTasks {
  if (tasks === undefined) {
    throw new ArkmePluginError('extension-runtime-unavailable', '当前 DSH 未加载扩展安装运行时', false, 503)
  }
  return tasks
}

function requireExtensionManager(manager: ArkmeExtensionManager | undefined): ArkmeExtensionManager {
  if (manager === undefined) {
    throw new ArkmePluginError('extension-runtime-unavailable', '当前 DSH 未加载 Dynamic Cordis Runner，扩展市场不可用', false, 503)
  }
  return manager
}

function requireOwnedExtensionInventory(inventory: ArkmeOwnedExtensionInventory | undefined): ArkmeOwnedExtensionInventory {
  if (inventory === undefined) throw new ArkmePluginError('extension-runtime-unavailable', '扩展运行时尚未就绪', true, 503)
  return inventory
}

function extensionVisibilityParam(params: Record<string, unknown>): 'private' | 'unlisted' | 'public' {
  const value = stringParam(params, 'visibility')
  if (!['private', 'unlisted', 'public'].includes(value)) {
    throw new ArkmePluginError('extension-visibility-invalid', '扩展可见范围无效', false, 400)
  }
  return value as 'private' | 'unlisted' | 'public'
}

function extensionEditableVisibilityParam(params: Record<string, unknown>): 'private' | 'public' {
  const value = stringParam(params, 'visibility')
  if (value !== 'private' && value !== 'public') {
    throw new ArkmePluginError('extension-metadata-invalid', '扩展可见范围无效', false, 400)
  }
  return value
}
