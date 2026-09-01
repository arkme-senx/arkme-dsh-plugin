import type { IncomingMessage, ServerResponse } from 'node:http'
import { ArkmePluginError, ArkmeService } from './arkme-service.js'
import { isArkmeBotAvatarRef } from './bot-avatar-ref.js'
import { ArkmePluginUpdateError, ArkmePluginUpdateManager } from './plugin-update.js'
import { ArkmeOutgoingCallError, type ArkmeOutgoingCallFailureCode } from './outgoing-call-contract.js'
import type {
  ArkmeAiVideoJobStatus, ArkmeArrangementListStatus, ArkmeArrangementMutationIntent, ArkmeBotProvider,
  ArkmeBillingPaymentMethod, ArkmeBotMentionInput, ArkmeConversationMemberRecordMode,
  ArkmeDirectorySectionKind, ArkmeFavoriteStickerAddInput, ArkmeFavoriteStickerManageAction,
  ArkmeGroupAiPolishThreadMessage, ArkmeHumanMentionInput, ArkmeMessageReadReceiptQueryItem,
  ArkmePluginRequest, ArkmePluginResponse, ArkmeRecordCursor,
  ArkmeRecordCaptureContext, ArkmeRecordLocationCapture, ArkmeRichSendInput, ArkmeSearchSceneKind, ArkmeSourceDirectory, ArkmeTimelineCursor,
  ArkmeWorldPublishFileAsset,
} from './types.js'
import type { ArkmeCaptchaResult } from './types.js'
import { ARKME_WORLD_PUBLISH_MAX_IMAGE_BYTES, ARKME_WORLD_PUBLISH_MAX_IMAGES } from './types.js'
import type { ArkmeExtensionManager } from './extensions/manager.js'
import type { ArkmeExtensionInstallTasks } from './extensions/install-tasks.js'
import type { ArkmeOwnedExtensionInventory } from './extensions/owned-inventory.js'
import type { ArkmeDesktopExtensionQuarantine } from './extensions/desktop-quarantine.js'
import type { ArkmeExtensionCatalogItem, ArkmeExtensionCatalogPage, ArkmeExtensionCatalogSort } from './extensions/types.js'
import { effectiveExtensionPublisherRole } from './extensions/publisher-role.js'
import { invokePersistentArkmeExtension } from './extensions/persistent-runtime.js'
import { invokeArkmeBundle } from './extensions/bundle-runtime.js'
import { DshRemoteError } from './dsh-remote/errors.js'
import type { DshRemoteHostFacade } from './dsh-remote/types.js'
import { ARKME_RUNTIME_INSTANCE_ID } from './runtime-instance.js'
import { arkmeRequiredLinkMetadataFallback } from './link-metadata.js'

const MAX_STANDARD_REQUEST_BYTES = 128 * 1024
const MAX_MESSAGE_ACTION_REF_CHARS = 1024 * 1024
const MAX_REQUEST_BYTES = MAX_MESSAGE_ACTION_REF_CHARS + (64 * 1024)

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
  if (bytes > MAX_STANDARD_REQUEST_BYTES
    && source.operation !== 'source.related-quick-notes.from-message') {
    throw new ArkmePluginError('request-too-large', '请求内容过大', false, 413)
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

function billingIdentifierParam(
  params: Record<string, unknown>,
  key: string,
  code: string,
  message: string,
): string {
  const value = stringParam(params, key).trim()
  if (value === '' || value.length > 256) throw new ArkmePluginError(code, message, false, 400)
  return value
}

function billingUuidParam(
  params: Record<string, unknown>,
  key: string,
  code: string,
  message: string,
): string {
  const value = stringParam(params, key).trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new ArkmePluginError(code, message, false, 400)
  }
  return value
}

function billingPaymentMethodParam(params: Record<string, unknown>): ArkmeBillingPaymentMethod {
  const value = stringParam(params, 'paymentMethod')
  if (value !== 'alipay_pc_web' && value !== 'wechat_native') {
    throw new ArkmePluginError('billing-payment-method-invalid', '支付方式无效', false, 400)
  }
  return value
}

function numberParam(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function captureContextParam(params: Record<string, unknown>): ArkmeRecordCaptureContext | undefined {
  const raw = params.captureContext
  if (raw === undefined) return undefined
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ArkmePluginError('capture-context-invalid', '记忆快照参数无效', false, 400)
  }
  const value = raw as Record<string, unknown>
  const clientName = stringParam(value, 'clientName').trim().slice(0, 120)
  const networkName = stringParam(value, 'networkName').trim().slice(0, 120)
  const electric = typeof value.electric === 'number' && Number.isFinite(value.electric) ? Math.trunc(value.electric) : undefined
  const charge = Math.trunc(numberParam(value, 'charge', 0))
  const context: ArkmeRecordCaptureContext = {
    ...(clientName === '' ? {} : { clientName }),
    ...(networkName === '' ? {} : { networkName }),
    ...(electric === undefined || electric < 0 || electric > 100 ? {} : { electric }),
    ...(charge < 1 || charge > 3 ? {} : { charge }),
  }
  return Object.keys(context).length === 0 ? undefined : context
}

function recordLocationCaptureParam(params: Record<string, unknown>): ArkmeRecordLocationCapture {
  const raw = params.location
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ArkmePluginError('record-location-invalid', '位置快照参数无效', false, 400)
  }
  const value = raw as Record<string, unknown>
  const latitude = numberParam(value, 'latitude', Number.NaN)
  const longitude = numberParam(value, 'longitude', Number.NaN)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new ArkmePluginError('record-location-invalid', '位置坐标无效', false, 400)
  }
  const altitudeMeters = numberParam(value, 'altitudeMeters', Number.NaN)
  const speedMetersPerSecond = numberParam(value, 'speedMetersPerSecond', Number.NaN)
  const accuracyMeters = numberParam(value, 'accuracyMeters', Number.NaN)
  const capturedAtMillis = Math.trunc(numberParam(value, 'capturedAtMillis', 0))
  return {
    latitude,
    longitude,
    capturedAtMillis: capturedAtMillis > 0 ? capturedAtMillis : Date.now(),
    ...(Number.isFinite(accuracyMeters) && accuracyMeters >= 0 ? { accuracyMeters } : {}),
    ...(Number.isFinite(altitudeMeters) ? { altitudeMeters } : {}),
    ...(Number.isFinite(speedMetersPerSecond) && speedMetersPerSecond >= 0 ? { speedMetersPerSecond } : {}),
  }
}

const ARKME_DIRECTORY_SECTIONS = new Set<ArkmeDirectorySectionKind>([
  'groups', 'bots', 'unmarked-speakers', 'teams', 'contacts',
])

function directorySectionParam(params: Record<string, unknown>): ArkmeDirectorySectionKind {
  const section = stringParam(params, 'section')
  if (!ARKME_DIRECTORY_SECTIONS.has(section as ArkmeDirectorySectionKind)) {
    throw new ArkmePluginError('directory-section-invalid', '联系人目录分组无效', false, 400)
  }
  return section as ArkmeDirectorySectionKind
}

function directoryLimitParam(params: Record<string, unknown>, fallback = 30): number {
  return Math.min(50, Math.max(1, Math.trunc(numberParam(params, 'limit', fallback))))
}

function unmarkedSpeakerMarkInputParam(params: Record<string, unknown>): {
  candidateRef: string
  candidateVersion: string
  speakerRef?: string
  newSpeakerName?: string
} {
  const candidateRef = stringParam(params, 'candidateRef').trim()
  const candidateVersion = stringParam(params, 'candidateVersion').trim()
  const speakerRef = stringParam(params, 'speakerRef').trim()
  const newSpeakerName = stringParam(params, 'newSpeakerName').trim()
  if ((speakerRef === '') === (newSpeakerName === '') || newSpeakerName.length > 100) {
    throw new ArkmePluginError(
      'unmarked-mark-target-invalid', '请选择一个现有说话人或填写 1 至 100 个字符的新名称', false, 400,
    )
  }
  return {
    candidateRef,
    candidateVersion,
    ...(speakerRef === '' ? {} : { speakerRef }),
    ...(newSpeakerName === '' ? {} : { newSpeakerName }),
  }
}

function conversationMemberRecordModeParam(params: Record<string, unknown>): ArkmeConversationMemberRecordMode {
  const mode = stringParam(params, 'mode')
  if (mode === 'owner' || mode === 'mentioned') return mode
  throw new ArkmePluginError('chat-member-record-mode-invalid', '成员快记模式无效', false, 400)
}

function extensionCatalogSortParam(params: Record<string, unknown>): ArkmeExtensionCatalogSort | undefined {
  const value = stringParam(params, 'sort')
  if (value === '') return undefined
  if (value === 'rating' || value === 'comments' || value === 'opens' || value === 'created_at') return value
  throw new ArkmePluginError('extension-catalog-sort-invalid', '市集排序参数无效', false, 400)
}

function booleanParam(params: Record<string, unknown>, key: string): boolean {
  return params[key] === true
}

function botProviderParam(params: Record<string, unknown>): ArkmeBotProvider {
  const provider = stringParam(params, 'provider')
  if (provider !== 'openclaw' && provider !== 'webhook') {
    throw new ArkmePluginError('bot-provider-unsupported', 'Bot Provider 不受支持', false, 400)
  }
  return provider
}

function botAvatarParam(params: Record<string, unknown>): string {
  const avatar = stringParam(params, 'avatar').trim()
  if (avatar === '') return ''
  if (!isArkmeBotAvatarRef(avatar)) {
    throw new ArkmePluginError('bot-avatar-invalid', 'Bot 头像引用无效', false, 400)
  }
  return avatar
}

function botManageUpdateInputParam(params: Record<string, unknown>): {
  name: string
  description: string
  avatar?: string
  mentionEntryEnabled?: boolean
  webhookSecurity?: { keywordEnabled: boolean; keyword: string; tokenEnabled: boolean; ipWhitelistEnabled: boolean; ipWhitelist: string[] }
} {
  const rawSecurity = params.webhookSecurity
  const security = rawSecurity !== null && typeof rawSecurity === 'object' && !Array.isArray(rawSecurity)
    ? rawSecurity as Record<string, unknown>
    : undefined
  const avatar = botAvatarParam(params)
  const mentionEntryEnabled = typeof params.mentionEntryEnabled === 'boolean' ? params.mentionEntryEnabled : undefined
  return {
    name: stringParam(params, 'name'),
    description: stringParam(params, 'description'),
    ...(avatar === '' ? {} : { avatar }),
    ...(mentionEntryEnabled === undefined ? {} : { mentionEntryEnabled }),
    ...(security === undefined ? {} : { webhookSecurity: {
      keywordEnabled: security.keywordEnabled === true,
      keyword: stringParam(security, 'keyword'),
      tokenEnabled: security.tokenEnabled === true,
      ipWhitelistEnabled: security.ipWhitelistEnabled === true,
      ipWhitelist: Array.isArray(security.ipWhitelist)
        ? security.ipWhitelist.filter(item => typeof item === 'string').map(item => item.trim()).filter(item => item !== '').slice(0, 100)
        : [],
    } }),
  }
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

function messageActionRefsParam(params: Record<string, unknown>): string[] {
  return stringListParam(params, 'actionRefs').map(value => value.trim()).filter(value => value !== '')
}

function aiPolishThreadMessagesParam(params: Record<string, unknown>): ArkmeGroupAiPolishThreadMessage[] {
  if (!Array.isArray(params.threadMessages)) return []
  return params.threadMessages.slice(-40).flatMap(raw => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return []
    const item = raw as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const role = item.role === 'ai' || item.role === 'user' ? item.role : undefined
    const text = typeof item.text === 'string' ? item.text.trim().slice(0, 4_000) : ''
    if (id === '' || role === undefined || text === '') return []
    const ruleRef = typeof item.ruleRef === 'string' ? item.ruleRef.trim() : ''
    return [{
      id, role, text,
      ...(item.isRule === true ? { isRule: true } : {}),
      ...(ruleRef === '' ? {} : { ruleRef }),
    }]
  })
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
    .filter(item => effectiveExtensionPublisherRole(item) === 'author')
    .map(item => item.owner_user_id)
    .filter((userId): userId is number => Number.isSafeInteger(userId) && (userId ?? 0) > 0))]
  if (ownerUserIds.length === 0) return [...items]
  const authors = await service.extensionAuthors(ownerUserIds).catch(() => new Map())
  return items.map(item => {
    if (effectiveExtensionPublisherRole(item) !== 'author') return item
    if (item.owner_user_id === undefined) return item
    const author = authors.get(item.owner_user_id)
    if (author === undefined) return item
    return {
      ...item,
      owner_name: author.displayName,
      ...(author.arkmeId === undefined ? {} : { owner_arkme_id: author.arkmeId }),
      ...(author.avatarRef === undefined ? {} : { owner_avatar_ref: author.avatarRef }),
      ...(author.avatarFallback === undefined ? {} : { owner_avatar_fallback: author.avatarFallback }),
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

function requiredRelatedQuickNoteParam(
  params: Record<string, unknown>,
  key: string,
  maxLength = 4096,
): string {
  const value = stringParam(params, key).trim()
  if (value === '' || value.length > maxLength) {
    throw new ArkmePluginError('related-quick-note-param-invalid', '相关快记请求参数无效', false, 400)
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

function outgoingDiagTextParam(params: Record<string, unknown>, key: string, maxLength: number): string {
  return stringParam(params, key)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, maxLength)
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
  const afterSequence = numberParam(cursor, 'afterSequence', 0)
  if (beforeSequence > 0) return { beforeSequence }
  if (afterSequence > 0) return { afterSequence }
  return sendAtMillis > 0 && itemUid !== '' ? { sendAtMillis, itemUid } : undefined
}

function humanMentionsParam(params: Record<string, unknown>): ArkmeHumanMentionInput[] {
  const values = params.humanMentions
  if (values === undefined) return []
  if (!Array.isArray(values)) throw new ArkmePluginError('human-mention-invalid', '真人 mention 参数无效', false, 400)
  return values.map(value => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ArkmePluginError('human-mention-invalid', '真人 mention 参数无效', false, 400)
    }
    const item = value as Record<string, unknown>
    const all = item.all === true
    return {
      ...(all ? { all } : { memberRef: stringParam(item, 'memberRef') }),
      startIndex: numberParam(item, 'startIndex', -1),
      length: numberParam(item, 'length', 0),
    }
  })
}

function messageReadReceiptItemsParam(params: Record<string, unknown>): ArkmeMessageReadReceiptQueryItem[] {
  const values = params.items
  if (!Array.isArray(values)) {
    throw new ArkmePluginError('message-read-receipt-items-invalid', '消息已读状态参数无效', false, 400)
  }
  return values.map(value => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ArkmePluginError('message-read-receipt-items-invalid', '消息已读状态参数无效', false, 400)
    }
    const item = value as Record<string, unknown>
    return { itemUid: stringParam(item, 'itemUid'), sequence: numberParam(item, 'sequence', 0) }
  })
}

function botMentionsParam(params: Record<string, unknown>): ArkmeBotMentionInput[] {
  const values = params.botMentions
  if (values === undefined) return []
  if (!Array.isArray(values)) throw new ArkmePluginError('bot-mention-invalid', 'Bot mention 参数无效', false, 400)
  return values.map(value => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ArkmePluginError('bot-mention-invalid', 'Bot mention 参数无效', false, 400)
    }
    const item = value as Record<string, unknown>
    return {
      botRef: stringParam(item, 'botRef'),
      startIndex: numberParam(item, 'startIndex', -1),
      length: numberParam(item, 'length', 0),
    }
  })
}

function botRefsParam(params: Record<string, unknown>): string[] {
  const values = params.botRefs
  if (values === undefined) return []
  if (!Array.isArray(values)) throw new ArkmePluginError('bot-mention-ref-invalid', 'Bot mention 引用参数无效', false, 400)
  return values.map(value => String(value).trim())
}

function richSendParam(params: Record<string, unknown>): ArkmeRichSendInput {
  const rawAssets = Array.isArray(params.assets) ? params.assets : []
  const thinkingDurationMillis = Math.max(0, Math.trunc(numberParam(params, 'thinkingDurationMillis', 0)))
  const recordDurationMillis = Math.max(0, Math.trunc(numberParam(params, 'recordDurationMillis', 0)))
  const captureContext = captureContextParam(params)
  const humanMentions = humanMentionsParam(params)
  const botMentions = botMentionsParam(params)
  return {
    title: stringParam(params, 'title'),
    textContent: stringParam(params, 'textContent'),
    displayKind: numberParam(params, 'displayKind', 0) === 1 ? 1 : 0,
    ...(thinkingDurationMillis === 0 ? {} : { thinkingDurationMillis }),
    ...(recordDurationMillis === 0 ? {} : { recordDurationMillis }),
    ...(captureContext === undefined ? {} : { captureContext }),
    ...(humanMentions.length === 0 ? {} : { humanMentions }),
    ...(botMentions.length === 0 ? {} : { botMentions }),
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

function favoriteStickerItemParam(params: Record<string, unknown>): ArkmeFavoriteStickerAddInput {
  if (params.item === null || typeof params.item !== 'object' || Array.isArray(params.item)) {
    throw new ArkmePluginError('favorite-sticker-invalid', '收藏表情参数无效', false, 400)
  }
  const item = params.item as Record<string, unknown>
  return {
    fileAssetUid: stringParam(item, 'fileAssetUid'),
    fileName: stringParam(item, 'fileName'),
    mimeType: stringParam(item, 'mimeType'),
    size: Math.max(0, Math.trunc(numberParam(item, 'size', 0))),
    fileKind: 1,
    ...(item.isAnimated === true ? { isAnimated: true } : {}),
  }
}

function favoriteStickerManageActionParam(params: Record<string, unknown>): ArkmeFavoriteStickerManageAction {
  const action = stringParam(params, 'action')
  if (action === 'move-to-front' || action === 'delete') return action
  throw new ArkmePluginError('favorite-sticker-manage-invalid', '收藏表情管理操作无效', false, 400)
}

function worldPublishFileAssetsParam(params: Record<string, unknown>): ArkmeWorldPublishFileAsset[] {
  const rawAssets = Array.isArray(params.fileAssets) ? params.fileAssets : []
  if (rawAssets.length === 0 || rawAssets.length > ARKME_WORLD_PUBLISH_MAX_IMAGES) {
    throw new ArkmePluginError('world-publish-assets-invalid', `请选择 1 至 ${String(ARKME_WORLD_PUBLISH_MAX_IMAGES)} 张图片`, false, 400)
  }
  return rawAssets.map(raw => {
    if (raw === null || typeof raw !== 'object') {
      throw new ArkmePluginError('world-publish-assets-invalid', '世界图片参数无效', false, 400)
    }
    const asset = raw as Record<string, unknown>
    const fileAssetUid = stringParam(asset, 'fileAssetUid').trim()
    const fileName = stringParam(asset, 'fileName').trim()
    const mimeType = stringParam(asset, 'mimeType').trim().toLowerCase()
    const size = numberParam(asset, 'size', 0)
    const fileKind = numberParam(asset, 'fileKind', 0)
    if (!/^[A-Za-z0-9._:-]{8,256}$/.test(fileAssetUid) || fileName === '' || fileName.length > 255
      || !mimeType.startsWith('image/') || !Number.isSafeInteger(size) || size <= 0 || size > ARKME_WORLD_PUBLISH_MAX_IMAGE_BYTES
      || fileKind !== 1) {
      throw new ArkmePluginError('world-publish-assets-invalid', '世界图片参数无效', false, 400)
    }
    return { fileAssetUid, fileName, mimeType, size, fileKind: 1 }
  })
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
  remoteHost?: () => DshRemoteHostFacade | undefined
  desktopQuarantine?: Pick<ArkmeDesktopExtensionQuarantine, 'status' | 'dismiss' | 'reenable' | 'health'>
}

export function createArkmeHostApi(service: ArkmeService, options: ArkmeHostApiOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const controller = new AbortController()
    const abortDisconnectedRequest = () => {
      if (!res.writableEnded) controller.abort(new Error('Arkme Browser request disconnected'))
    }
    res.once('close', abortDisconnectedRequest)
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
      if (request.operation === 'link.metadata' && origin === undefined) {
        throw new ArkmePluginError('origin-required', '网址名称解析必须从当前 DSH 页面发起', false, 403)
      }
      if (['user.arkme-id.set', 'extensions.delete', 'extensions.reviews.create', 'extensions.audit.check', 'extensions.install.start', 'extensions.install.pause', 'extensions.install.resume', 'extensions.enabled.set', 'extensions.metadata.update', 'extensions.share.rotate', 'extensions.preview.delete', 'extensions.preview.reorder', 'extensions.uninstall', 'extensions.restart', 'extensions.client.failure', 'extensions.persistent.invoke', 'extensions.bundle.invoke', 'extensions.mine.publish', 'extensions.quarantine.dismiss', 'extensions.quarantine.reenable', 'remote.renameDesktop']
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
        controller.signal,
        options.remoteHost?.(),
        options.desktopQuarantine,
      )
      writeJson(res, 200, { ok: true, value })
    } catch (error) {
      if (controller.signal.aborted && res.destroyed) return
      const known = error instanceof ArkmePluginError
        ? error
        : error instanceof ArkmePluginUpdateError
          ? new ArkmePluginError(error.code, error.message, error.retryable, error.retryable ? 503 : 409)
        : error instanceof ArkmeOutgoingCallError
          ? new ArkmePluginError(error.code, error.message, error.retryable, error.code === 'call-active' ? 409 : 400)
        : error instanceof DshRemoteError
          ? new ArkmePluginError(error.code, error.message, error.retryable, error.retryable ? 503 : 409)
          : new ArkmePluginError('internal-error', 'Arkme 插件处理失败', true, 500, { cause: error })
      writeJson(res, known.httpStatus, {
        ok: false,
        error: { code: known.code, message: known.message, retryable: known.retryable },
      })
    } finally {
      res.off('close', abortDisconnectedRequest)
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
  requestSignal?: AbortSignal,
  remoteHost?: DshRemoteHostFacade,
  desktopQuarantine?: Pick<ArkmeDesktopExtensionQuarantine, 'status' | 'dismiss' | 'reenable' | 'health'>,
): Promise<unknown> {
  switch (operation) {
    case 'provider.capabilities': return service.providerCapabilities()
    case 'provider.instance': return { instanceId: ARKME_RUNTIME_INSTANCE_ID }
    case 'provider.state': return await service.providerState()
    case 'chat.realtime.state': return service.chatRealtimeState()
    case 'link.metadata': return await service.resolveLinkMetadata(
      stringParam(params, 'url'), requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'source.link-metadata.resolve': {
      const url = stringParam(params, 'url')
      return await service.resolveLinkMetadata(
        url, requestSignal === undefined ? {} : { signal: requestSignal },
      ) ?? arkmeRequiredLinkMetadataFallback(url)
    }
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
    case 'auth.app.begin': return await service.beginJiwoLogin()
    case 'auth.app.poll': return await service.pollJiwoLogin(stringParam(params, 'attemptId'))
    case 'auth.app.cancel': return await service.cancelJiwoLogin(stringParam(params, 'attemptId'))
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
    case 'remote.getStatus': return requireRemoteHost(remoteHost).getStatus()
    case 'remote.renameDesktop': return await requireRemoteHost(remoteHost).renameDesktop(stringParam(params, 'displayName'))
    case 'billing.quota': return await service.billingQuota()
    case 'billing.products': return await service.billingProducts()
    case 'billing.order.create': return await service.createBillingOrder({
      productId: billingIdentifierParam(params, 'productId', 'billing-product-id-invalid', '购买套餐无效'),
      paymentMethod: billingPaymentMethodParam(params),
      clientRequestId: billingUuidParam(
        params, 'clientRequestId', 'billing-client-request-id-invalid', '支付请求标识无效',
      ),
    })
    case 'billing.order.status': return await service.billingOrderStatus(billingUuidParam(
      params, 'orderId', 'billing-order-id-invalid', '支付订单标识无效',
    ))
    case 'voiceprint.status': return await service.myVoiceprint()
    case 'voiceprint.grants': return await service.outboundVoiceprintGrants({
      cursor: stringParam(params, 'cursor').trim(),
      limit: Math.min(100, Math.max(1, Math.trunc(numberParam(params, 'limit', 20)))),
    })
    case 'voiceprint.people': return await service.recognizedVoiceprintPeople({
      cursor: stringParam(params, 'cursor').trim(),
      limit: Math.min(50, Math.max(1, Math.trunc(numberParam(params, 'limit', 20)))),
    })
    case 'voiceprint.person': return await service.recognizedVoiceprintPerson(
      stringParam(params, 'personRef').trim(),
    )
    case 'voiceprint.person.voiceprints': return await service.recognizedPersonVoiceprints(
      stringParam(params, 'personRef').trim(),
    )
    case 'voiceprint.person.invite': return await service.createRecognizedPersonVoiceprintInvitation(
      stringParam(params, 'personRef').trim(), stringParam(params, 'targetContactRef').trim() || undefined,
    )
    case 'voiceprint.invite': return await service.createVoiceprintInvitation()
    case 'voiceprint.revoke': return await service.revokeVoiceprintPlaybackGrant(
      stringParam(params, 'grantRef').trim(),
    )
    case 'voiceprint.restore': return await service.restoreVoiceprintPlayback()
    case 'contacts.search': return await service.searchContact(stringParam(params, 'identifier'))
    case 'contacts.add': return await service.addContact(stringParam(params, 'contactRef'), {
      ...(stringParam(params, 'remark').trim() === '' ? {} : { remark: stringParam(params, 'remark') }),
      ...(stringParam(params, 'requestUid').trim() === '' ? {} : { requestUid: stringParam(params, 'requestUid') }),
    })
    case 'directory.list': {
      const countOnly = booleanParam(params, 'countOnly')
      const cursor = stringParam(params, 'cursor').trim()
      return await service.listDirectory(directorySectionParam(params), {
        limit: countOnly ? 0 : directoryLimitParam(params),
        ...(countOnly ? { countOnly: true } : {}),
        ...(!countOnly && cursor !== '' ? { cursor } : {}),
      })
    }
    case 'directory.contact.profile': return await service.directoryContactProfile(
      stringParam(params, 'contactRef').trim(),
    )
    case 'directory.contact.world': return await service.directoryContactWorld(
      stringParam(params, 'contactRef').trim(),
      {
        limit: Math.min(20, Math.max(1, Math.trunc(numberParam(params, 'limit', 20)))),
        offset: Math.max(0, Math.trunc(numberParam(params, 'offset', 0))),
      },
    )
    case 'directory.contact.open-chat': return await service.openDirectoryContactChat(
      stringParam(params, 'contactRef').trim(),
    )
    case 'directory.group.open-chat': return await service.openDirectoryGroupChat(
      stringParam(params, 'sourceRef').trim(),
      requestSignal,
    )
    case 'directory.bot.open-chat': return await service.openBotChat(
      stringParam(params, 'botRef').trim(), requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'bots.private-chat.open': return await service.openBotPrivateChat(
      stringParam(params, 'botRef').trim(), requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'bots.private-chat.refresh': return await service.refreshBotPrivateChat(
      stringParam(params, 'botRef').trim(), requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'bots.private-chat.directory': return await service.listBotPrivateChatDirectory(
      requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'bots.private-chat.send': return await service.sendBotPrivateChatMessage(
      stringParam(params, 'botRef').trim(), stringParam(params, 'content'),
      requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'bots.private-chat.mark-read': return await service.markBotPrivateChatRead(
      stringParam(params, 'botRef').trim(), numberParam(params, 'sequence', 0),
      requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'unmarked-speakers.options': return await service.unmarkedSpeakerOptions(
      stringParam(params, 'candidateRef').trim(),
    )
    case 'unmarked-speakers.retry-inference': return await service.retryUnmarkedSpeakerInference(
      stringParam(params, 'candidateRef').trim(),
    )
    case 'unmarked-speakers.segments': {
      const cursor = stringParam(params, 'cursor').trim()
      return await service.unmarkedSpeakerSegments(
        stringParam(params, 'candidateRef').trim(),
        { limit: directoryLimitParam(params), ...(cursor === '' ? {} : { cursor }) },
      )
    }
    case 'unmarked-speakers.mark': return await service.markUnmarkedSpeaker(
      unmarkedSpeakerMarkInputParam(params),
    )
    case 'group.create': return await service.createGroup(
      stringParam(params, 'title'),
      stringParam(params, 'clientMutationId'),
    )
    case 'bots.create': {
      const avatar = botAvatarParam(params)
      return await service.createBotSummary({
        name: stringParam(params, 'name'),
        provider: botProviderParam(params),
        ...(stringParam(params, 'description').trim() === ''
          ? {}
          : { description: stringParam(params, 'description') }),
        ...(avatar === '' ? {} : { avatar }),
      })
    }
    case 'bots.list': return await service.listBots(requestSignal === undefined ? {} : { signal: requestSignal })
    case 'bots.manage.profile': return await service.manageBotProfile(
      stringParam(params, 'botRef').trim(), requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'bots.manage.update': return await service.updateManagedBot(
      stringParam(params, 'botRef').trim(), botManageUpdateInputParam(params), requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'bots.manage.reveal-token': return await service.revealManagedBotToken(
      stringParam(params, 'botRef').trim(), requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'bots.manage.delete': return await service.deleteManagedBot(
      stringParam(params, 'botRef').trim(), stringParam(params, 'confirmationName'), requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'bots.private-chat.notification.status': return await service.botNotificationPreference(
      stringParam(params, 'botRef').trim(), requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'bots.private-chat.notification.update': return await service.updateBotNotificationPreference(
      stringParam(params, 'botRef').trim(), booleanParam(params, 'muted'), requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'recordings.calendar': return await service.recordingCalendar(
      numberParam(params, 'fromStamp', 0),
      numberParam(params, 'toStamp', 0),
    )
    case 'recordings.day': return await service.recordingDay(numberParam(params, 'dateStamp', 0))
    case 'calendar.buckets': return await service.calendarBuckets({
      startDate: stringParam(params, 'startDate'),
      endDate: stringParam(params, 'endDate'),
      ...(stringParam(params, 'timezone') === '' ? {} : { timezone: stringParam(params, 'timezone') }),
    })
    case 'calendar.records': {
      const cursor = cursorParam(params)
      return await service.calendarRecords({
        bucketDate: stringParam(params, 'bucketDate'),
        limit: numberParam(params, 'limit', 20),
        ...(stringParam(params, 'timezone') === '' ? {} : { timezone: stringParam(params, 'timezone') }),
        ...(cursor === undefined ? {} : { cursor }),
      })
    }
    case 'search.records': return await service.searchRemote({
      query: stringParam(params, 'query'),
      limit: numberParam(params, 'limit', 20),
      ...(stringParam(params, 'cursor') === '' ? {} : { cursor: stringParam(params, 'cursor') }),
      ...(['topic', 'chat_session'].includes(stringParam(params, 'searchScope'))
        ? { searchScope: stringParam(params, 'searchScope') as 'topic' | 'chat_session' }
        : {}),
      ...(stringParam(params, 'sourceUid') === '' ? {} : { sourceUid: stringParam(params, 'sourceUid') }),
    })
    case 'images.list': return await service.searchImages({
      limit: numberParam(params, 'limit', 20),
      ...(stringParam(params, 'cursor') === '' ? {} : { cursor: stringParam(params, 'cursor') }),
    })
    case 'search.scene': {
      const scene = stringParam(params, 'scene') as ArkmeSearchSceneKind
      const limit = numberParam(params, 'limit', 20)
      const cursor = stringParam(params, 'cursor')
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
    case 'user.arkme-id.check': return await service.checkArkmeIdAvailability(stringParam(params, 'arkmeId'))
    case 'user.arkme-id.set': return await service.setArkmeIdOnce(stringParam(params, 'arkmeId'))
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
    case 'world.mine': return await service.listMyWorldFeed({
      limit: Math.min(20, Math.max(1, Math.trunc(numberParam(params, 'limit', 20)))),
      offset: Math.max(0, Math.trunc(numberParam(params, 'offset', 0))),
    })
    case 'world.user': {
      const userId = Math.trunc(numberParam(params, 'userId', 0))
      if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw new ArkmePluginError('world-user-id-invalid', '世界用户 ID 无效，请刷新后重试', false, 400)
      }
      return await service.listUserWorldFeed(userId, {
        limit: Math.min(20, Math.max(1, Math.trunc(numberParam(params, 'limit', 20)))),
        offset: Math.max(0, Math.trunc(numberParam(params, 'offset', 0))),
      })
    }
    case 'world.author-labels': return await service.worldAuthorLabels(
      [...new Set(stringListParam(params, 'authorRefs').map(value => value.trim()).filter(value => value !== ''))].slice(0, 20),
      requestSignal,
    )
    case 'chat.world.private.open': return await service.openPrivateChatFromWorldAuthor(
      stringParam(params, 'authorRef').trim(),
      requestSignal,
    )
    case 'world.voiceprint.availability': return await service.worldVoiceprintPlaybackAvailability(
      [...new Set(stringListParam(params, 'recordRefs').map(value => value.trim()).filter(value => value !== ''))].slice(0, 20),
    )
    case 'world.voiceprint.playback.generate': return await service.generateWorldVoiceprintPlayback({
      recordRef: stringParam(params, 'recordRef').trim(),
      chunkIndex: Math.min(333, Math.max(0, Math.trunc(numberParam(params, 'chunkIndex', 0)))),
      ...(requestSignal === undefined ? {} : { signal: requestSignal }),
    })
    case 'world.voiceprint.social-context': return await service.worldVoiceprintSocialContext(
      stringParam(params, 'recordRef').trim(),
      { forceRefresh: params?.forceRefresh === true },
    )
    case 'world.voiceprint.invite': return await service.inviteWorldVoiceprint(
      stringParam(params, 'recordRef').trim(),
    )
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
    case 'world.publish-text': return await service.publishWorldText({
      clientMutationId: stringParam(params, 'clientMutationId'),
      textContent: stringParam(params, 'textContent'),
    })
    case 'world.publish-file-assets': return await service.publishWorldFileAssets({
      clientMutationId: stringParam(params, 'clientMutationId'),
      textContent: stringParam(params, 'textContent'),
      fileAssets: worldPublishFileAssetsParam(params),
    })
    case 'dsh-beta-community.entry-state': return await service.dshBetaCommunityEntryState()
    case 'dsh-beta-community.join': return await service.joinDSHBetaCommunity()
    case 'topic.create': return await service.createTopic(
      stringParam(params, 'title'),
      stringParam(params, 'parentSourceRef') || undefined,
    )
    case 'topic.rename': return await service.renameTopic(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'title'),
    )
    case 'topic.dissolve': return await service.dissolveTopic(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'parentSourceRef') || undefined,
      stringListParam(params, 'childSourceRefs'),
      stringParam(params, 'requestId') || undefined,
      numberParam(params, 'expectedRecordCount', 0),
    )
    case 'topic.dissolve.status': return await service.topicDissolveStatus(stringParam(params, 'requestId')) ?? null
    case 'topic.dissolve.active': return await service.activeTopicDissolve() ?? null
    case 'topic.hierarchy.move': return await service.moveTopicHierarchy(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'currentParentSourceRef') || undefined,
      stringParam(params, 'nextParentSourceRef') || undefined,
      stringParam(params, 'insertBeforeSourceRef') || undefined,
    )
    case 'sources.list': return await service.listSources(
      stringParam(params, 'directory') as ArkmeSourceDirectory,
      {
        limit: numberParam(params, 'limit', 30),
        ...(stringParam(params, 'cursor') === '' ? {} : { cursor: stringParam(params, 'cursor') }),
        refresh: booleanParam(params, 'refresh'),
      },
    )
    case 'source.directory.policy.set': return await service.setChatDirectoryPolicy(
      stringParam(params, 'sourceRef'),
      {
        ...(typeof params.pinned === 'boolean' ? { pinned: params.pinned } : {}),
        ...(typeof params.hidden === 'boolean' ? { hidden: params.hidden } : {}),
        ...(requestSignal === undefined ? {} : { signal: requestSignal }),
      },
    )
    case 'source.timeline': {
      const cursor = timelineCursorParam(params)
      return await service.readSource(
        stringParam(params, 'sourceRef'),
        { limit: numberParam(params, 'limit', 30), ...(cursor === undefined ? {} : { cursor }) },
      )
    }
    case 'source.timeline-around': return await service.readSourceAround(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'itemUid'),
      numberParam(params, 'recordOwnerUserId', 0),
      {
        beforeLimit: numberParam(params, 'beforeLimit', 20),
        afterLimit: numberParam(params, 'afterLimit', 20),
        ...(requestSignal === undefined ? {} : { signal: requestSignal }),
      },
    )
    case 'source.members': return await service.listSourceMembers(
      stringParam(params, 'sourceRef'),
      { activeOnly: params.activeOnly !== false },
    )
    case 'source.member-records': return await service.sourceMemberRecords(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'memberRef'),
      conversationMemberRecordModeParam(params),
      {
        limit: numberParam(params, 'limit', 30),
        beforeSequence: numberParam(params, 'beforeSequence', 0),
      },
    )
    case 'source.interwoven-moments': return await service.interwovenMoments(
      requiredInterwovenParam(params, 'sourceRef'),
    )
    case 'source.interwoven-detail': return await service.interwovenMomentDetail(
      requiredInterwovenParam(params, 'sourceRef'),
      requiredInterwovenParam(params, 'momentRef'),
    )
    case 'source.related-quick-notes.from-message': return await service.relatedQuickNotesFromMessage(
      requiredRelatedQuickNoteParam(params, 'sourceRef'),
      requiredRelatedQuickNoteParam(params, 'messageActionRef', MAX_MESSAGE_ACTION_REF_CHARS),
      requestSignal,
    )
    case 'source.related-quick-notes.from-moment': return await service.relatedQuickNotesFromMoment(
      requiredRelatedQuickNoteParam(params, 'sourceRef'),
      requiredRelatedQuickNoteParam(params, 'momentRef'),
      requestSignal,
    )
    case 'source.related-quick-note.detail': return await service.relatedQuickNoteDetail(
      requiredRelatedQuickNoteParam(params, 'sourceRef'),
      requiredRelatedQuickNoteParam(params, 'relatedRef'),
      requestSignal,
    )
    case 'source.mark-read': return await service.markSourceRead(
      stringParam(params, 'sourceRef'),
      numberParam(params, 'readSequence', 0),
    )
    case 'source.read-receipts.summary-list': return await service.messageReadReceiptSummaries(
      stringParam(params, 'sourceRef'),
      messageReadReceiptItemsParam(params),
      requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'source.read-receipts.detail': return await service.messageReadReceiptDetail(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'itemUid'),
      numberParam(params, 'sequence', 0),
      requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'source.message-copy-link': return await service.copySourceMessageLink(
      stringParam(params, 'sourceRef'),
      messageActionRefsParam(params),
      requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'source.message-copy-link.resolve': return await service.resolveMessageCopyLink(
      stringParam(params, 'sid'),
      requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'source.message-copy-link.extend': return await service.extendMessageCopyLink(
      stringParam(params, 'sid'),
      numberParam(params, 'itemIndex', 0),
      stringParam(params, 'textContent'),
      stringParam(params, 'recordUid'),
      requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'source.message-extension.context': return await service.sourceMessageExtensionContext(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'messageActionRef'),
      requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'source.message-extension.extend': return await service.extendSourceMessage(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'messageActionRef'),
      stringParam(params, 'textContent'),
      stringParam(params, 'recordUid'),
      [...new Set(stringListParam(params, 'fileRefs').map(value => value.trim()).filter(value => value !== ''))],
      {
        ...(stringParam(params, 'relationUid') === '' ? {} : { relationUid: stringParam(params, 'relationUid') }),
        ...(stringParam(params, 'parentRecordUid') === '' ? {} : { parentRecordUid: stringParam(params, 'parentRecordUid') }),
        ...(requestSignal === undefined ? {} : { signal: requestSignal }),
      },
    )
    case 'source.shared-recording-detail': return await service.sharedRecordingDetail(
      stringParam(params, 'detailRef'),
      requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'source.message-snapshot.detail': return await service.messageSnapshotDetail(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'actionRef'),
      requestSignal === undefined ? {} : { signal: requestSignal },
    )
    case 'source.message-location.set': {
      await service.saveMessageLocation(
        stringParam(params, 'sourceRef'),
        stringParam(params, 'itemUid'),
        recordLocationCaptureParam(params),
        numberParam(params, 'recordVersion', 0) || undefined,
        requestSignal === undefined ? {} : { signal: requestSignal },
      )
      return { ok: true }
    }
    case 'source.forward-messages': return await service.forwardSourceMessages(
      stringParam(params, 'sourceRef'),
      messageActionRefsParam(params),
      {
        ...(stringParam(params, 'targetSourceRef') === '' ? {} : { targetSourceRef: stringParam(params, 'targetSourceRef') }),
        ...(stringParam(params, 'recordUid') === '' ? {} : { recordUid: stringParam(params, 'recordUid') }),
        ...(stringParam(params, 'relationUid') === '' ? {} : { relationUid: stringParam(params, 'relationUid') }),
        ...(stringParam(params, 'commentText') === '' ? {} : { commentText: stringParam(params, 'commentText') }),
        ...(requestSignal === undefined ? {} : { signal: requestSignal }),
      },
    )
    case 'source.send-text': {
      const botRefs = botRefsParam(params)
      const humanMentions = humanMentionsParam(params)
      const botMentions = botMentionsParam(params)
      const captureContext = captureContextParam(params)
      return await service.sendSourceText(
        stringParam(params, 'sourceRef'),
        stringParam(params, 'textContent'),
        {
          ...(stringParam(params, 'recordUid') === '' ? {} : { recordUid: stringParam(params, 'recordUid') }),
          ...(stringParam(params, 'relationUid') === '' ? {} : { relationUid: stringParam(params, 'relationUid') }),
          ...(numberParam(params, 'recordDurationMillis', 0) <= 0 ? {} : { recordDurationMillis: Math.max(0, Math.trunc(numberParam(params, 'recordDurationMillis', 0))) }),
          ...(captureContext === undefined ? {} : { captureContext }),
          ...(booleanParam(params, 'agentAuthored') ? { agentAuthored: true } : {}),
          ...(botRefs.length === 0 ? {} : { botRefs }),
          ...(humanMentions.length === 0 ? {} : { humanMentions }),
          ...(botMentions.length === 0 ? {} : { botMentions }),
        },
      )
    }
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
      {
        threadMessages: aiPolishThreadMessagesParam(params),
        ...(stringParam(params, 'targetRuleRef').trim() === '' ? {} : { targetRuleRef: stringParam(params, 'targetRuleRef').trim() }),
      },
    )
    case 'source.ai-polish.prepare-enable': return await service.prepareEnableGroupAiPolishRuleForSource(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'ruleRef'),
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
    case 'group.member-candidates': return await service.listGroupMemberCandidates(
      stringParam(params, 'sourceRef'),
      {
        ...(stringParam(params, 'query') === '' ? {} : { query: stringParam(params, 'query') }),
        limit: numberParam(params, 'limit', 20),
        ...(stringListParam(params, 'groupSourceRefs').length === 0 ? {} : { groupSourceRefs: stringListParam(params, 'groupSourceRefs') }),
      },
    )
    case 'group.invite-preview': return await service.groupInvitePreview(
      stringParam(params, 'sourceRef'),
    )
    case 'group.members.add': return await service.addGroupMembers(
      stringParam(params, 'sourceRef'),
      stringListParam(params, 'candidateRefs'),
    )
    case 'group.bots': return await service.listGroupBots(
      stringParam(params, 'sourceRef'),
    )
    case 'group.bot.add': return await service.addGroupBot(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'botRef'),
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
    case 'chat.private.open-from-contact': return await service.openPrivateChatFromContact(
      stringParam(params, 'contactRef'),
    )
    case 'chat.official-author.profile': return await service.officialAuthorProfile()
    case 'chat.official-author.private.open': return await service.openOfficialAuthorPrivateChat()
    case 'chat.member.private.open': return await service.openPrivateChatFromMember(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'memberRef'),
    )
    case 'files.capabilities': return service.fileCapabilities()
    case 'files.local.list': return await service.fileList()
    case 'files.local.open': return await service.fileOpenLocal(stringParam(params, 'fileRef'))
    case 'files.local.remove': await service.fileRemove(stringParam(params, 'fileRef')); return { removed: true }
    case 'files.search': return await service.fileSearch({ query: stringParam(params, 'query'), limit: numberParam(params, 'limit', 30), cursor: stringParam(params, 'cursor') })
    case 'files.send.tasks': return await service.fileSendTasks(stringParam(params, 'sourceRef') || undefined)
    case 'files.send.retry': return await service.fileSendRetry(stringParam(params, 'taskRef'))
    case 'files.send.discard': return await service.fileSendDiscard(stringParam(params, 'taskRef'))
    case 'files.send.reconcile': return await service.fileSendReconcile(stringParam(params, 'taskRef'))
    case 'files.stage-bytes': return await service.fileStageBytes(stringParam(params, 'contentBase64'), { fileName: stringParam(params, 'fileName'), mimeType: stringParam(params, 'mimeType') || 'application/octet-stream' })
    case 'files.receive': return await service.fileReceive(stringParam(params, 'mediaRef'), booleanParam(params, 'start'))
    case 'files.send': return await service.fileSend({
      sourceRef: stringParam(params, 'sourceRef'), recordUid: stringParam(params, 'recordUid'), relationUid: stringParam(params, 'relationUid'),
      fileRefs: stringListParam(params, 'fileRefs'), content: richSendParam(params),
    })
    case 'source.send-rich': return await service.sendSourceRich(
      stringParam(params, 'sourceRef'),
      richSendParam(params),
      {
        ...(stringParam(params, 'recordUid') === '' ? {} : { recordUid: stringParam(params, 'recordUid') }),
        ...(stringParam(params, 'relationUid') === '' ? {} : { relationUid: stringParam(params, 'relationUid') }),
      },
    )
    case 'favorite-stickers.list': return await service.favoriteStickers()
    case 'favorite-stickers.add': return await service.addFavoriteSticker(favoriteStickerItemParam(params))
    case 'favorite-stickers.send': return await service.sendFavoriteSticker(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'fileAssetUid'),
      {
        ...(stringParam(params, 'recordUid') === '' ? {} : { recordUid: stringParam(params, 'recordUid') }),
        ...(stringParam(params, 'relationUid') === '' ? {} : { relationUid: stringParam(params, 'relationUid') }),
      },
    )
    case 'favorite-stickers.manage': return await service.manageFavoriteSticker(
      stringParam(params, 'fileAssetUid'), favoriteStickerManageActionParam(params),
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
    case 'calls.outgoing.diag': {
      console.info('dsh-arkme: call_diag browser', {
        label: outgoingDiagTextParam(params, 'label', 200),
        detail: outgoingDiagTextParam(params, 'detail', 4_000),
      })
      return { ok: true }
    }
    case 'calls.history.list': return await service.listCallHistory({
      limit: numberParam(params, 'limit', 20),
      ...(stringParam(params, 'cursor').trim() === '' ? {} : { cursor: stringParam(params, 'cursor').trim() }),
      includeRecentContacts: params.includeRecentContacts !== false,
    })
    case 'calls.history.detail': return await service.callDetail(
      requiredCallParam(params, 'callRef', 'call-ref-invalid', 4096),
    )
    case 'calls.history.summary.retry': return await service.retryCallSummary(
      requiredCallParam(params, 'callRef', 'call-ref-invalid', 4096),
    )
    case 'extensions.catalog.list': {
      const sort = extensionCatalogSortParam(params)
      const ownerUserId = numberParam(params, 'ownerUserId', 0)
      if (ownerUserId !== 0 && (!Number.isSafeInteger(ownerUserId) || ownerUserId < 0)) {
        throw new ArkmePluginError('extension-catalog-owner-invalid', '市集作者筛选参数无效', false, 400)
      }
      return await enrichExtensionPageAuthors(service, await requireExtensionManager(extensionManager).searchCatalog({
        query: stringParam(params, 'query'),
        cursor: stringParam(params, 'cursor'),
        limit: numberParam(params, 'limit', 20),
        ...(sort === undefined ? {} : { sort }),
        ...(ownerUserId === 0 ? {} : { ownerUserId }),
        ...(stringParam(params, 'excludeExtensionId').trim() === '' ? {} : {
          excludeExtensionId: stringParam(params, 'excludeExtensionId').trim(),
        }),
      }))
    }
    case 'extensions.classification.tree': return await requireExtensionManager(extensionManager).classificationTree(
      numberParam(params, 'limit', 30),
    )
    case 'extensions.classification.items': {
      const sort = extensionCatalogSortParam(params)
      return await enrichExtensionPageAuthors(service, await requireExtensionManager(extensionManager).classificationItems({
        categoryId: stringParam(params, 'categoryId'),
        query: stringParam(params, 'query'),
        cursor: stringParam(params, 'cursor'),
        limit: numberParam(params, 'limit', 20),
        ...(sort === undefined ? {} : { sort }),
      }))
    }
    case 'extensions.catalog.detail': {
      const item = await requireExtensionManager(extensionManager).inspect(stringParam(params, 'extensionId'))
      return (await enrichExtensionAuthors(service, [item]))[0]
    }
    case 'extensions.audit.check': return await requireExtensionManager(extensionManager).auditExtension({
      extensionId: stringParam(params, 'extensionId'),
      trigger: 'market_detail',
    })
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
	case 'extensions.share.detail': return await requireExtensionManager(extensionManager).readSharedDetail(
		stringParam(params, 'shareRef'),
	)
	case 'extensions.share.resolve': {
		const item = await requireExtensionManager(extensionManager).resolveSharedCatalogDetail(stringParam(params, 'shareRef'))
		return (await enrichExtensionAuthors(service, [item]))[0]
	}
    case 'extensions.delete': return await requireOwnedExtensionInventory(ownedExtensionInventory).delete({
      extensionId: stringParam(params, 'extensionId'),
    })
    case 'extensions.installed-list': return requireExtensionManager(extensionManager).listInstalled()
    case 'extensions.quarantine.status': return await requireDesktopQuarantine(desktopQuarantine).status()
    case 'extensions.quarantine.dismiss': return await requireDesktopQuarantine(desktopQuarantine).dismiss(
      stringParam(params, 'packageName'),
    )
    case 'extensions.quarantine.reenable': return await requireDesktopQuarantine(desktopQuarantine).reenable(
      stringParam(params, 'packageName'),
    )
    case 'extensions.quarantine.health': return await requireDesktopQuarantine(desktopQuarantine).health(
      stringParam(params, 'packageName'),
    )
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
    case 'extensions.client.failure': return await requireExtensionManager(extensionManager).reportClientFailure({
      identityKey: stringParam(params, 'identityKey'),
      extensionId: stringParam(params, 'extensionId'),
      version: stringParam(params, 'version'),
      clientInstanceKey: stringParam(params, 'clientInstanceKey'),
      clientContentDigest: stringParam(params, 'clientContentDigest'),
      clientOwnerKey: stringParam(params, 'clientOwnerKey'),
      kind: stringParam(params, 'kind'),
      message: stringParam(params, 'message'),
    })
    case 'extensions.persistent.client-state': return requireExtensionManager(extensionManager).persistentClientState(
      stringParam(params, 'extensionId'),
      stringParam(params, 'version'),
    )
    case 'extensions.bundle.client-state': return requireExtensionManager(extensionManager).bundleClientState(
      stringParam(params, 'packageName'),
      stringParam(params, 'version'),
      stringParam(params, 'clientContentDigest'),
    )
    case 'extensions.persistent.invoke': {
      const extensionId = stringParam(params, 'extensionId')
      const version = stringParam(params, 'version')
      const state = requireExtensionManager(extensionManager).persistentClientState(extensionId, version)
      if (!state.mount) {
        throw new ArkmePluginError('extension-runtime-unavailable', '插件不可用，请重启 DSH 后重试', false, 409)
      }
      return await invokePersistentArkmeExtension(extensionId, stringParam(params, 'method'), params.args)
    }
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

function requireRemoteHost(host: DshRemoteHostFacade | undefined): DshRemoteHostFacade {
  if (host === undefined) throw new ArkmePluginError('CAPABILITY_UNSUPPORTED', '当前 DSH 未加载远控 Host', false, 503)
  return host
}

function requireExtensionInstallTasks(tasks: ArkmeExtensionInstallTasks | undefined): ArkmeExtensionInstallTasks {
  if (tasks === undefined) {
    throw new ArkmePluginError('extension-runtime-unavailable', '当前 DSH 未加载扩展安装运行时', false, 503)
  }
  return tasks
}

function requireExtensionManager(manager: ArkmeExtensionManager | undefined): ArkmeExtensionManager {
  if (manager === undefined) {
    throw new ArkmePluginError('extension-runtime-unavailable', '当前 DSH 未加载 Dynamic Cordis Runner，市集不可用', false, 503)
  }
  return manager
}

function requireDesktopQuarantine(
  quarantine: Pick<ArkmeDesktopExtensionQuarantine, 'status' | 'dismiss' | 'reenable' | 'health'> | undefined,
): Pick<ArkmeDesktopExtensionQuarantine, 'status' | 'dismiss' | 'reenable' | 'health'> {
  if (quarantine === undefined) {
    throw new ArkmePluginError('extension-runtime-unavailable', '桌面扩展恢复状态尚未就绪', false, 503)
  }
  return quarantine
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
