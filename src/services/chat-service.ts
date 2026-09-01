import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeConversationMemberJoinEvent,
  ArkmeConversationMemberItem,
  ArkmeConversationMemberList,
  ArkmeConversationMemberRecordMode,
  ArkmeConversationMemberRecordPage,
  ArkmeBotMentionInput,
  ArkmeBotConversation,
  ArkmeBotConversationMessage,
  ArkmeBotConversationReadResult,
  ArkmeBotConversationSendResult,
  ArkmeBotNotificationPreference,
  ArkmeDirectTextSendResult,
  ArkmeForwardRecordPreviewItem,
  ArkmeFavoriteSticker,
  ArkmeFavoriteStickerList,
  ArkmeFavoriteStickerAddInput,
  ArkmeFavoriteStickerManageAction,
  ArkmeForwardTranscriptSegment,
  ArkmeGroupAiPolishNotice,
  ArkmeGroupAiPolishSnapshot,
  ArkmeGroupMemberRole,
  ArkmeGroupMemberStatus,
  ArkmeHumanMentionInput,
  ArkmeLongArticleDetail,
  ArkmeLongArticleDraft,
  ArkmeMessageCopyLinkExtendResult,
  ArkmeMessageCopyLinkExtensionItem,
  ArkmeMessageCopyLinkRecordContext,
  ArkmeMessageCopyLinkResult,
  ArkmeMessageCopyLinkResolveResult,
  ArkmeMessageCopyLinkPresentationNode,
  ArkmeMessageCopyLinkSnapshotItem,
  ArkmeMessageCopyLinkSourceAnchor,
  ArkmeMessageSnapshotDetail,
  ArkmeMessageReadReceiptDetail,
  ArkmeMessageReadReceiptQueryItem,
  ArkmeMessageReadReceiptSummary,
  ArkmeMessageReadReceiptSummaryList,
  ArkmeMessageReportResult,
  ArkmeOfficialAuthorProfile,
  ArkmeOpenPrivateChatResult,
  ArkmeRichSendInput,
  ArkmeRecordCaptureContext,
  ArkmeRecordLocationCapture,
  ArkmeSourceItem,
  ArkmeSourceReadResult,
  ArkmeSourceSendResult,
  ArkmeSharedRecordingParticipant,
  ArkmeSharedRecordingPreview,
  ArkmeTimelineCursor,
  ArkmeTimelineItem,
  ArkmeTimelinePage,
  ArkmeUploadedAsset,
} from '../types.js'
import { ARKME_MESSAGE_READ_RECEIPT_MAX_ITEMS } from '../types.js'
import { ArkoService } from './arko-service.js'
import { BotService } from './bot-service.js'
import { GroupAiPolishService } from './group-ai-polish-service.js'
import { MediaService, type ArkmeMediaDescriptor } from './media-service.js'
import { MessageActionService } from './message-action-service.js'
import { ProfileService } from './profile-service.js'
import { ArkmePrivacyVisibilityService, arkmePrivacyLockedRecord, arkmePrivacyLockedTopic } from './privacy-visibility.js'
import { arkmeRecordCaptureContextPayload, RecordService } from './record-service.js'
import type { ArkmeRelatedQuickNoteSourceLocator } from './related-quick-note-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'
import { arkmeMentionMetadataMentionsViewer } from '../mention-metadata.js'
import {
  SourceService,
  type ArkmeSourceRefPayload,
} from './source-service.js'

interface ArkmeMessageRefPayload {
  version: 1
  userId: number
  chatSessionUid: string
  relationUid: string
}

interface ArkmeMessageActionRefPayload {
  version: 1
  sourceKind: 'chat_relation' | 'record'
  userId: number
  sourceOwnerRef: string
  chatSessionUid: string
  relationUid: string
  recordOwnerUserId: number
  recordUid: string
  senderUserId: number
  senderName: string
  title: string
  textContent: string
  sendAtMillis: number
  sourceSequence: number
  templateKind: number
  displayKind: number
  imageCount: number
  voiceCount: number
  fileCount: number
  fileNames: string[]
}

interface ArkmeSharedRecordingDetailRefPayload {
  version: 1
  viewerUserId: number
  chatSessionUid: string
  relationUid: string
  recordOwnerUserId: number
  recordUid: string
  sequence: number
}

interface ArkmeChatMemberRefPayload {
  version: 1
  viewerUserId: number
  chatSessionUid: string
  targetUserId: number
}

interface ArkmeChatHumanMentionRefPayload {
  version: 1
  viewerUserId: number
  chatSessionUid: string
  targetUserId: number
  displayNameSnapshot: string
}

interface OfficialAuthorPrivateChatCreateResult {
  rm_subject_id?: unknown
  already_exist?: unknown
}

// Mirrors the mobile contact-author backend contract used by /api/v1/private/create-chat-ref-asen.
const OFFICIAL_AUTHOR_USER_ID = 11
const OFFICIAL_AUTHOR_FALLBACK_DISPLAY_NAME = '即' + '我作者'
const MAX_MESSAGE_COPY_LINK_ITEMS = 100
const RECORD_UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CHAT_MEMBER_REF_PREFIX = 'arkme-chat-member-v1'
const CHAT_HUMAN_MENTION_REF_PREFIX = 'arkme-chat-human-mention-v1'

export interface ArkmeChatRealtimePort {
  emitChatClientEvent(event: Parameters<import('./chat-realtime-service.js').ChatRealtimeService['emitChatClientEvent']>[0]): void
  nextChatClientRevision(): number
  scheduleChatSessionProjection(chatSessionUid: string, latestSequence: number): void
  invalidateRecordProjection(): Promise<void>
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function finiteNumberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function positiveNumberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = finiteNumberValue(value)
    if (parsed !== undefined && parsed > 0) return parsed
  }
  return undefined
}

function nonNegativeNumberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = finiteNumberValue(value)
    if (parsed !== undefined && parsed >= 0) return parsed
  }
  return undefined
}

function booleanValue(value: unknown): boolean { return value === true }

function timelineCaptureContext(payload: Record<string, unknown>): ArkmeRecordCaptureContext | undefined {
  const raw = objectValue(payload.capture_context ?? payload.captureContext)
  const clientName = stringValue(raw.client_name ?? raw.clientName ?? payload.client_name ?? payload.clientName ?? payload.device_name ?? payload.deviceName).trim()
  const networkName = stringValue(raw.network_name ?? raw.networkName ?? payload.network_name ?? payload.networkName ?? payload.network).trim()
  const electricity = objectValue(payload.electricity)
  const electricValue = finiteNumberValue(raw.electric ?? payload.electric ?? electricity.electric)
  const electric = electricValue === undefined ? undefined : Math.trunc(electricValue)
  const charge = Math.trunc(numberValue(raw.charge ?? payload.charge ?? electricity.charge))
  const context: ArkmeRecordCaptureContext = {
    ...(clientName === '' ? {} : { clientName }),
    ...(networkName === '' ? {} : { networkName }),
    ...(electric === undefined || electric < 0 || electric > 100 ? {} : { electric }),
    ...(charge < 1 || charge > 3 ? {} : { charge }),
  }
  return Object.keys(context).length === 0 ? undefined : context
}

function epochMillis(value: unknown): number | undefined {
  const parsed = finiteNumberValue(value)
  if (parsed === undefined || parsed <= 0) return undefined
  return Math.trunc(parsed < 100_000_000_000 ? parsed * 1_000 : parsed)
}

/**
 * Record lifecycle timestamps are canonical fields of the record itself.
 * Payload and extra metadata may carry stale (or zero) copies, so they can
 * only be used as a final fallback. This matches the Flutter record parser,
 * which creates the Record timestamp model from record_core first.
 */
function firstRecordEpochMillis(
  sources: readonly Record<string, unknown>[],
  keys: readonly string[],
): number | undefined {
  for (const source of sources) {
    for (const key of keys) {
      const value = epochMillis(source[key])
      if (value !== undefined) return value
    }
  }
  return undefined
}

function firstSnapshotText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stringValue(value).trim()
    if (text !== '') return text
  }
  return undefined
}

function snapshotDateLabel(value: number | undefined): string | undefined {
  if (value === undefined) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function snapshotMovement(value: Record<string, unknown>): string | undefined {
  const rawSpeed = value.speed ?? value.speed_mps ?? value.speedMetersPerSecond
  const speed = numberValue(rawSpeed)
  if (typeof rawSpeed === 'number' && Number.isFinite(rawSpeed)) {
    const kmh = Math.round(speed * 3.6)
    return kmh <= 2 ? '静止' : kmh <= 5 ? `缓慢移动（${String(kmh)}km/h）` : kmh <= 60 ? `移动（${String(kmh)}km/h）` : `高速移动（${String(kmh)}km/h）`
  }
  if (typeof value.activity !== 'number' || !Number.isFinite(value.activity)) return undefined
  const activity = Math.trunc(value.activity)
  return activity === 0 ? '静止' : activity === 1 ? '步行' : activity === 2 ? '跑步' : activity === 3 ? '骑行' : activity === 4 ? '驾车' : undefined
}

function snapshotLocationCapture(value: Record<string, unknown>): ArkmeRecordLocationCapture | undefined {
  const latitude = finiteNumberValue(value.lat ?? value.latitude)
  const longitude = finiteNumberValue(value.lon ?? value.lng ?? value.longitude)
  if (latitude === undefined || longitude === undefined || (latitude === 0 && longitude === 0)) return undefined
  const altitudeMeters = nonNegativeNumberValue(value.alt ?? value.altitude ?? value.altitude_meters)
  const accuracyMeters = nonNegativeNumberValue(value.accuracy ?? value.accuracy_meters ?? value.accuracyMeters)
  const speedMetersPerSecond = nonNegativeNumberValue(value.speed ?? value.speed_mps ?? value.speedMetersPerSecond)
  const capturedAtMillis = epochMillis(value.captured_at ?? value.capturedAt) ?? Date.now()
  return {
    latitude, longitude, capturedAtMillis,
    ...(accuracyMeters === undefined ? {} : { accuracyMeters }),
    ...(altitudeMeters === undefined ? {} : { altitudeMeters }),
    ...(speedMetersPerSecond === undefined ? {} : { speedMetersPerSecond }),
  }
}

function snapshotWeatherText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const direct = stringValue(value).trim()
    if (direct !== '') return direct
    const weather = objectValue(value)
    if (Object.keys(weather).length === 0) continue
    const temperature = finiteNumberValue(weather.temp ?? weather.temperature)
    const condition = firstSnapshotText(
      weather.weather, weather.weatherText, weather.weather_text,
      weather.condition_ch, weather.conditionCh, weather.condition,
    )
    if (temperature !== undefined || condition !== undefined) {
      return `${temperature === undefined ? '' : `${String(Math.round(temperature))}°`}${temperature === undefined || condition === undefined ? '' : ' '}${condition ?? ''}`.trim()
    }
  }
  return undefined
}

function snapshotLocationContext(value: unknown): Record<string, unknown> {
  const root = objectValue(value)
  const nested = objectValue(root.data)
  const hasContext = (candidate: Record<string, unknown>): boolean => [
    candidate.location, candidate.position_detail, candidate.positionDetail, candidate.weather,
  ].some(entry => Object.keys(parsedObject(entry)).length > 0 || stringValue(entry).trim() !== '')
  return hasContext(root) || !hasContext(nested) ? root : nested
}

/**
 * `/records/detail` and `/records/location/context/get` intentionally split
 * their metadata. Flutter overlays the latter onto the former, retaining
 * every existing location field while allowing its resolved weather and
 * address to win. Keep that same shape before projecting the dialog detail.
 */
function mergeSnapshotLocationContext(
  raw: Record<string, unknown>,
  contextValue: unknown,
): Record<string, unknown> {
  const context = snapshotLocationContext(contextValue)
  if (Object.keys(context).length === 0) return raw
  const location = {
    ...parsedObject(raw.location), ...parsedObject(raw.location_detail),
    ...parsedObject(context.location), ...parsedObject(context.location_detail),
  }
  const position = {
    ...parsedObject(raw.position_detail), ...parsedObject(raw.positionDetail),
    ...parsedObject(context.position_detail), ...parsedObject(context.positionDetail),
  }
  const weather = context.weather ?? context.weather_text ?? context.weatherText ?? raw.weather
  return {
    ...raw,
    ...(Object.keys(location).length === 0 ? {} : { location }),
    ...(Object.keys(position).length === 0 ? {} : { position_detail: position }),
    ...(weather === undefined ? {} : { weather }),
  }
}

function snapshotDetailFromChatRaw(raw: Record<string, unknown>, fallback: { itemUid: string; textContent: string; sendAtMillis: number }): ArkmeMessageSnapshotDetail {
  const relation = objectValue(raw.relation)
  // The mounted chat-record detail carries the complete record either at the
  // response root or inside `record`; retain both shapes for older messages.
  // Some older detail responses are the record itself rather than a wrapper
  // containing record_core. Flutter accepts that shape too.
  const recordCore = objectValue(raw.record_core ?? raw.recordCore ?? raw.record ?? raw)
  const nestedRecord = objectValue(raw.record)
  const record = { ...recordCore, ...nestedRecord }
  // The records/detail response intentionally keeps a few metadata families
  // at its root while the record core holds the normal timeline fields.  Do
  // not use nullish fallbacks here: several of those families can coexist.
  const rootPayload = {
    ...parsedObject(raw.payload), ...parsedObject(raw.content_payload), ...parsedObject(raw.contentPayload),
    ...parsedObject(raw.record_payload), ...parsedObject(raw.recordPayload),
  }
  const recordPayload = {
    ...parsedObject(record.payload), ...parsedObject(record.content_payload), ...parsedObject(record.contentPayload),
    ...parsedObject(record.record_payload), ...parsedObject(record.recordPayload),
  }
  const extra = {
    ...parsedObject(raw.extra), ...parsedObject(raw.record_extra), ...parsedObject(raw.recordExtra),
    ...parsedObject(raw.e), ...parsedObject(raw.i),
  }
  const recordExtra = {
    ...parsedObject(record.extra), ...parsedObject(record.record_extra), ...parsedObject(record.recordExtra),
    ...parsedObject(record.e), ...parsedObject(record.i),
  }
  const payload = { ...extra, ...recordExtra, ...rootPayload, ...recordPayload }
  // Root position/location data belongs to the hydrated records/detail
  // response and can be newer than the chat projection. Merge every variant
  // instead of letting a sparse nested object hide it.
  const position = {
    ...parsedObject(payload.position_detail), ...parsedObject(payload.positionDetail),
    ...parsedObject(record.position_detail), ...parsedObject(record.positionDetail),
    ...parsedObject(raw.position_detail), ...parsedObject(raw.positionDetail),
  }
  const location = { ...parsedObject(payload.location), ...parsedObject(record.location), ...parsedObject(raw.location) }
  const values = { ...raw, ...record, ...payload }
  const recordDurationMillis = positiveNumberValue(
    values.record_duration_millis, values.recordDurationMillis, values.cost_mill_sec, values.costMillSec,
  )
  const editDurationMillis = positiveNumberValue(
    values.edit_duration_millis, values.editDurationMillis, values.incr_cost_mill_sec, values.incrCostMillSec,
  )
  // Match Flutter's RecordTimestampPresenter: the record timestamps (rather
  // than the chat relation's attach time) describe the quick-memory lifecycle.
  // Crucially, the detailed core wins over any same-named entry embedded in
  // payload/extra metadata; those entries are frequently zero or stale.
  const lifecycleSources = [recordCore, nestedRecord, raw, payload]
  const startAtMillis = firstRecordEpochMillis(lifecycleSources, [
    // Match Flutter's canonical order exactly: create_at, then created_at,
    // then the send timestamp for older records that do not expose either.
    'create_at', 'created_at', 'createAt', 'createdAt', 'create_time', 'createTime',
    'create_time_stamp', 'createTimeStamp', 'create_timestamp', 'createTimestamp',
    'create_at_ms', 'createAtMillis', 'created_at_ms', 'createdAtMillis',
    // Flutter uses send_at as the last-resort create time for older records.
    'send_at', 'sendAt', 'send_time', 'sendTime', 'send_time_stamp', 'sendTimeStamp',
    'send_timestamp', 'sendTimestamp', 'send_at_ms', 'sendAtMillis',
  ]) ?? epochMillis(relation.attach_at ?? relation.attachAt)
  const sendAtMillis = firstRecordEpochMillis(lifecycleSources, [
    'send_at', 'sendAt', 'send_time', 'sendTime', 'send_time_stamp', 'sendTimeStamp',
    'send_timestamp', 'sendTimestamp', 'send_at_ms', 'sendAtMillis',
  ]) ?? epochMillis(relation.attach_at ?? relation.attachAt) ?? epochMillis(fallback.sendAtMillis)
  const updatedAtMillis = firstRecordEpochMillis(lifecycleSources, [
    'update_at', 'updated_at', 'updateAt', 'updatedAt', 'update_time_stamp', 'updateTimeStamp',
    'update_timestamp', 'updateTimestamp', 'update_at_ms', 'updateAtMillis',
  ])
  const completeAtMillis = updatedAtMillis !== undefined && updatedAtMillis > (sendAtMillis ?? 0)
    ? updatedAtMillis
    : sendAtMillis
  // update time is completion, not synchronization. Flutter only renders a
  // concrete sync timestamp from the dedicated upload timestamp field.
  const syncedAtMillis = firstRecordEpochMillis(lifecycleSources, [
    'upload_at', 'uploadAt', 'upload_timestamp', 'uploadTimeStamp', 'upload_time_stamp_v2',
    'uploadTimeStampV2', 'upload_at_v2', 'uploadAtV2', 'upload_at_ms', 'uploadAtMillis',
  ])
  const captureContext = timelineCaptureContext(values)
  const locationCapture = snapshotLocationCapture({ ...location, ...position, ...objectValue(values.position) })
  const locationLabel = firstSnapshotText(
    position.poi, position.poi_name, position.poiName, position.address, position.road,
    location.poi_name, location.poiName, location.address, location.name,
  )
  const weather = snapshotWeatherText(position.weather, position.weatherText, location.weather, values.weather)
  const altitudeMeters = nonNegativeNumberValue(location.altitude, location.alt, position.altitude, position.alt)
  const movement = snapshotMovement({ ...values, ...location, ...position })
  const backgroundFiles = [
    ...listValue(values.file_assets), ...listValue(values.fileAssets), ...listValue(values.media_items), ...listValue(values.mediaItems),
    ...listValue(values.media_refs), ...listValue(values.mediaRefs), ...listValue(values.media_display_items), ...listValue(values.mediaDisplayItems),
    ...listValue(values.files), ...listValue(values.attachments),
  ].map(objectValue)
  const backgroundSound = backgroundFiles.some(file => Math.trunc(numberValue(file.content_file_role ?? file.contentFileRole)) === 4)
    || backgroundFiles.some(file => Math.trunc(numberValue(file.binding_type ?? file.bindingType)) === 4)
    || listValue(values.background_sound_amplitudes ?? values.backgroundSoundAmplitudes).length > 0
    || listValue(parsedObject(values.background_sound ?? values.backgroundSound).amplitudes).length > 0
    ? 'available' as const
    : values.background_sound_enabled === false || values.backgroundSoundEnabled === false ? 'disabled' as const : 'not-recorded' as const
  const status = numberValue(values.status)
  const syncState = status === 2 ? 'syncing' as const : status < 0 ? 'failed' as const : syncedAtMillis !== undefined || status === 1 ? 'synced' as const : 'not-synced' as const
  const belongDate = snapshotDateLabel(startAtMillis ?? completeAtMillis)
  return {
    itemUid: firstSnapshotText(relation.record_uid, values.record_uid, raw.record_uid) ?? fallback.itemUid,
    // Prefer complete record-core content; a chat relation can carry an older
    // render payload while the user has since revised the original record.
    textContent: firstSnapshotText(record.text_content, record.textContent, values.text_content, values.textContent) ?? fallback.textContent,
    ...(recordDurationMillis === undefined ? {} : { recordDurationMillis }),
    ...(editDurationMillis === undefined ? {} : { editDurationMillis }),
    ...(numberValue(values.view_times ?? values.viewTimes) > 0 ? { viewTimes: Math.trunc(numberValue(values.view_times ?? values.viewTimes)) } : {}),
    ...(numberValue(values.share_times ?? values.shareTimes) > 0 ? { shareTimes: Math.trunc(numberValue(values.share_times ?? values.shareTimes)) } : {}),
    ...(captureContext === undefined ? {} : { captureContext }),
    backgroundSound,
    ...(locationLabel === undefined ? {} : { locationLabel }),
    ...(weather === undefined ? {} : { weather }),
    ...(altitudeMeters === undefined ? {} : { altitudeMeters }),
    ...(movement === undefined ? {} : { movement }),
    ...(belongDate === undefined ? {} : { belongDate }),
    ...(startAtMillis === undefined ? {} : { startAtMillis }),
    ...(completeAtMillis === undefined ? {} : { completeAtMillis }),
    ...(syncedAtMillis === undefined ? {} : { syncedAtMillis }),
    syncState,
    ...(locationCapture === undefined ? {} : { locationCapture }),
  }
}

function favoriteStickerPersistenceItem(item: Record<string, unknown>): Record<string, unknown> {
  return {
    file_asset_uid: stringValue(item.file_asset_uid).trim(),
    file_id: stringValue(item.file_id).trim(),
    file_hash: stringValue(item.file_hash).trim(),
    file_name: stringValue(item.file_name).trim(),
    mime_type: stringValue(item.mime_type).trim(),
    file_kind: Math.trunc(numberValue(item.file_kind)),
    file_type: Math.trunc(numberValue(item.file_type)),
    is_animated: booleanValue(item.is_animated),
    file_size: Math.max(0, Math.trunc(numberValue(item.file_size))),
    file_create_at: Math.max(0, Math.trunc(numberValue(item.file_create_at))),
    file_push_at: Math.max(0, Math.trunc(numberValue(item.file_push_at))),
  }
}
function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

function chatMemberRole(value: unknown): ArkmeGroupMemberRole {
  if (value === 'owner' || value === 1) return 'owner'
  if (value === 'admin' || value === 2) return 'admin'
  if (value === 'member' || value === 'participant' || value === 3) return 'member'
  return 'unknown'
}

function chatMemberStatus(value: unknown): ArkmeGroupMemberStatus {
  if (value === 'active' || value === 1) return 'active'
  if (value === 'left' || value === 2) return 'left'
  if (value === 'removed' || value === 3) return 'removed'
  return 'unknown'
}

function integerLikeValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return 0
}

function chatRecordOwnerUserId(
  relation: Record<string, unknown>,
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
  senderUserId: number,
): number {
  // Flutter treats the relationship owner's id as authoritative for this
  // endpoint.  A record or payload can be a copied/embedded projection, so
  // consult those only if the relation has no owner, then fall back to the
  // human sender for older timeline payloads.
  const candidates = [
    relation.record_owner_user_id, relation.recordOwnerUserId, relation.owner_user_id, relation.ownerUserId,
    record.record_owner_user_id, record.recordOwnerUserId, record.owner_user_id, record.ownerUserId, record.user_id, record.userId,
    payload.record_owner_user_id, payload.recordOwnerUserId, payload.owner_user_id, payload.ownerUserId, payload.user_id, payload.userId,
    senderUserId,
  ]
  for (const candidate of candidates) {
    const userId = integerLikeValue(candidate)
    if (userId > 0) return userId
  }
  return 0
}

function epochMillisValue(value: unknown): number {
  const timestamp = integerLikeValue(value)
  return timestamp > 0 && timestamp < 100_000_000_000 ? timestamp * 1000 : timestamp
}

function messageCopyLinkMediaItemFromData(value: unknown): ArkmeMessageCopyLinkSnapshotItem['mediaItems'][number] {
  const data = objectValue(value)
  return {
    fileKind: integerLikeValue(data.file_kind),
    fileName: stringValue(data.file_name),
    size: Math.max(0, integerLikeValue(data.size)),
  }
}

function messageCopyLinkStructuredContentFromData(value: unknown): ArkmeMessageCopyLinkSnapshotItem['structuredContent'] | undefined {
  const data = objectValue(value)
  if (Object.keys(data).length === 0) return undefined
  return {
    structuredKind: integerLikeValue(data.structured_kind),
    durationMillis: Math.max(0, integerLikeValue(data.duration_millis)),
  }
}

function messageCopyLinkSnapshotItemFromData(value: unknown): ArkmeMessageCopyLinkSnapshotItem {
  const data = objectValue(value)
  const structuredContent = messageCopyLinkStructuredContentFromData(data.structured_content)
  const recordUid = stringValue(data.record_uid ?? data.recordUid ?? data.uid).trim()
  const item = {
    ...(recordUid === '' ? {} : { recordUid }),
    sourceKind: stringValue(data.source_kind),
    senderDisplayName: stringValue(data.sender_display_name),
    senderAvatarUrl: stringValue(data.sender_avatar_url),
    title: stringValue(data.title),
    textContent: stringValue(data.text_content),
    sendAtMillis: epochMillisValue(data.send_at),
    templateKind: integerLikeValue(data.template_kind),
    displayKind: integerLikeValue(data.display_kind),
    officialMark: integerLikeValue(data.official_mark),
    mediaItems: listValue(data.media_items).map(messageCopyLinkMediaItemFromData),
    ...(structuredContent === undefined ? {} : { structuredContent }),
  }
  if (item.sendAtMillis <= 0 || item.senderDisplayName.trim() === '' && item.sourceKind !== 'agent_message') {
    throw new ArkmePluginError('message-copy-link-unavailable', '链接暂不可用', false, 404)
  }
  if (item.title.trim() === '' && item.textContent.trim() === '' && item.mediaItems.length === 0 && item.structuredContent === undefined) {
    throw new ArkmePluginError('message-copy-link-unavailable', '链接暂不可用', false, 404)
  }
  return item
}

function messageCopyLinkPresentationNodesFromData(
  value: unknown,
  itemCount: number,
  depth = 1,
  seenItemIndexes: Set<number> = new Set(),
): ArkmeMessageCopyLinkPresentationNode[] {
  const rawNodes = listValue(value)
  if (rawNodes.length === 0) return []
  if (depth > 8) throw new ArkmePluginError('message-copy-link-unavailable', '链接暂不可用', false, 404)
  return rawNodes.map(rawNode => {
    const data = objectValue(rawNode)
    const kind = stringValue(data.kind)
    if (kind === 'item') {
      const itemIndex = integerLikeValue(data.item_index)
      if (itemIndex < 0 || itemIndex >= itemCount || seenItemIndexes.has(itemIndex)) {
        throw new ArkmePluginError('message-copy-link-unavailable', '链接暂不可用', false, 404)
      }
      seenItemIndexes.add(itemIndex)
      return { kind: 'item', itemIndex }
    }
    if (kind === 'forward_bundle') {
      return {
        kind: 'forward_bundle',
        title: stringValue(data.title),
        commentText: stringValue(data.comment_text),
        createdAtMillis: integerLikeValue(data.created_at),
        senderDisplayName: stringValue(data.sender_display_name),
        children: messageCopyLinkPresentationNodesFromData(data.children, itemCount, depth + 1, seenItemIndexes),
      }
    }
    throw new ArkmePluginError('message-copy-link-unavailable', '链接暂不可用', false, 404)
  })
}

function messageCopyLinkSourceAnchorFromData(value: unknown): ArkmeMessageCopyLinkSourceAnchor {
  const data = objectValue(value)
  return {
    relationUid: stringValue(data.rel_uid),
    recordUid: stringValue(data.record_uid),
    recordOwnerUserId: integerLikeValue(data.record_owner_user_id),
    sequence: integerLikeValue(data.seq),
  }
}

function firstTextValue(source: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = stringValue(source[key]).trim()
    if (value !== '') return value
  }
  return ''
}

function messageCopyLinkExtensionItemFromData(value: unknown): ArkmeMessageCopyLinkExtensionItem | undefined {
  const data = objectValue(value)
  const core = objectValue(data.record_core ?? data.recordCore)
  const recordUid = firstTextValue(data, ['record_uid', 'recordUid', 'uid'])
    || firstTextValue(core, ['record_uid', 'recordUid', 'uid'])
  const senderDisplayName = firstTextValue(data, [
    'sender_display_name', 'senderDisplayName', 'nickname', 'nick_name', 'nickName', 'owner_name', 'ownerName',
  ]) || firstTextValue(core, [
    'sender_display_name', 'senderDisplayName', 'nickname', 'nick_name', 'nickName', 'owner_name', 'ownerName',
  ]) || 'Arkme用户'
  const sendAtMillis = epochMillisValue(
    data.send_at ?? data.sendAt ?? data.created_at ?? data.createdAt ?? data.published_at ?? data.publishedAt
    ?? core.send_at ?? core.sendAt ?? core.created_at ?? core.createdAt ?? core.published_at ?? core.publishedAt,
  )
  const title = stringValue(data.title ?? core.title)
  const textContent = stringValue(data.text_content ?? data.textContent ?? data.content ?? core.text_content ?? core.textContent ?? core.content)
  const mediaItems = listValue(data.media_items ?? data.mediaItems ?? core.media_items ?? core.mediaItems)
    .map(messageCopyLinkMediaItemFromData)
  const structuredContent = messageCopyLinkStructuredContentFromData(data.structured_content ?? data.structuredContent ?? core.structured_content ?? core.structuredContent)
  if (recordUid === '' || sendAtMillis <= 0
    || (title.trim() === '' && textContent.trim() === '' && mediaItems.length === 0 && structuredContent === undefined)) {
    return undefined
  }
  return {
    recordUid,
    level: Math.max(2, integerLikeValue(data.level) || 2),
    sourceKind: stringValue(data.source_kind ?? data.sourceKind) || 'record_extension',
    senderDisplayName,
    senderAvatarUrl: firstTextValue(data, ['sender_avatar_url', 'senderAvatarUrl', 'avatar_ref', 'avatarRef', 'avatar_url', 'avatarUrl', 'avatar']),
    title,
    textContent,
    sendAtMillis,
    templateKind: integerLikeValue(data.template_kind ?? data.templateKind ?? core.template_kind ?? core.templateKind) || 1,
    displayKind: integerLikeValue(data.display_kind ?? data.displayKind ?? core.display_kind ?? core.displayKind),
    officialMark: integerLikeValue(data.official_mark ?? data.officialMark ?? core.official_mark ?? core.officialMark),
    mediaItems,
    ...(structuredContent === undefined ? {} : { structuredContent }),
  }
}

function messageCopyLinkRecordContextFromData(data: Record<string, unknown>): ArkmeMessageCopyLinkRecordContext | undefined {
  const context = objectValue(data.record_context ?? data.recordContext)
  const rawExtensions = listValue(
    context.extensions ?? context.extend_records ?? context.extendRecords ?? context.list
    ?? data.extensions ?? data.extend_records ?? data.extendRecords ?? data.list,
  )
  const extensions = rawExtensions
    .map(messageCopyLinkExtensionItemFromData)
    .filter((item): item is ArkmeMessageCopyLinkExtensionItem => item !== undefined)
  const extensionCount = Math.max(
    integerLikeValue(context.extension_count ?? context.extensionCount ?? context.total ?? data.extension_count ?? data.extensionCount ?? data.total),
    extensions.length,
  )
  if (extensionCount <= 0 && extensions.length === 0) return undefined
  extensions.sort((left, right) => right.sendAtMillis - left.sendAtMillis)
  return { extensionCount, extensions }
}

function mergeMessageCopyLinkRecordContexts(
  left: ArkmeMessageCopyLinkRecordContext | undefined,
  right: ArkmeMessageCopyLinkRecordContext | undefined,
): ArkmeMessageCopyLinkRecordContext | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  const byUid = new Map<string, ArkmeMessageCopyLinkExtensionItem>()
  for (const item of [...left.extensions, ...right.extensions]) {
    byUid.set(item.recordUid, item)
  }
  const extensions = [...byUid.values()].sort((a, b) => b.sendAtMillis - a.sendAtMillis)
  return {
    extensionCount: Math.max(left.extensionCount, right.extensionCount, extensions.length),
    extensions,
  }
}

function messageCopyLinkWorldTags(text: string): string[] {
  return [...text.matchAll(/#(\S+)/gu)]
    .map(match => match[1]?.trim() ?? '')
    .filter(tag => tag !== '')
}

function messageCopyLinkRecordUidCandidates(
  items: readonly ArkmeMessageCopyLinkSnapshotItem[],
  anchors: readonly ArkmeMessageCopyLinkSourceAnchor[],
): string[] {
  const candidates: string[] = []
  const push = (value: string | undefined): void => {
    const normalized = value?.trim() ?? ''
    if (normalized !== '' && !candidates.includes(normalized)) candidates.push(normalized)
  }
  for (const item of items) push(item.recordUid)
  for (const anchor of anchors) push(anchor.recordUid)
  return candidates
}

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value).trim()
  return text === '' ? undefined : text
}

function parsedObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return objectValue(value)
  const raw = value.trim()
  if (raw === '') return {}
  try { return objectValue(JSON.parse(raw)) }
  catch { return {} }
}

function firstInteger(source: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = integerLikeValue(source[key])
    if (value > 0) return value
  }
  return 0
}

function normalizedJoinDisplayName(value: unknown): string {
  const text = stringValue(value).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length <= 128 ? text : text.slice(0, 128).trimEnd()
}

function firstJoinDisplayName(source: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = normalizedJoinDisplayName(source[key])
    if (value !== '') return value
  }
  return ''
}

interface ChatMemberDisplayNames {
  displayName: string
  memberName: string
  secondaryName: string
}

interface ChatMemberProjectionOptions {
  includeViewerLabels: boolean
  includeHumanMentionRefs: boolean
  signal?: AbortSignal
}

function resolveChatMemberDisplayNames(input: {
  userId: number
  remarkCandidates?: readonly unknown[]
  memberNameCandidates?: readonly unknown[]
  userNameCandidates?: readonly unknown[]
}): ChatMemberDisplayNames {
  const isUsable = (value: string): boolean => value !== ''
    && value !== '成员'
    && value !== '群成员'
    && value !== `用户 ${String(input.userId)}`
  const firstUsable = (values: readonly unknown[]): string => values
    .map(normalizedJoinDisplayName)
    .find(isUsable) ?? ''
  const remarkName = firstUsable(input.remarkCandidates ?? [])
  const memberName = firstUsable(input.memberNameCandidates ?? [])
  const userName = firstUsable(input.userNameCandidates ?? [])
  const displayName = [remarkName, memberName, userName].find(isUsable) ?? '群成员'
  const secondaryName = [memberName, userName, remarkName]
    .find(value => isUsable(value) && value !== displayName) ?? ''
  return { displayName, memberName, secondaryName }
}

function projectChatMemberDisplayNames(
  item: Record<string, unknown>,
  userId: number,
  viewerLabel?: string,
  publicDisplayName?: string,
): ChatMemberDisplayNames {
  return resolveChatMemberDisplayNames({
    userId,
    remarkCandidates: [],
    memberNameCandidates: [item.display_name_snapshot],
    userNameCandidates: [viewerLabel, item.remark, publicDisplayName],
  })
}

function normalizedJoinTimestamp(value: unknown): number {
  const raw = integerLikeValue(value)
  if (raw <= 0) return 0
  return raw < 100_000_000_000 ? raw * 1_000 : raw
}

function rawMemberDisplayName(item: Record<string, unknown>): string {
  return firstJoinDisplayName(item, ['remark', 'display_name_snapshot', 'displayNameSnapshot', 'display_name', 'displayName'])
}

interface ArkmeJoinEventProjectionOptions {
  viewerUserId: number
  memberRefForUserId(userId: number): Promise<string>
  eventIdForStableKey(stableKey: string): Promise<string>
}

interface MutableJoinEventGroup {
  action: ArkmeConversationMemberJoinEvent['action']
  occurredAtMillis: number
  inviterUserId: number
  inviterDisplayName: string
  inviteesByUserId: Map<number, string>
}

/** Converts allowlisted member join metadata into a Browser-safe projection. */
export async function projectArkmeConversationMemberJoinEvents(
  rawItems: readonly Record<string, unknown>[],
  options: ArkmeJoinEventProjectionOptions,
): Promise<ArkmeConversationMemberJoinEvent[]> {
  const membersByUserId = new Map<number, Record<string, unknown>>()
  for (const item of rawItems) {
    const userId = integerLikeValue(item.user_id ?? item.userId)
    if (userId > 0) membersByUserId.set(userId, item)
  }
  const groups = new Map<string, MutableJoinEventGroup>()
  for (const item of rawItems) {
    const inviteeUserId = integerLikeValue(item.user_id ?? item.userId)
    if (inviteeUserId <= 0) continue
    const extra = parsedObject(item.extra)
    if (Object.keys(extra).length === 0) continue
    const nestedInviter = ['inviter', 'invite_source', 'join_source']
      .map(key => parsedObject(extra[key])).find(value => Object.keys(value).length > 0) ?? {}
    const inviterUserId = firstInteger(extra, [
      'inviter_user_id', 'inviter_id', 'invite_from_user_id', 'creator_user_id', 'creator',
    ]) || firstInteger(nestedInviter, ['user_id', 'owner_id', 'sid', 'id', 'creator_user_id'])
    const inviterDisplayName = firstJoinDisplayName(extra, [
      'inviter_display_name', 'inviter_name', 'invite_from_display_name', 'creator_display_name', 'creator_name',
    ]) || firstJoinDisplayName(nestedInviter, ['display_name', 'nick_name', 'nickname', 'name'])
      || rawMemberDisplayName(membersByUserId.get(inviterUserId) ?? {})
    if (inviterUserId <= 0 && inviterDisplayName === '') continue
    const occurredAtMillis = normalizedJoinTimestamp(
      extra.join_batch_at ?? extra.join_tip_at ?? extra.join_event_at ?? item.join_at ?? item.joinAt,
    )
    if (occurredAtMillis <= 0) continue
    const inviteeDisplayName = firstJoinDisplayName(extra, [
      'invitee_display_name', 'joined_display_name', 'join_display_name',
    ]) || rawMemberDisplayName(item)
    if (inviteeDisplayName === '') continue
    const sourceType = firstJoinDisplayName(extra, [
      'join_source_type', 'join_action', 'source_type', 'action',
    ]).toLowerCase()
    const action: ArkmeConversationMemberJoinEvent['action'] = new Set([
      'direct_add', 'add_member', 'add_members', 'manual_add', 'added_by_member',
    ]).has(sourceType) ? 'direct_add' : 'invite'
    const inviterKey = inviterUserId > 0 ? `id:${String(inviterUserId)}` : `name:${inviterDisplayName}`
    const groupKey = `${String(occurredAtMillis)}|${action}|${inviterKey}`
    const group = groups.get(groupKey) ?? {
      action,
      occurredAtMillis,
      inviterUserId,
      inviterDisplayName,
      inviteesByUserId: new Map<number, string>(),
    }
    group.inviteesByUserId.set(inviteeUserId, inviteeDisplayName)
    groups.set(groupKey, group)
  }
  const projected: ArkmeConversationMemberJoinEvent[] = []
  for (const [groupKey, group] of groups) {
    const invitees = [...group.inviteesByUserId.entries()]
      .sort((left, right) => (left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : left[0] - right[0]))
    if (invitees.length === 0) continue
    const stableKey = `${groupKey}|${invitees.map(([userId]) => userId).join(',')}`
    projected.push({
      eventId: await options.eventIdForStableKey(stableKey),
      action: group.action,
      occurredAtMillis: group.occurredAtMillis,
      inviter: {
        ...(group.inviterUserId > 0 && membersByUserId.has(group.inviterUserId)
          ? { memberRef: await options.memberRefForUserId(group.inviterUserId) }
          : {}),
        displayName: group.inviterDisplayName,
        isSelf: group.inviterUserId > 0 && group.inviterUserId === options.viewerUserId,
      },
      invitees: await Promise.all(invitees.map(async ([userId, displayName]) => ({
        memberRef: await options.memberRefForUserId(userId),
        displayName,
        isSelf: userId === options.viewerUserId,
      }))),
    })
  }
  projected.sort((left, right) => left.occurredAtMillis - right.occurredAtMillis
    || (left.inviter.displayName < right.inviter.displayName ? -1 : left.inviter.displayName > right.inviter.displayName ? 1 : 0)
    || left.eventId.localeCompare(right.eventId))
  return projected
}

function isAgentAuthoredChatSend(options: { agentAuthored?: boolean }): boolean {
  return options.agentAuthored === true
}

function normalizedAgentDisplayName(displayName: string | undefined): string | undefined {
  const normalized = displayName?.replace(/[\u0000-\u001F\u007F]/g, ' ').trim()
  if (normalized === undefined || normalized === '') return undefined
  return normalized.length <= 64 ? normalized : normalized.slice(0, 64).trimEnd()
}

function agentSourceLabel(displayName: string): string {
  const normalized = normalizedAgentDisplayName(displayName) ?? 'Agent'
  return normalized + '代发'
}

function isAgentCreationSource(
  relation: Record<string, unknown>,
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
): boolean {
  const relationMetadata = objectValue(relation.metadata)
  const recordMetadata = objectValue(record.metadata)
  return integerLikeValue(payload.creation_source ?? payload.creationSource) === 1
    || integerLikeValue(record.creation_source ?? record.creationSource) === 1
    || integerLikeValue(relation.creation_source ?? relation.creationSource) === 1
    || integerLikeValue(recordMetadata.creation_source ?? recordMetadata.creationSource) === 1
    || integerLikeValue(relationMetadata.creation_source ?? relationMetadata.creationSource) === 1
}

function agentDisplayNameFromTimeline(
  relation: Record<string, unknown>,
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
): string {
  const relationMetadata = objectValue(relation.metadata)
  const recordMetadata = objectValue(record.metadata)
  const profile = objectValue(
    payload.agent_profile ?? payload.agentProfile ?? payload.agent
    ?? record.agent_profile ?? record.agentProfile ?? record.agent
    ?? recordMetadata.agent_profile ?? recordMetadata.agentProfile ?? recordMetadata.agent
    ?? relation.agent_profile ?? relation.agentProfile ?? relation.agent
    ?? relationMetadata.agent_profile ?? relationMetadata.agentProfile ?? relationMetadata.agent
  )
  return optionalString(payload.agent_display_name)
    ?? optionalString(payload.agentDisplayName)
    ?? optionalString(payload.agent_name)
    ?? optionalString(payload.agentName)
    ?? optionalString(record.agent_display_name)
    ?? optionalString(record.agentDisplayName)
    ?? optionalString(record.agent_name)
    ?? optionalString(record.agentName)
    ?? optionalString(recordMetadata.agent_display_name)
    ?? optionalString(recordMetadata.agentDisplayName)
    ?? optionalString(recordMetadata.agent_name)
    ?? optionalString(recordMetadata.agentName)
    ?? optionalString(relationMetadata.agent_display_name)
    ?? optionalString(relationMetadata.agentDisplayName)
    ?? optionalString(relationMetadata.agent_name)
    ?? optionalString(relationMetadata.agentName)
    ?? optionalString(profile.display_name)
    ?? optionalString(profile.displayName)
    ?? optionalString(profile.name)
    ?? 'Agent'
}

function timelineAgentSource(
  relation: Record<string, unknown>,
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
): ArkmeTimelineItem['agentSource'] | undefined {
  if (!isAgentCreationSource(relation, record, payload)) return undefined
  const displayName = agentDisplayNameFromTimeline(relation, record, payload)
  return { kind: 'agent', displayName, label: agentSourceLabel(displayName) }
}

function selfTopicIdentityFromHomeFeed(raw: unknown): { topicUid: string; title: string } | undefined {
  const item = objectValue(raw)
  const recordCore = objectValue(item.record_core)
  const topicCore = objectValue(item.topic_core ?? item.topicCore ?? recordCore.topic_core ?? recordCore.topicCore)
  const sourceKind = stringValue(item.source_kind ?? item.sourceKind ?? recordCore.source_kind ?? recordCore.sourceKind).trim().toLowerCase()
  const sourceIsTopic = sourceKind === '2' || sourceKind === 'topic'
  const explicitTopicUid = stringValue(topicCore.topic_uid ?? topicCore.topicUid).trim()
  if ((!sourceIsTopic && explicitTopicUid === '') || arkmePrivacyLockedTopic({ topic_core: topicCore })) return undefined
  const topicUid = explicitTopicUid || stringValue(item.source_uid ?? item.sourceUid).trim()
  const title = stringValue(topicCore.title ?? item.topic_title ?? item.topicTitle).trim()
  return topicUid === '' ? undefined : { topicUid, title }
}

function encodeOpaqueJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeOpaqueJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
}

export class ChatService {
  private favoriteStickerMutationTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: SourceService,
    private readonly profile: ProfileService,
    private readonly media: MediaService,
    private readonly record: RecordService,
    private readonly bot: BotService,
    private readonly arko: ArkoService,
    private readonly aiPolish: GroupAiPolishService,
    private readonly realtime: ArkmeChatRealtimePort,
    private readonly privacy = new ArkmePrivacyVisibilityService(runtime),
    private readonly messageActions?: MessageActionService,
  ) {}

  async readDirectBotConversation(
    botId: string,
    chatSessionUid: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeBotConversation> {
    const normalizedBotId = botId.trim()
    const normalizedSessionUid = chatSessionUid.trim()
    if (normalizedBotId === '' || normalizedSessionUid === '') {
      throw new ArkmePluginError('bot-chat-target-invalid', 'Bot Chat 会话目标无效', false, 400)
    }
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chat/timeline/page',
      { chat_session_uid: normalizedSessionUid, before_seq: 0, limit: 100 },
      session,
      options.signal,
      {
        lane: 'interactive-read',
        key: `bot-timeline:${normalizedSessionUid}`,
        failureCooldownMs: 2_000,
      },
    )
    if (stringValue(data.chat_session_uid).trim() !== normalizedSessionUid) {
      throw new ArkmePluginError('bot-chat-timeline-contract-invalid', 'Bot Chat 时间线返回了不匹配的会话', true, 502)
    }
    const projected: Array<ArkmeBotConversationMessage & { sequence: number }> = []
    let latestSequence = 0
    for (const raw of listValue(data.items)) {
      const item = objectValue(raw)
      const relation = objectValue(item.relation)
      const record = objectValue(item.record)
      const payload = objectValue(record.payload)
      const relationUid = stringValue(relation.rel_uid).trim()
      const recordUid = stringValue(relation.record_uid).trim()
      const hydratedRecordUid = stringValue(payload.record_uid).trim()
      const sequence = Math.trunc(numberValue(relation.seq))
      const actorKind = Math.trunc(numberValue(relation.sender_actor_kind))
      const senderUserId = Math.trunc(numberValue(relation.sender_user_id))
      const senderBotUid = stringValue(relation.sender_bot_uid).trim()
      const userActor = actorKind === 1 && senderUserId === session.userId && senderBotUid === ''
      const botActor = actorKind === 2 && senderBotUid === normalizedBotId
      if (relationUid === '' || recordUid === ''
        || (hydratedRecordUid !== '' && hydratedRecordUid !== recordUid)
        || !Number.isSafeInteger(sequence) || sequence <= 0
        || (!userActor && !botActor)) {
        throw new ArkmePluginError('bot-chat-timeline-contract-invalid', 'Bot Chat 时间线包含无效消息身份', true, 502)
      }
      latestSequence = Math.max(latestSequence, sequence)
      if (numberValue(record.status) !== 1) continue
      const contentBlocks = this.media.richContentBlocks(item, session.userId)
      const role = userActor ? 'user' as const : 'assistant' as const
      const textContent = stringValue(payload.text_content)
      const createdAtMillis = Math.max(0, Math.trunc(numberValue(relation.attach_at ?? payload.send_at)))
      const action = await this.messageActions?.chatBotMessage({
        userId: session.userId,
        chatSessionUid: normalizedSessionUid,
        relationUid,
        recordUid,
        messageIdentity: relationUid,
        role,
        textContent,
        createdAtMillis,
        sequence,
        senderUserId,
        senderName: userActor ? '我' : 'Bot',
      })
      projected.push({
        messageId: relationUid,
        recordUid,
        role,
        content: textContent,
        status: 'sent',
        createdAtMillis,
        attachments: contentBlocks.map(block => ({
          kind: block.kind,
          fileName: block.fileName,
          mimeType: block.mimeType,
          size: block.size,
          durationMillis: Math.max(0, Math.trunc((block.durationSec ?? 0) * 1_000)),
          width: 0,
          height: 0,
          sortOrder: block.sortOrder,
        })),
        ...(action === undefined ? {} : action),
        sequence,
      })
    }
    projected.sort((left, right) => left.sequence - right.sequence
      || left.createdAtMillis - right.createdAtMillis
      || left.messageId.localeCompare(right.messageId))
    const seenRelationUids = new Set<string>()
    const messages: ArkmeBotConversationMessage[] = []
    for (const item of projected) {
      if (seenRelationUids.has(item.messageId)) continue
      seenRelationUids.add(item.messageId)
      const { sequence: _sequence, ...message } = item
      messages.push(message)
    }
    return { messages, ...(latestSequence > 0 ? { latestSequence } : {}) }
  }

  async sendDirectBotText(
    chatSessionUid: string,
    contentInput: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeBotConversationSendResult> {
    const chatSessionUidValue = chatSessionUid.trim()
    const content = contentInput.trim()
    if (chatSessionUidValue === '' || content === '' || content.length > this.runtime.config.maxTextLength) {
      throw new ArkmePluginError('bot-conversation-content-invalid', 'Bot 消息为空或超过长度限制', false, 400)
    }
    const session = await this.runtime.requireSession()
    const recordUid = randomUUID()
    const relationUid = randomUUID()
    const sendAtMillis = Date.now()
    let result: Record<string, unknown>
    try {
      result = await this.postChatTextRecord(
        chatSessionUidValue, content, recordUid, relationUid, sendAtMillis, session, options.signal,
      )
    } catch (error) {
      if (error instanceof ArkmePluginError && (
        error.retryable || ['arkme-network-error', 'arkme-timeout', 'arkme-response-invalid'].includes(error.code)
      )) {
        throw new ArkmePluginError(
          'bot-conversation-send-outcome-unknown',
          '消息发送结果未知，请刷新会话确认；不会自动重试',
          false,
          409,
          { cause: error },
        )
      }
      throw error
    }
    const responseSessionUid = stringValue(result.chat_session_uid).trim()
    const responseRecordUid = stringValue(result.record_uid).trim()
    const responseRelationUid = stringValue(result.rel_uid).trim()
    const sequence = Math.trunc(numberValue(result.seq))
    if (responseSessionUid !== chatSessionUidValue || responseRecordUid !== recordUid
      || responseRelationUid !== relationUid || !Number.isSafeInteger(sequence) || sequence <= 0) {
      throw new ArkmePluginError(
        'bot-conversation-send-outcome-unknown',
        '消息可能已发送，但服务端确认不完整；请刷新会话确认',
        false,
        409,
      )
    }
    this.realtime.scheduleChatSessionProjection(chatSessionUidValue, sequence)
    return {
      userMessage: {
        messageId: responseRelationUid,
        recordUid: responseRecordUid,
        role: 'user',
        content,
        status: 'sent',
        createdAtMillis: sendAtMillis,
        attachments: [],
      },
      botMessages: [],
      status: 'ok',
    }
  }

  async directBotNotificationPreference(
    chatSessionUid: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeBotNotificationPreference> {
    const { policy } = await this.directBotPolicy(chatSessionUid, options.signal)
    return { muted: numberValue(policy.mute_state) === 2 || numberValue(policy.notify_state) === 2 }
  }

  async updateDirectBotNotificationPreference(
    chatSessionUid: string,
    muted: boolean,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeBotNotificationPreference> {
    const { session, sessionUid, policy } = await this.directBotPolicy(chatSessionUid, options.signal)
    const updateAt = Math.max(Date.now(), numberValue(policy.update_at) + 1)
    const updated = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/policy/update',
      {
        chat_session_uid: sessionUid,
        show_in_home_state: numberValue(policy.show_in_home_state),
        privacy_state: numberValue(policy.privacy_state),
        mute_state: muted ? 2 : 1,
        pin_state: numberValue(policy.pin_state),
        notify_state: muted ? 2 : 1,
        status: numberValue(policy.status),
        update_at: updateAt,
      },
      session,
      options.signal,
    )
    if (stringValue(updated.chat_session_uid).trim() !== sessionUid
      || numberValue(updated.user_id) !== session.userId
      || numberValue(updated.show_in_home_state) !== numberValue(policy.show_in_home_state)
      || numberValue(updated.privacy_state) !== numberValue(policy.privacy_state)
      || numberValue(updated.mute_state) !== (muted ? 2 : 1)
      || numberValue(updated.pin_state) !== numberValue(policy.pin_state)
      || numberValue(updated.notify_state) !== (muted ? 2 : 1)
      || numberValue(updated.status) !== numberValue(policy.status)
      || !Number.isSafeInteger(numberValue(updated.update_at))
      || numberValue(updated.update_at) < updateAt) {
      throw new ArkmePluginError('bot-chat-policy-contract-invalid', 'Bot Chat 通知策略更新确认不完整', true, 502)
    }
    const cacheKey = `${String(session.userId)}:${sessionUid}`
    const cached = this.source.cachedChatSourceByKey(cacheKey)
    if (cached !== undefined) this.source.setChatSourceByKey(cacheKey, { ...cached, isMuted: muted })
    return { muted }
  }

  async markDirectBotRead(
    chatSessionUid: string,
    readSequence: number,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeBotConversationReadResult> {
    const sessionUid = chatSessionUid.trim()
    if (sessionUid === '') throw new ArkmePluginError('bot-chat-target-invalid', 'Bot Chat 会话目标无效', false, 400)
    const session = await this.runtime.requireSession()
    const sourceRef = await this.source.sealSourceRef(session.userId, 'private_chat', sessionUid, 'Bot')
    const result = await this.advanceChatReadCursor(sourceRef, sessionUid, readSequence, session, options.signal)
    return { effectiveReadSequence: result.effectiveReadSequence, unreadCount: result.unreadCount }
  }

  private async directBotPolicy(
    chatSessionUid: string,
    signal?: AbortSignal,
  ): Promise<{ session: ArkmeSessionCredentials; sessionUid: string; policy: Record<string, unknown> }> {
    const sessionUid = chatSessionUid.trim()
    if (sessionUid === '') throw new ArkmePluginError('bot-chat-target-invalid', 'Bot Chat 会话目标无效', false, 400)
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/policy/get', { chat_session_uid: sessionUid }, session, signal,
    )
    const policy = data
    const updateAt = numberValue(policy.update_at)
    if (stringValue(policy.chat_session_uid).trim() !== sessionUid
      || numberValue(policy.user_id) !== session.userId
      || !['show_in_home_state', 'privacy_state', 'mute_state', 'pin_state', 'notify_state', 'status']
        .every(key => Number.isSafeInteger(numberValue(policy[key])) && numberValue(policy[key]) > 0)
      || !Number.isSafeInteger(updateAt) || updateAt <= 0 || updateAt >= Number.MAX_SAFE_INTEGER) {
      throw new ArkmePluginError('bot-chat-policy-contract-invalid', 'Bot Chat 通知策略响应不完整', true, 502)
    }
    return { session, sessionUid, policy }
  }

  private async serializeFavoriteStickerMutation<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.favoriteStickerMutationTail.then(work)
    this.favoriteStickerMutationTail = pending.then(() => undefined, () => undefined)
    return await pending
  }

  async listSourceMembers(
    sourceRef: string,
    options: { activeOnly?: boolean; signal?: AbortSignal } = {},
  ): Promise<ArkmeConversationMemberList> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat' && source.kind !== 'private_chat') {
      throw new ArkmePluginError('chat-members-source-invalid', '仅支持查看群聊或私聊成员', false)
    }
    const activeOnly = options.activeOnly !== false
    const joinEventsEnabled = source.kind === 'group_chat' && this.runtime.config.chatMemberJoinEventsEnabled !== false
    const rawItems = await this.rawChatMembers(source.ownerRef, joinEventsEnabled ? false : activeOnly, session, options.signal)
    const visibleRawItems = activeOnly
      ? rawItems.filter(item => chatMemberStatus(item.status) === 'active')
      : rawItems
    const members = await this.projectChatMembers(
      source.ownerRef,
      visibleRawItems,
      session,
      {
        includeViewerLabels: source.kind === 'group_chat',
        includeHumanMentionRefs: source.kind === 'group_chat',
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    )
    const signingKey = joinEventsEnabled ? await this.runtime.stateStore.uniqueCode() : ''
    const joinEvents = joinEventsEnabled
      ? await projectArkmeConversationMemberJoinEvents(rawItems, {
        viewerUserId: session.userId,
        memberRefForUserId: async userId => await this.sealChatMemberRef(session.userId, source.ownerRef, userId),
        eventIdForStableKey: async stableKey => `arkme-chat-join-v1.${createHmac('sha256', signingKey)
          .update(`${String(session.userId)}|${source.ownerRef}|${stableKey}`).digest('base64url')}`,
      })
      : undefined
    return {
      source: await this.source.sourceItem(source),
      items: members,
      total: members.length,
      activeCount: members.filter(item => item.status === 'active').length,
      ...(joinEvents === undefined ? {} : { joinEvents }),
    }
  }

  async sourceMemberRecords(
    sourceRef: string,
    memberRef: string,
    mode: ArkmeConversationMemberRecordMode,
    options: { limit?: number; beforeSequence?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeConversationMemberRecordPage> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat' && source.kind !== 'private_chat') {
      throw new ArkmePluginError('chat-members-source-invalid', '仅支持查看群聊或私聊成员快记', false)
    }
    if (mode !== 'owner' && mode !== 'mentioned') {
      throw new ArkmePluginError('chat-member-record-mode-invalid', '成员快记模式无效', false)
    }
    const reference = await this.openChatMemberRef(memberRef, session.userId, source.ownerRef)
    const rawMembers = await this.rawChatMembers(source.ownerRef, false, session, options.signal)
    const members = await this.projectChatMembers(
      source.ownerRef,
      rawMembers,
      session,
      {
        includeViewerLabels: source.kind === 'group_chat',
        includeHumanMentionRefs: source.kind === 'group_chat',
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    )
    const member = members.find(item => item.memberRef === memberRef)
    if (member === undefined) {
      throw new ArkmePluginError('chat-member-ref-stale', '该成员已不属于当前会话，请刷新后重试', false, 409)
    }
    const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 30)))
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/members/records/page',
      {
        chat_session_uid: source.ownerRef,
        member_user_id: reference.targetUserId,
        mode: mode === 'owner' ? 'sent' : 'mentioned',
        before_seq: Math.max(0, Math.trunc(options.beforeSequence ?? 0)),
        limit,
      },
      session,
      options.signal,
      {
        lane: 'interactive-read',
        key: `member-records:${source.ownerRef}:${String(reference.targetUserId)}:${mode}:${String(Math.max(0, Math.trunc(options.beforeSequence ?? 0)))}`,
        failureCooldownMs: 2_000,
      },
    )
    const items = await this.projectChatTimelineItems(listValue(data.items), source, session, options.signal)
    const nextBeforeSequence = Math.max(0, Math.trunc(numberValue(data.next_before_seq)))
    return {
      source: await this.source.sourceItem(source),
      member,
      mode,
      items,
      hasMore: data.has_more === true,
      ...(nextBeforeSequence > 0 ? { nextCursor: { beforeSequence: nextBeforeSequence } } : {}),
    }
  }

  async openPrivateChatFromMember(
    sourceRef: string,
    memberRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeOpenPrivateChatResult> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat' && source.kind !== 'private_chat') {
      throw new ArkmePluginError('chat-members-source-invalid', '仅支持从聊天成员发起私聊', false)
    }
    const reference = await this.openChatMemberRef(memberRef, session.userId, source.ownerRef)
    if (reference.targetUserId === session.userId) {
      throw new ArkmePluginError('private-chat-self-invalid', '不能给自己发起私聊', false, 409)
    }
    const rawMembers = await this.rawChatMembers(source.ownerRef, true, session, options.signal)
    const rawMember = rawMembers.find(item => Math.trunc(numberValue(item.user_id)) === reference.targetUserId)
    if (rawMember === undefined) {
      throw new ArkmePluginError('chat-member-ref-stale', '该成员已不属于当前会话，请刷新后重试', false, 409)
    }
    const displayName = stringValue(rawMember.remark).trim()
      || stringValue(rawMember.display_name_snapshot).trim()
      || '群成员'
    return await this.openPrivateChatFromUser(reference.targetUserId, {
      displayName,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }

  async openPrivateChatFromUser(
    peerUserId: number,
    options: { displayName?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeOpenPrivateChatResult> {
    const session = await this.runtime.requireSession()
    if (!Number.isSafeInteger(peerUserId) || peerUserId <= 0) {
      throw new ArkmePluginError('private-chat-peer-invalid', '私聊用户参数无效', false)
    }
    if (peerUserId === session.userId) {
      throw new ArkmePluginError('private-chat-self-invalid', '不能给自己发起私聊', false, 409)
    }
    const profile = (await this.profile.publicProfileSummariesByUserIds([peerUserId], session, options.signal).catch(() => new Map())).get(peerUserId)
    const displayName = options.displayName?.trim() || profile?.displayName || '群成员'
    const ownerSnapshot = (await this.runtime.stateStore.cachedProfile(session.userId).catch(() => undefined))?.profile?.displayName
      ?? ''
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/create-private',
      {
        chat_session_uid: `chat_session_${randomUUID()}`,
        peer_user_id: peerUserId,
        title: displayName,
        create_at: Date.now(),
        owner_display_name_snapshot: ownerSnapshot,
        peer_display_name_snapshot: displayName,
        extra: { source: 'dsh_arkme_user_card', client: 'deepseek_harness' },
      },
      session,
      options.signal,
    )
    const chatSession = objectValue(data.session)
    const uid = stringValue(chatSession.chat_session_uid).trim()
    if (uid === '') {
      throw new ArkmePluginError('private-chat-contract-invalid', '私聊会话响应不完整', true, 502)
    }
    const unread = objectValue(data.unread_snapshot)
    const latestSequence = numberValue(unread.session_last_seq ?? chatSession.last_seq)
    const source: ArkmeSourceItem = {
      sourceRef: await this.source.sealSourceRef(session.userId, 'private_chat', uid, displayName),
      sourceKey: await this.source.chatDirectorySourceKey(session.userId, uid),
      peerUserId,
      kind: 'private_chat',
      displayName,
      ...(profile?.avatarUrl === undefined ? {} : { avatarRef: await this.profile.sealProfileImageRef(session.userId, peerUserId) }),
      activeAtMillis: numberValue(chatSession.last_active_at) || Date.now(),
      unreadCount: numberValue(unread.unread_count),
      ...(latestSequence > 0 ? { latestSequence } : {}),
    }
    this.source.setChatSourceByKey(`${String(session.userId)}:${uid}`, source)
    return { source }
  }

  async openOfficialAuthorPrivateChat(
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeOpenPrivateChatResult> {
    const session = await this.runtime.requireSession()
    const existing = await this.findPrivateChatByPeerUserId(OFFICIAL_AUTHOR_USER_ID, session, options.signal)
    if (existing !== undefined) return { source: existing }
    const created = await this.runtime.authenticatedSubjectPost<OfficialAuthorPrivateChatCreateResult>(
      '/api/v1/private/create-chat-ref-asen',
      {
        subject_uid: `dsh_official_author_${randomUUID().replace(/-/g, '')}`,
        network: 'dsh',
        client_name: 'DSH',
        locs: [],
      },
      session,
      options.signal,
    )
    const rmSubjectId = Math.trunc(numberValue(created.rm_subject_id))
    if (!Number.isSafeInteger(rmSubjectId) || rmSubjectId <= 0) {
      if (booleanValue(created.already_exist)) {
        throw new ArkmePluginError('private-chat-self-invalid', '不能给自己发起私聊', false, 409)
      }
      throw new ArkmePluginError('official-author-chat-contract-invalid', '联系作者私聊响应不完整', true, 502)
    }
    const partnerData = await this.runtime.authenticatedSubjectPost<Record<string, unknown>>(
      '/api/v1/private/get-partner-info-v2',
      { rm_subject_ids: [rmSubjectId] },
      session,
      options.signal,
    )
    const partner = listValue(partnerData.item_ls)
      .map(item => objectValue(item))
      .find(item => Math.trunc(numberValue(item.rm_subject_id)) === rmSubjectId)
    if (partner === undefined) {
      throw new ArkmePluginError('official-author-chat-contract-invalid', '联系作者私聊资料缺失，请稍后重试', true, 502)
    }
    const peerUserId = Math.trunc(numberValue(partner.user_id))
    if (!Number.isSafeInteger(peerUserId) || peerUserId <= 0) {
      throw new ArkmePluginError('official-author-chat-contract-invalid', '联系作者账号资料缺失，请稍后重试', true, 502)
    }
    const displayName = stringValue(partner.mark).trim()
      || stringValue(partner.nick_name).trim()
      || '作者'
    return await this.openPrivateChatFromUser(peerUserId, {
      displayName,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }

  /**
   * Contact-author is an entry point, not a second conversation type. Scan the
   * ordinary directory first so repeated clicks always reuse the existing chat.
   */
  private async findPrivateChatByPeerUserId(
    peerUserId: number,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeSourceItem | undefined> {
    let cursor: string | undefined
    for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
      const page = await this.source.listSources('root', {
        limit: 50,
        refresh: true,
        ...(cursor === undefined ? {} : { cursor }),
        ...(signal === undefined ? {} : { signal }),
      })
      const existing = page.items.find(source => source.kind === 'private_chat' && source.peerUserId === peerUserId)
      if (existing !== undefined) return existing
      if (!page.hasMore || page.nextCursor === undefined) return undefined
      cursor = page.nextCursor
    }
    return undefined
  }

  async officialAuthorProfile(
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeOfficialAuthorProfile> {
    const session = await this.runtime.requireSession()
    const profile = (await this.profile.publicProfileSummariesByUserIds(
      [OFFICIAL_AUTHOR_USER_ID],
      session,
      options.signal,
    )).get(OFFICIAL_AUTHOR_USER_ID)
    if (profile === undefined) {
      return { userId: OFFICIAL_AUTHOR_USER_ID, displayName: OFFICIAL_AUTHOR_FALLBACK_DISPLAY_NAME }
    }
    const displayName = profile.displayName.trim()
      || profile.accountName?.trim()
      || OFFICIAL_AUTHOR_FALLBACK_DISPLAY_NAME
    return {
      userId: OFFICIAL_AUTHOR_USER_ID,
      displayName,
      ...(profile.avatarUrl === undefined ? {} : {
        avatarRef: await this.profile.sealProfileImageRef(session.userId, OFFICIAL_AUTHOR_USER_ID),
      }),
    }
  }

  async readSource(
      sourceRef: string,
      options: { limit?: number; cursor?: ArkmeTimelineCursor; signal?: AbortSignal } = {},
    ): Promise<ArkmeTimelinePage> {
      const session = await this.runtime.requireSession()
      const source = await this.source.openSourceRef(sourceRef, session.userId)
      const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 30)))
      if (source.kind === 'send_to_self') {
        const lockedRecordUids = await this.privacy.lockedRecordUids(session, options.signal)
        const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/home/feed/query',
          {
            limit,
            source_kinds: [1, 2],
            ...(options.cursor?.sendAtMillis === undefined ? {} : { cursor_send_at: options.cursor.sendAtMillis }),
            ...(options.cursor?.itemUid === undefined ? {} : { cursor_record_uid: options.cursor.itemUid }),
          },
          session,
          options.signal,
        )
        const rawRecords = listValue(data.items).filter(raw => !arkmePrivacyLockedRecord(raw)
          && !lockedRecordUids.has(this.record.recordUid(raw)))
        const media = await this.media.hydrateRecordMediaPage(rawRecords, session, options.signal)
        const signingKey = await this.runtime.stateStore.uniqueCode()
        const items = (await Promise.all(rawRecords.map(async raw => {
          const recordUid = this.record.recordUid(raw)
          const displayItems = media.displayItemsByRecordUid.get(recordUid)
          const topic = selfTopicIdentityFromHomeFeed(raw)
          return this.record.recordTimelineItemFromRaw(raw, session.userId, {
            ...(displayItems === undefined ? {} : { displayItems }),
            isMe: true,
            ...(topic === undefined ? {} : { selfTopic: {
              topicHierarchyKey: await this.source.topicHierarchyKey(session.userId, topic.topicUid),
              ...(topic.title === '' ? {} : {
                title: topic.title,
                sourceRef: await this.source.sealSourceRef(session.userId, 'topic', topic.topicUid, topic.title),
              }),
            } }),
            mediaUnavailable: media.unavailableRecordUids.has(recordUid),
          })
        }))).filter(item => item.itemUid !== '').map(item => this.withRecordMessageActionRef(
          source,
          item,
          session.userId,
          signingKey,
        ))
        const nextSendAt = numberValue(data.next_cursor_send_at)
        const nextUid = stringValue(data.next_cursor_record_uid).trim()
        return {
          source: await this.source.sourceItem(source),
          items,
          hasMore: data.has_more === true,
          ...(nextSendAt > 0 && nextUid !== '' ? {
            nextCursor: { sendAtMillis: nextSendAt, itemUid: nextUid },
          } : {}),
        }
      }
      if (source.kind === 'default_category') {
        const page = await this.record.list(limit, options.cursor?.sendAtMillis !== undefined && options.cursor.itemUid !== undefined
          ? { sendAtMillis: options.cursor.sendAtMillis, recordUid: options.cursor.itemUid }
          : undefined)
        const signingKey = await this.runtime.stateStore.uniqueCode()
        return {
          source: await this.source.sourceItem(source),
          items: page.items.map(item => this.withRecordMessageActionRef(
            source,
            this.record.recordTimelineItem(item),
            session.userId,
            signingKey,
          )),
          hasMore: page.hasMore,
          ...(page.nextCursor === undefined ? {} : {
            nextCursor: { sendAtMillis: page.nextCursor.sendAtMillis, itemUid: page.nextCursor.recordUid },
          }),
        }
      }
      if (source.kind === 'topic') {
        const lockedRecordUids = await this.privacy.lockedRecordUids(session, options.signal)
        const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/display/detail',
          {
            topic_uid: source.ownerRef,
            limit,
            ...(options.cursor?.sendAtMillis === undefined ? {} : { cursor_send_at: options.cursor.sendAtMillis }),
            ...(options.cursor?.itemUid === undefined ? {} : { cursor_record_uid: options.cursor.itemUid }),
          },
          session,
          options.signal,
        )
        if (arkmePrivacyLockedTopic(data.topic_core)) {
          throw new ArkmePluginError('topic-privacy-locked', '隐私锁主题不能在 Arkme 插件中查看', false, 403)
        }
        const rawRecords = listValue(data.records).filter(raw => !arkmePrivacyLockedRecord(raw)
          && !lockedRecordUids.has(this.record.recordUid(raw)))
        const media = await this.media.hydrateRecordMediaPage(rawRecords, session, options.signal)
        const signingKey = await this.runtime.stateStore.uniqueCode()
        const records = rawRecords.map(raw => {
          const recordUid = this.record.recordUid(raw)
          const displayItems = media.displayItemsByRecordUid.get(recordUid)
          return this.record.recordTimelineItemFromRaw(raw, session.userId, {
            ...(displayItems === undefined ? {} : { displayItems }),
            mediaUnavailable: media.unavailableRecordUids.has(recordUid),
          })
        })
        const nextSendAt = numberValue(data.next_cursor_send_at)
        const nextUid = stringValue(data.next_cursor_record_uid).trim()
        return {
          source: await this.source.sourceItem(source),
          items: records.map(item => this.withRecordMessageActionRef(source, item, session.userId, signingKey)),
          hasMore: data.has_more === true,
          ...(nextSendAt > 0 && nextUid !== '' ? { nextCursor: { sendAtMillis: nextSendAt, itemUid: nextUid } } : {}),
        }
      }
      const aiPolishDecorations = source.kind === 'group_chat' && options.cursor === undefined
        ? Promise.allSettled([
          this.aiPolish.queryGroupAiPolishConfig(source.ownerRef, session, options.signal),
          this.aiPolish.queryGroupAiPolishNotices(source.ownerRef, session, options.signal),
        ])
        : undefined
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chat/timeline/page',
        {
          chat_session_uid: source.ownerRef,
          before_seq: Math.max(0, Math.trunc(options.cursor?.beforeSequence ?? 0)),
          limit,
        },
        session,
        options.signal,
        {
          lane: 'interactive-read',
          key: `timeline:${source.ownerRef}:${String(Math.max(0, Math.trunc(options.cursor?.beforeSequence ?? 0)))}:${String(limit)}`,
          failureCooldownMs: 2_000,
        },
      )
      const items = await this.projectChatTimelineItems(listValue(data.items), source, session, options.signal)
      const beforeSequence = numberValue(data.next_before_seq)
      let aiPolishSettings: ArkmeGroupAiPolishSnapshot | undefined
      let aiPolishNotices: ArkmeGroupAiPolishNotice[] | undefined
      if (aiPolishDecorations !== undefined) {
        const [settingsResult, noticesResult] = await aiPolishDecorations
        if (settingsResult.status === 'fulfilled') {
          aiPolishSettings = this.aiPolish.groupAiPolishSnapshot(sourceRef, source.displayName, settingsResult.value)
        }
        if (noticesResult.status === 'fulfilled') aiPolishNotices = noticesResult.value
      }
      return {
        source: await this.source.sourceItem(source),
        items,
        ...(aiPolishSettings === undefined ? {} : { aiPolishSettings }),
        ...(aiPolishNotices === undefined ? {} : { aiPolishNotices }),
        hasMore: data.has_more === true,
        ...(beforeSequence > 0 ? { nextCursor: { beforeSequence } } : {}),
      }
    }

  async reportMessage(
      messageRef: string,
      reportType: 1 | 2 | 3 | 4,
      options: { reason?: string; requestUid?: string; signal?: AbortSignal } = {},
    ): Promise<ArkmeMessageReportResult> {
      const session = await this.runtime.requireSession()
      const reference = await this.openMessageRef(messageRef, session.userId)
      const reason = options.reason?.trim() ?? ''
      if (![1, 2, 3, 4].includes(reportType) || (reportType === 4 && reason === '') || [...reason].length > 500) {
        throw new ArkmePluginError('message-report-invalid', '举报类型或补充说明无效', false)
      }
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/report',
        {
          chat_session_uid: reference.chatSessionUid,
          rel_uid: reference.relationUid,
          ...(options.requestUid?.trim() === '' || options.requestUid === undefined ? {} : { request_uid: options.requestUid.trim() }),
          report_type: reportType,
          ...(reason === '' ? {} : { reason }),
        },
        session,
        options.signal,
      )
      const report = objectValue(data.report)
      const reportUid = stringValue(report.report_uid).trim()
      if (reportUid === '') throw new ArkmePluginError('message-report-invalid-response', '举报服务返回无效', true, 502)
      return { messageRef, reportUid, status: numberValue(report.status) }
    }

  async messageReadReceiptSummaries(
    sourceRef: string,
    rawItems: readonly ArkmeMessageReadReceiptQueryItem[],
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeMessageReadReceiptSummaryList> {
    const session = await this.runtime.requireSession()
    const source = await this.requireReadReceiptChatSource(sourceRef, session.userId)
    const items = this.requireReadReceiptItems(rawItems)
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/read-receipts/summary-list',
      {
        chat_session_uid: source.ownerRef,
        items: items.map(item => ({ record_uid: item.itemUid, seq: item.sequence })),
      },
      session,
      options.signal,
    )
    if (stringValue(data.chat_session_uid).trim() !== source.ownerRef) {
      throw new ArkmePluginError('message-read-receipt-invalid-response', '消息已读状态服务返回了不匹配的会话', true, 502)
    }
    const requestedKeys = new Set(items.map(item => this.readReceiptItemKey(item.itemUid, item.sequence)))
    const summaries = new Map<string, ArkmeMessageReadReceiptSummary>()
    for (const raw of listValue(data.items)) {
      const item = objectValue(raw)
      const itemUid = stringValue(item.record_uid).trim()
      const sequence = Math.trunc(numberValue(item.seq))
      const key = this.readReceiptItemKey(itemUid, sequence)
      const rowSessionUid = stringValue(item.chat_session_uid).trim()
      const readCount = Math.trunc(numberValue(item.read_count))
      const unreadCount = Math.trunc(numberValue(item.unread_count))
      const totalMemberCount = Math.trunc(numberValue(item.total_member_count))
      if (!requestedKeys.has(key) || summaries.has(key) || rowSessionUid !== source.ownerRef
        || typeof item.seq !== 'number' || !Number.isSafeInteger(item.seq)
        || typeof item.read_count !== 'number' || !Number.isSafeInteger(item.read_count)
        || typeof item.unread_count !== 'number' || !Number.isSafeInteger(item.unread_count)
        || typeof item.total_member_count !== 'number' || !Number.isSafeInteger(item.total_member_count)
        || readCount < 0 || unreadCount < 0 || totalMemberCount < 0
        || readCount + unreadCount !== totalMemberCount) {
        throw new ArkmePluginError('message-read-receipt-invalid-response', '消息已读状态服务返回无效', true, 502)
      }
      summaries.set(key, {
        itemUid,
        sequence,
        readCount,
        unreadCount,
        totalMemberCount,
        status: unreadCount === 0 ? 'read' : readCount === 0 ? 'unread' : 'partially_read',
      })
    }
    if (summaries.size !== items.length) {
      throw new ArkmePluginError('message-read-receipt-invalid-response', '消息已读状态服务返回不完整', true, 502)
    }
    return {
      sourceRef,
      conversationKind: source.kind,
      items: items.map(item => summaries.get(this.readReceiptItemKey(item.itemUid, item.sequence))!),
    }
  }

  async messageReadReceiptDetail(
    sourceRef: string,
    itemUid: string,
    sequence: number,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeMessageReadReceiptDetail> {
    const session = await this.runtime.requireSession()
    const source = await this.requireReadReceiptChatSource(sourceRef, session.userId)
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('message-read-receipt-group-required', '成员已读详情只支持群聊消息；私聊请查询消息已读状态', false, 400)
    }
    const [message] = this.requireReadReceiptItems([{ itemUid, sequence }])
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/read-receipts/detail',
      { chat_session_uid: source.ownerRef, record_uid: message!.itemUid, seq: message!.sequence },
      session,
      options.signal,
    )
    if (stringValue(data.chat_session_uid).trim() !== source.ownerRef
      || stringValue(data.record_uid).trim() !== message!.itemUid
      || typeof data.seq !== 'number' || !Number.isSafeInteger(data.seq)
      || Math.trunc(numberValue(data.seq)) !== message!.sequence) {
      throw new ArkmePluginError('message-read-receipt-invalid-response', '成员已读详情服务返回了不匹配的消息', true, 502)
    }
    const rawMembers = listValue(data.items).map(objectValue)
    const seenUserIds = new Set<number>()
    const receiptMembers = rawMembers.map(item => {
      const userId = Math.trunc(numberValue(item.user_id))
      const readStatus = stringValue(item.read_status).trim()
      const readAtMillis = Math.trunc(numberValue(item.read_at))
      if (typeof item.user_id !== 'number' || !Number.isSafeInteger(item.user_id)
        || typeof item.read_at !== 'number' || !Number.isSafeInteger(item.read_at)
        || !Number.isSafeInteger(userId) || userId <= 0 || userId === session.userId || seenUserIds.has(userId)
        || (readStatus !== 'read' && readStatus !== 'unread') || readAtMillis < 0
        || (readStatus === 'unread' && readAtMillis !== 0)) {
        throw new ArkmePluginError('message-read-receipt-invalid-response', '成员已读详情服务返回无效', true, 502)
      }
      seenUserIds.add(userId)
      return {
        userId,
        readStatus: readStatus === 'read' ? 'read' as const : 'unread' as const,
        readAtMillis,
        remarkName: firstJoinDisplayName(item, [
          'remark', 'remark_name', 'remarkName', 'contact_remark', 'contactRemark',
          'member_remark', 'memberRemark',
        ]),
        memberName: firstJoinDisplayName(item, [
          'member_name', 'memberName', 'nickname', 'nick_name', 'nickName', 'name',
          'user_name', 'userName', 'display_name_snapshot', 'displayNameSnapshot',
        ]),
        userName: firstJoinDisplayName(item, ['display_name', 'displayName']),
      }
    })
    const userIds = receiptMembers.map(item => item.userId)
    const missingRemarkUserIds = receiptMembers
      .filter(item => item.remarkName === '')
      .map(item => item.userId)
    const [profiles, privateRemarks] = await Promise.all([
      this.profile.publicProfileSummariesByUserIds(
        userIds, session, options.signal,
      ).catch(() => new Map()),
      missingRemarkUserIds.length === 0
        ? Promise.resolve(new Map<number, string>())
        : this.source.privateRemarksByUserIds(
            missingRemarkUserIds,
            options.signal === undefined ? {} : { signal: options.signal },
          ).catch(() => new Map<number, string>()),
    ])
    const members = [] as ArkmeMessageReadReceiptDetail['items']
    for (const item of receiptMembers) {
      const profile = profiles.get(item.userId)
      const { displayName } = resolveChatMemberDisplayNames({
        userId: item.userId,
        remarkCandidates: [item.remarkName, privateRemarks.get(item.userId)],
        memberNameCandidates: [item.memberName],
        userNameCandidates: [item.userName, profile?.displayName],
      })
      members.push({
        memberRef: await this.sealChatMemberRef(session.userId, source.ownerRef, item.userId),
        displayName,
        ...(profile?.avatarUrl === undefined ? {} : {
          avatarRef: await this.profile.sealProfileImageRef(session.userId, item.userId),
        }),
        readStatus: item.readStatus,
        ...(item.readStatus === 'read' && item.readAtMillis > 0 ? { readAtMillis: item.readAtMillis } : {}),
      })
    }
    const readCount = members.filter(member => member.readStatus === 'read').length
    return {
      sourceRef,
      itemUid: message!.itemUid,
      sequence: message!.sequence,
      readCount,
      unreadCount: members.length - readCount,
      totalMemberCount: members.length,
      items: members,
    }
  }

  private async requireReadReceiptChatSource(sourceRef: string, userId: number): Promise<ArkmeSourceRefPayload & {
    kind: 'private_chat' | 'group_chat'
  }> {
    const source = await this.source.openSourceRef(sourceRef, userId)
    if (source.kind !== 'private_chat' && source.kind !== 'group_chat') {
      throw new ArkmePluginError('message-read-receipt-chat-required', '消息已读状态只支持私聊或群聊', false, 400)
    }
    return source as ArkmeSourceRefPayload & { kind: 'private_chat' | 'group_chat' }
  }

  private requireReadReceiptItems(rawItems: readonly ArkmeMessageReadReceiptQueryItem[]): ArkmeMessageReadReceiptQueryItem[] {
    if (rawItems.length < 1 || rawItems.length > ARKME_MESSAGE_READ_RECEIPT_MAX_ITEMS) {
      throw new ArkmePluginError(
        'message-read-receipt-items-invalid',
        `消息已读状态每次需要 1 至 ${String(ARKME_MESSAGE_READ_RECEIPT_MAX_ITEMS)} 条消息`,
        false,
        400,
      )
    }
    const seen = new Set<string>()
    return rawItems.map(raw => {
      const itemUid = raw.itemUid.trim()
      const sequence = Math.trunc(raw.sequence)
      const key = this.readReceiptItemKey(itemUid, sequence)
      if (itemUid === '' || itemUid.length > 256 || !Number.isSafeInteger(raw.sequence) || sequence <= 0 || seen.has(key)) {
        throw new ArkmePluginError('message-read-receipt-items-invalid', '消息已读状态参数无效或重复', false, 400)
      }
      seen.add(key)
      return { itemUid, sequence }
    })
  }

  private readReceiptItemKey(itemUid: string, sequence: number): string {
    return `${itemUid}\u0000${String(sequence)}`
  }

  async copySourceMessageLink(
      sourceRef: string,
      actionRefs: readonly string[],
      options: { signal?: AbortSignal } = {},
    ): Promise<ArkmeMessageCopyLinkResult> {
      const session = await this.runtime.requireSession()
      const source = await this.source.openSourceRef(sourceRef, session.userId)
      const references = this.forwardReferencesOrderedForCommand(await this.openMessageActionRefs(actionRefs, session.userId, source))
      if (references.length === 0 || references.length > 100) {
        throw new ArkmePluginError('message-actions-selection-invalid', '请选择 1 至 100 条消息', false)
      }
      this.validateForwardReferences(references)
      const sources = references.map(reference => reference.sourceKind === 'chat_relation'
        ? {
          kind: 'chat_relation',
          chat_session_uid: reference.chatSessionUid,
          relation_uid: reference.relationUid,
        }
        : {
          kind: 'record',
          record_owner_user_id: reference.recordOwnerUserId,
          record_uid: reference.recordUid,
        })
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/messages/copy-link/get-or-create',
        { sources },
        session,
        options.signal,
      )
      const sid = stringValue(data.sid).trim()
      const url = stringValue(data.url).trim()
      if (sid === '' || !/^https?:\/\//i.test(url)) {
        throw new ArkmePluginError('message-copy-link-response-invalid', '复制链接失败，请稍后重试', true, 502)
      }
      return { sid, url }
    }

  async resolveMessageCopyLink(
      sid: string,
      options: { signal?: AbortSignal } = {},
    ): Promise<ArkmeMessageCopyLinkResolveResult> {
      const normalizedSid = sid.trim()
      if (!/^[0-9A-Za-z]{16}$/.test(normalizedSid)) {
        throw new ArkmePluginError('message-copy-link-unavailable', '链接暂不可用', false, 404)
      }
      const session = await this.runtime.requireSession()
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/messages/copy-link/resolve',
        { sid: normalizedSid },
        session,
        options.signal,
      )
      const rawItems = listValue(data.items)
      if (rawItems.length === 0 && stringValue(data.audit_status) === 'auditing') {
        throw new ArkmePluginError('message-copy-link-auditing', '审核中', true, 409)
      }
      const items = rawItems.map(messageCopyLinkSnapshotItemFromData)
      if (items.length === 0 || items.length > MAX_MESSAGE_COPY_LINK_ITEMS) {
        throw new ArkmePluginError('message-copy-link-unavailable', '链接暂不可用', false, 404)
      }
      const presentation = messageCopyLinkPresentationNodesFromData(data.presentation, items.length)
      const sourceContext = objectValue(data.source_context)
      const accessMode = stringValue(data.access_mode)
      if (accessMode !== 'normal' && accessMode !== 'link_read_only') {
        throw new ArkmePluginError('message-copy-link-unavailable', '链接暂不可用', false, 404)
      }
      const anchors = accessMode === 'normal'
        ? listValue(sourceContext.anchors).map(messageCopyLinkSourceAnchorFromData)
          .filter(anchor => anchor.relationUid.trim() !== '' && anchor.recordUid.trim() !== '' && anchor.recordOwnerUserId > 0)
        : []
      const embeddedRecordContext = messageCopyLinkRecordContextFromData(data)
      const publicRecordContext = accessMode === 'normal'
        ? await this.loadMessageCopyLinkPublicExtensions(
          messageCopyLinkRecordUidCandidates(items, anchors),
          session,
          options.signal,
        )
        : undefined
      const recordContext = mergeMessageCopyLinkRecordContexts(embeddedRecordContext, publicRecordContext)
      const result: ArkmeMessageCopyLinkResolveResult = {
        sid: stringValue(data.sid),
        displayTitle: stringValue(data.display_title),
        generatedAtMillis: epochMillisValue(data.generated_at),
        accessMode,
        items,
        presentation,
        ...(accessMode === 'normal' ? { sourceSessionUid: stringValue(sourceContext.chat_session_uid), sourceAnchors: anchors } : {}),
        ...(recordContext === undefined ? {} : { recordContext }),
      }
      if (result.sid !== normalizedSid
        || (accessMode === 'normal' && (result.sourceSessionUid === undefined || result.sourceSessionUid.trim() === '' || anchors.length === 0))) {
        throw new ArkmePluginError('message-copy-link-unavailable', '链接暂不可用', false, 404)
      }
      return result
    }

  private async loadMessageCopyLinkPublicExtensions(
      recordUids: readonly string[],
      session: ArkmeSessionCredentials,
      signal?: AbortSignal,
    ): Promise<ArkmeMessageCopyLinkRecordContext | undefined> {
      const worldPost = (this.runtime as Partial<Pick<ServiceRuntime, 'authenticatedWorldPost'>>).authenticatedWorldPost
      const candidates = recordUids
        .map(recordUid => recordUid.trim())
        .filter((recordUid, index, array) => recordUid !== '' && array.indexOf(recordUid) === index)
        .slice(0, 3)
      if (candidates.length === 0 || worldPost === undefined) return undefined
      for (const normalizedRecordUid of candidates) {
        const extensions: ArkmeMessageCopyLinkExtensionItem[] = []
        let offset = 0
        let total = 0
        let hasMore: boolean | undefined
        try {
          while (true) {
            const data = await worldPost.call(
              this.runtime,
              '/api/v1/public-record/extend-list',
              { record_uid: normalizedRecordUid, limit: 50, offset },
              session,
              signal,
              { lane: 'interactive-read', bypassCache: true },
            ) as Record<string, unknown>
            const rawItems = listValue(data.list ?? data.items)
            if (offset === 0) total = Math.max(0, integerLikeValue(data.total))
            const pageItems = rawItems
              .map((raw) => messageCopyLinkExtensionItemFromData(raw))
              .filter((item): item is ArkmeMessageCopyLinkExtensionItem => item !== undefined)
            extensions.push(...pageItems)
            if (rawItems.length === 0) break
            offset += rawItems.length
            hasMore = data.has_more === true || data.hasMore === true
              ? true
              : data.has_more === false || data.hasMore === false ? false : undefined
            if (total > 0 && offset >= total) break
            if (hasMore === false) break
            if (hasMore === undefined && total <= 0) break
          }
        } catch {
          continue
        }
        const extensionCount = Math.max(total, extensions.length)
        if (extensionCount <= 0 && extensions.length === 0) continue
        extensions.sort((left, right) => right.sendAtMillis - left.sendAtMillis)
        return { extensionCount, extensions }
      }
      return undefined
    }

  async extendMessageCopyLink(
      sid: string,
      itemIndex: number,
      textContent: string,
      recordUid: string,
      options: { signal?: AbortSignal } = {},
    ): Promise<ArkmeMessageCopyLinkExtendResult> {
      const normalizedSid = sid.trim()
      const normalizedIndex = Math.trunc(itemIndex)
      const normalizedUid = recordUid.trim()
      const normalizedText = textContent.trim()
      if (!/^[0-9A-Za-z]{16}$/.test(normalizedSid) || normalizedIndex < 0 || normalizedIndex >= MAX_MESSAGE_COPY_LINK_ITEMS) {
        throw new ArkmePluginError('message-copy-link-unavailable', '链接暂不可用', false, 404)
      }
      if (!RECORD_UID_PATTERN.test(normalizedUid)) {
        throw new ArkmePluginError('record-uid-invalid', '写入标识无效，请重试', false)
      }
      if (normalizedText === '') throw new ArkmePluginError('record-text-empty', '请输入延展内容', false)
      if (normalizedText.length > this.runtime.config.maxTextLength) {
        throw new ArkmePluginError(
          'record-text-too-long',
          `内容不能超过 ${this.runtime.config.maxTextLength} 个字符`,
          false,
        )
      }
      const session = await this.runtime.requireSession()
      const detail = await this.resolveMessageCopyLink(normalizedSid, options)
      const item = detail.items[normalizedIndex]
      const anchor = detail.accessMode === 'normal' ? detail.sourceAnchors?.[normalizedIndex] : undefined
      const parentRecordUid = item === undefined
        ? ''
        : messageCopyLinkRecordUidCandidates([item], anchor === undefined ? [] : [anchor])[0] ?? ''
      if (item === undefined || parentRecordUid === '') {
        throw new ArkmePluginError('message-copy-link-extension-unavailable', '链接暂不可延展', false, 409)
      }
      const profileSnapshot = await this.profile.refreshProfile()
      const profile = profileSnapshot.profile
      if (profile === null) throw new ArkmePluginError('profile-unavailable', '无法读取当前 Arkme 账号资料', true)
      if (profile.contact.phoneMasked === undefined) {
        throw new ArkmePluginError('world-phone-binding-required', '请先在 Arkme 客户端绑定手机号，再延展快记', false)
      }
      const sendAtMillis = Date.now()
      const recordResult = await this.record.createTextForConversation(normalizedUid, normalizedText)
      if (recordResult.localState !== 'synced') {
        throw new ArkmePluginError(
          'message-copy-link-extension-record-pending',
          recordResult.error ?? '延展已保存到待重试队列，请稍后重试',
          true,
        )
      }
      const createdRecordUid = recordResult.recordUid.trim() || normalizedUid
      const data = await this.runtime.authenticatedWorldPost<Record<string, unknown>>(
        '/api/v1/public-record/publish',
        {
          record_uid: createdRecordUid,
          content: normalizedText,
          text_content: normalizedText,
          tags: messageCopyLinkWorldTags(normalizedText),
          original_topic_id: 0,
          created_at: sendAtMillis,
          nick_name: profile.nickname || profile.displayName,
          avatar: profile.avatarRef,
          template_kind: 1,
          parent_record_uid: parentRecordUid,
        },
        session,
        options.signal,
      )
      const publishedRecordUid = stringValue(data.record_uid).trim() || createdRecordUid
      const senderDisplayName = profile.nickname.trim() || profile.displayName.trim() || '我'
      const senderAvatarUrl = profile.avatarRef.trim()
      await this.realtime.invalidateRecordProjection()
      return {
        sid: detail.sid,
        recordUid: publishedRecordUid,
        parentRecordUid,
        status: numberValue(data.status ?? data.check_status ?? recordResult.status),
        localState: 'synced',
        extension: {
          recordUid: publishedRecordUid,
          level: 2,
          sourceKind: 'record_extension',
          senderDisplayName,
          ...(senderAvatarUrl === '' ? {} : { senderAvatarUrl }),
          title: '',
          textContent: normalizedText,
          sendAtMillis,
          templateKind: 1,
          displayKind: 0,
          officialMark: 0,
          mediaItems: [],
        },
      }
    }

  async forwardSourceMessages(
      sourceRef: string,
      actionRefs: readonly string[],
      options: { targetSourceRef?: string; recordUid?: string; relationUid?: string; commentText?: string; signal?: AbortSignal } = {},
    ): Promise<ArkmeSourceSendResult> {
      const session = await this.runtime.requireSession()
      const source = await this.source.openSourceRef(sourceRef, session.userId)
      const targetSourceRef = options.targetSourceRef?.trim() || sourceRef
      const targetSource = targetSourceRef === sourceRef ? source : await this.source.openSourceRef(targetSourceRef, session.userId)
      const commentText = options.commentText?.trim() ?? ''
      if (commentText.length > this.runtime.config.maxTextLength) {
        throw new ArkmePluginError('source-text-invalid', '发送内容超过长度限制', false)
      }
      if (targetSource.kind !== 'private_chat' && targetSource.kind !== 'group_chat'
        && targetSource.kind !== 'send_to_self' && targetSource.kind !== 'default_category' && targetSource.kind !== 'topic') {
        throw new ArkmePluginError('message-actions-source-invalid', '当前数据源暂不支持转发', false, 409)
      }
      const references = this.forwardReferencesOrderedForCommand(await this.openMessageActionRefs(actionRefs, session.userId, source))
      if (references.length === 0 || references.length > 100) {
        throw new ArkmePluginError('message-actions-selection-invalid', '请选择 1 至 100 条消息', false)
      }
      this.validateForwardReferences(references)
      const recordUid = options.recordUid?.trim() || randomUUID()
      const title = references.length === 1 ? '转发快记' : `转发 ${String(references.length)} 条快记`
      const contentPayload = {
        payload_kind: 1,
        schema_version: 1,
        text_state: 1,
        forward_records: {
          render_kind: 'forward_records',
          schema_version: 1,
          source_type: 'quick_records',
          title: '转发快记',
          source_record_uids: references.map(reference => reference.recordUid).filter(recordUid => recordUid.trim() !== ''),
          created_at: Date.now(),
          summary_lines: references.slice(0, 3).map(reference =>
            `${reference.senderName}: ${reference.textContent.trim() || reference.title.trim() || '非文本内容'}`,
          ),
          items: references.map((reference, index) => this.forwardPayloadItem(reference, index)),
        },
      }
      const appendCommentWarning = async (sent: ArkmeSourceSendResult): Promise<ArkmeSourceSendResult> => {
        if (commentText === '') return sent
        try {
          await this.sendSourceText(targetSourceRef, commentText, {
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          })
          return sent
        } catch {
          return { ...sent, warningText: '转发已完成，附言发送失败' }
        }
      }
      if (targetSource.kind === 'private_chat' || targetSource.kind === 'group_chat') {
        const sendAtMillis = Date.now()
        const clientRequestId = this.forwardClientRequestId(targetSource.ownerRef, references, sendAtMillis)
        const hasChatRecordSources = references.some(reference => reference.sourceKind === 'chat_relation')
        const sourceRecordUids = hasChatRecordSources
          ? []
          : references.map(reference => reference.recordUid).filter(recordUid => recordUid.trim() !== '')
        const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
          '/api/v1/chats/records/forward',
          {
            chat_session_uid: targetSource.ownerRef,
            client_request_id: clientRequestId,
            ...(sourceRecordUids.length === 0 ? {} : { source_record_uids: sourceRecordUids }),
            source_items: references.map(reference => this.forwardSourceItemBody(reference)),
            ...(commentText === '' ? {} : { comment_text: commentText }),
            send_at: sendAtMillis,
          },
          session,
          options.signal,
        )
        const sequence = numberValue(data.seq ?? data.sequence)
        this.realtime.scheduleChatSessionProjection(targetSource.ownerRef, sequence)
        return {
          sourceRef: targetSourceRef,
          itemUid: stringValue(data.record_uid).trim() || recordUid,
          status: numberValue(data.audit_status ?? data.status) || 1,
          ...(sequence > 0 ? { sequence } : {}),
          localState: 'synced',
        }
      }
      if (targetSource.kind === 'topic') {
        const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/records/create',
          {
            topic_uid: targetSource.ownerRef,
            record_uid: recordUid,
            template_kind: 1,
            title: '',
            text_content: title,
            content_payload: contentPayload,
            send_at: Date.now(),
          },
          session,
          options.signal,
        )
        await this.realtime.invalidateRecordProjection()
        return await appendCommentWarning({ sourceRef: targetSourceRef, itemUid: stringValue(data.record_uid).trim() || recordUid, status: numberValue(data.status), localState: 'synced' })
      }
      const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
        '/api/v1/records/create',
        {
          record_uid: recordUid,
          template_kind: 1,
          title: '',
          text_content: title,
          content_payload: contentPayload,
          send_at: Date.now(),
        },
        session,
        options.signal,
      )
      await this.realtime.invalidateRecordProjection()
      return await appendCommentWarning({ sourceRef: targetSourceRef, itemUid: stringValue(data.record_uid).trim() || recordUid, status: numberValue(data.status), localState: 'synced' })
    }
  
  async sendSourceText(
      sourceRef: string,
      textContent: string,
      options: {
        recordUid?: string
      relationUid?: string
        recordDurationMillis?: number
        captureContext?: ArkmeRecordCaptureContext
      botRefs?: readonly string[]
        humanMentions?: readonly ArkmeHumanMentionInput[]
        botMentions?: readonly ArkmeBotMentionInput[]
        signal?: AbortSignal
        agentAuthored?: boolean
      } = {},
    ): Promise<ArkmeSourceSendResult> {
      const session = await this.runtime.requireSession()
      const source = await this.source.openSourceRef(sourceRef, session.userId)
      const text = textContent.trim()
      if (text === '' || text.length > this.runtime.config.maxTextLength) {
        throw new ArkmePluginError('source-text-invalid', '发送内容为空或超过长度限制', false)
      }
      const recordUid = options.recordUid?.trim() || randomUUID()
      if (source.kind === 'send_to_self' || source.kind === 'default_category') {
        const result = await this.record.createTextForConversation(recordUid, text, {
          ...(options.recordDurationMillis === undefined ? {} : { recordDurationMillis: options.recordDurationMillis }),
          ...(options.captureContext === undefined ? {} : { captureContext: options.captureContext }),
        })
        if (result.localState !== 'failed') await this.realtime.invalidateRecordProjection()
        return {
          sourceRef,
          itemUid: result.recordUid,
          status: result.status,
          localState: result.localState,
          ...(result.error === undefined ? {} : { error: result.error }),
        }
      }
      if (source.kind === 'topic') {
        const captureContext = options.captureContext === undefined
          ? undefined
          : arkmeRecordCaptureContextPayload(options.captureContext)
        const result = await this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/records/create',
          {
            topic_uid: source.ownerRef, record_uid: recordUid, template_kind: 1, title: '', text_content: text,
            ...(Math.max(0, Math.trunc(options.recordDurationMillis ?? 0)) === 0
              ? {}
              : { record_duration_millis: Math.max(0, Math.trunc(options.recordDurationMillis ?? 0)) }),
            ...(captureContext === undefined || Object.keys(captureContext).length === 0
              ? {}
              : { capture_context: captureContext }),
            send_at: Date.now(),
          },
          session,
        )
        await this.realtime.invalidateRecordProjection()
        return { sourceRef, itemUid: stringValue(result.record_uid).trim() || recordUid, status: numberValue(result.status), localState: 'synced' }
      }
      const relationUid = options.relationUid?.trim() || randomUUID()
      const agentAuthored = isAgentAuthoredChatSend(options)
      let sent: ArkmeSourceSendResult
      if (source.kind === 'group_chat') {
        if ((options.botRefs?.length ?? 0) > 0
          && ((options.humanMentions?.length ?? 0) > 0 || (options.botMentions?.length ?? 0) > 0)) {
          throw new ArkmePluginError('mention-kind-conflict', 'bot_refs 不能和结构化 mention 同时使用', false)
        }
        if (options.botRefs !== undefined && options.botRefs.length > 0) {
          sent = await this.groupBotMentionSend(
            sourceRef, source, text, options.botRefs, recordUid, relationUid, session, options.signal,
            {
              agentAuthored,
              ...(options.recordDurationMillis === undefined ? {} : { recordDurationMillis: options.recordDurationMillis }),
              ...(options.captureContext === undefined ? {} : { captureContext: options.captureContext }),
            },
          )
        } else if ((options.humanMentions?.length ?? 0) > 0 || (options.botMentions?.length ?? 0) > 0) {
          const contentPayload = await this.mentionContentPayload(
            source, textContent, text, options.humanMentions ?? [], options.botMentions ?? [], session, options.signal,
          )
          sent = await this.sendChatSourceTextRaw(
            sourceRef, source.ownerRef, text, recordUid, relationUid, session, undefined, contentPayload,
            options.signal, {
              agentAuthored,
              ...(options.recordDurationMillis === undefined ? {} : { recordDurationMillis: options.recordDurationMillis }),
              ...(options.captureContext === undefined ? {} : { captureContext: options.captureContext }),
            },
          )
        } else {
          sent = await this.aiPolish.sendGroupSourceTextWithAiPolish(
            sourceRef,
            source.ownerRef,
            text,
            recordUid,
            relationUid,
            session,
            {
              agentAuthored,
              ...(options.recordDurationMillis === undefined ? {} : { recordDurationMillis: options.recordDurationMillis }),
              ...(options.captureContext === undefined ? {} : { captureContext: options.captureContext }),
              ...(options.signal === undefined ? {} : { signal: options.signal }),
            },
          )
        }
      } else if ((options.humanMentions?.length ?? 0) > 0) {
        throw new ArkmePluginError('mention-group-required', '真人 mention 只能发送到群聊', false)
      } else if ((options.botRefs?.length ?? 0) > 0) {
        throw new ArkmePluginError('mention-group-required', 'bot_refs 只能发送到群聊', false)
      } else if ((options.botMentions?.length ?? 0) > 0) {
        const contentPayload = await this.mentionContentPayload(
          source, textContent, text, [], options.botMentions ?? [], session, options.signal,
        )
        sent = await this.sendChatSourceTextRaw(
          sourceRef, source.ownerRef, text, recordUid, relationUid, session, undefined, contentPayload, options.signal,
          {
            agentAuthored,
            ...(options.recordDurationMillis === undefined ? {} : { recordDurationMillis: options.recordDurationMillis }),
            ...(options.captureContext === undefined ? {} : { captureContext: options.captureContext }),
          },
        )
      } else {
        sent = await this.sendChatSourceTextRaw(
          sourceRef, source.ownerRef, text, recordUid, relationUid, session, undefined, undefined, options.signal,
          {
            agentAuthored,
            ...(options.recordDurationMillis === undefined ? {} : { recordDurationMillis: options.recordDurationMillis }),
            ...(options.captureContext === undefined ? {} : { captureContext: options.captureContext }),
          },
        )
      }
      if (agentAuthored && sent.localState === 'synced') void this.arko.agentSourceDisplayName(session)
      return sent
    }
  
  private async mentionContentPayload(
    source: ArkmeSourceRefPayload,
    rawText: string,
    normalizedText: string,
    humanInputs: readonly ArkmeHumanMentionInput[],
    botInputs: readonly ArkmeBotMentionInput[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (humanInputs.length > 50) throw new ArkmePluginError('human-mention-invalid', '单条消息 mention 数量过多', false)
    if (botInputs.length > 50) throw new ArkmePluginError('bot-mention-invalid', '单条消息 Bot mention 数量过多', false)
    const [mentions, botMentions] = await Promise.all([
      this.humanMentionMetadata(source, rawText, normalizedText, humanInputs, session, signal),
      this.botMentionMetadata(source, rawText, normalizedText, botInputs, session, signal),
    ])
    const orderedRanges = [
      ...mentions.map(mention => ({ startIndex: mention.start_index, length: mention.length })),
      ...botMentions.map(mention => ({ startIndex: mention.start_index, length: mention.length })),
    ].sort((left, right) => left.startIndex - right.startIndex)
    for (let index = 1; index < orderedRanges.length; index += 1) {
      const previous = orderedRanges[index - 1]!
      const current = orderedRanges[index]!
      if (previous.startIndex + previous.length > current.startIndex) {
        throw new ArkmePluginError('mention-overlap', 'Mention 文本区间重叠', false)
      }
    }
    const checksumInput = {
      text_content: normalizedText,
      human_mentions: mentions.map(mention => ({
        user_id: mention.user_id,
        start_index: mention.start_index,
        length: mention.length,
      })),
      bot_mentions: botMentions.map(mention => ({
        bot_uid: mention.bot_uid,
        start_index: mention.start_index,
        length: mention.length,
      })),
    }
    return {
      payload_kind: 1,
      schema_version: 1,
      text_state: 1,
      mention_metadata: {
        schema_version: 1,
        source_checksum: createHash('sha256').update(JSON.stringify(checksumInput)).digest('hex'),
        ...(mentions.length === 0 ? {} : { human_mentions: mentions }),
        ...(botMentions.length === 0 ? {} : { bot_mentions: botMentions }),
      },
    }
  }

  private async humanMentionMetadata(
    source: ArkmeSourceRefPayload,
    rawText: string,
    normalizedText: string,
    inputs: readonly ArkmeHumanMentionInput[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Array<{ user_id: number; display_name_snapshot: string; start_index: number; length: number }>> {
    const leadingTrim = rawText.length - rawText.trimStart().length
    const requiresMemberDirectory = inputs.some(input => input.all !== true)
    const rawMembers = requiresMemberDirectory
      ? await this.rawChatMembers(source.ownerRef, true, session, signal)
      : []
    const membersByUserId = new Map(rawMembers.map(item => [Math.trunc(numberValue(item.user_id)), item]))
    const mentions: Array<{ user_id: number; display_name_snapshot: string; start_index: number; length: number }> = []
    for (const input of [...inputs].sort((left, right) => left.startIndex - right.startIndex)) {
      const rawInput = input as unknown as Record<string, unknown>
      const mentionRef = input.mentionRef?.trim() ?? ''
      const memberRef = stringValue(rawInput.memberRef).trim()
      const startIndex = Math.trunc(input.startIndex) - leadingTrim
      const length = Math.trunc(input.length)
      if (startIndex < 0 || length < 2
        || startIndex + length > normalizedText.length) {
        throw new ArkmePluginError('human-mention-invalid', '真人 mention 引用或文本区间无效', false)
      }
      const visible = normalizedText.slice(startIndex, startIndex + length)
      const displayName = visible.startsWith('@') ? visible.slice(1) : ''
      let userId: number
      if (input.all === true) {
        if (mentionRef !== '' || memberRef !== '') {
          throw new ArkmePluginError('human-mention-invalid', '@所有人不能携带成员引用', false)
        }
        if (displayName !== '所有人') {
          throw new ArkmePluginError('human-mention-text-mismatch', '真人 mention 文本已变化，请重新选择成员', false, 409)
        }
        userId = 0
      } else {
        if (mentionRef === '' || memberRef !== '') {
          throw new ArkmePluginError('human-mention-invalid', '真人 mention 必须且只能携带 mention 引用', false)
        }
        const reference = await this.openChatHumanMentionRef(mentionRef, session.userId, source.ownerRef)
        const targetUserId = reference.targetUserId
        if (targetUserId === session.userId) {
          throw new ArkmePluginError('human-mention-self-invalid', '不能 @ 自己', false)
        }
        const rawMember = membersByUserId.get(targetUserId)
        if (rawMember === undefined) throw new ArkmePluginError('chat-member-ref-stale', '被 @ 成员已不在当前群聊', false, 409)
        if (displayName === '' || displayName !== reference.displayNameSnapshot) {
          throw new ArkmePluginError('human-mention-text-mismatch', '真人 mention 文本已变化，请重新选择成员', false, 409)
        }
        userId = targetUserId
      }
      const previous = mentions.at(-1)
      if (previous !== undefined && previous.start_index + previous.length > startIndex) {
        throw new ArkmePluginError('human-mention-overlap', '真人 mention 文本区间重叠', false)
      }
      mentions.push({
        user_id: userId,
        display_name_snapshot: displayName,
        start_index: startIndex,
        length,
      })
    }
    return mentions
  }

  private async botMentionMetadata(
    source: ArkmeSourceRefPayload,
    rawText: string,
    normalizedText: string,
    inputs: readonly ArkmeBotMentionInput[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Array<{ bot_uid: string; display_name_snapshot: string; start_index: number; length: number }>> {
    if (inputs.length === 0) return []
    if (source.kind !== 'group_chat' && source.kind !== 'private_chat') {
      throw new ArkmePluginError('mention-chat-required', 'Bot mention 只能发送到聊天', false)
    }
    const leadingTrim = rawText.length - rawText.trimStart().length
    const uniqueRefs = [...new Set(inputs.map(input => input.botRef.trim()))]
    if (uniqueRefs.some(ref => ref === '')) throw new ArkmePluginError('bot-mention-ref-invalid', 'Bot mention 引用为空', false)
    const references = await Promise.all(uniqueRefs.map(async ref => ({
      ref,
      value: await this.bot.openBotRef(ref, session.userId),
    })))
    const allowedByBotId = new Map<string, { bot_uid: string; display_name_snapshot: string }>()
    if (source.kind === 'group_chat') {
      const groupBots = await this.bot.listMentionableGroupBots(source, session, signal)
      const requested = new Set(references.map(item => item.value.botId))
      for (const { botId, name } of groupBots) {
        if (!requested.has(botId)) continue
        allowedByBotId.set(botId, { bot_uid: botId, display_name_snapshot: name })
      }
    } else {
      const bots = (await this.bot.listBots(signal === undefined ? {} : { signal })).items
      const botNameByRef = new Map(bots
        .filter(bot => bot.provider === 'openclaw')
        .map(bot => [bot.botRef, bot.name]))
      for (const reference of references) {
        if (reference.value.provider !== 'openclaw') {
          throw new ArkmePluginError('bot-provider-mismatch', '只有 OpenClaw Bot 可以被 mention', false, 400)
        }
        const name = botNameByRef.get(reference.ref)
        if (name === undefined || name.trim() === '') {
          throw new ArkmePluginError('bot-mention-not-available', '所选 Bot 当前不可 mention', false, 409)
        }
        allowedByBotId.set(reference.value.botId, { bot_uid: reference.value.botId, display_name_snapshot: name.trim() })
      }
    }
    const refToBotId = new Map(references.map(item => [item.ref, item.value.botId]))
    return [...inputs].sort((left, right) => left.startIndex - right.startIndex).map(input => {
      const botRef = input.botRef.trim()
      const botId = refToBotId.get(botRef)
      const bot = botId === undefined ? undefined : allowedByBotId.get(botId)
      if (bot === undefined) throw new ArkmePluginError('bot-mention-not-available', '所选 Bot 当前不可 mention', false, 409)
      const startIndex = Math.trunc(input.startIndex) - leadingTrim
      const length = Math.trunc(input.length)
      if (startIndex < 0 || length < 2 || startIndex + length > normalizedText.length) {
        throw new ArkmePluginError('bot-mention-invalid', 'Bot mention 引用或文本区间无效', false)
      }
      const visible = normalizedText.slice(startIndex, startIndex + length)
      if (visible !== `@${bot.display_name_snapshot}`) {
        throw new ArkmePluginError('bot-mention-text-mismatch', 'Bot mention 文本已变化，请重新选择 Bot', false, 409)
      }
      return { ...bot, start_index: startIndex, length }
    })
  }

  async groupBotMentionSend(
      sourceRef: string,
      source: ArkmeSourceRefPayload,
      text: string,
      botRefs: readonly string[],
      recordUid: string,
      relationUid: string,
      session: ArkmeSessionCredentials,
      signal?: AbortSignal,
      options: { agentAuthored?: boolean; recordDurationMillis?: number; captureContext?: ArkmeRecordCaptureContext } = {},
    ): Promise<ArkmeSourceSendResult> {
      const uniqueRefs = new Set(botRefs.map(ref => ref.trim()))
      if (uniqueRefs.has('') || uniqueRefs.size !== botRefs.length) {
        throw new ArkmePluginError('bot-mention-ref-invalid', 'Bot mention 引用为空或重复', false)
      }
      const references = await Promise.all([...uniqueRefs].map(async ref => ({
        ref,
        value: await this.bot.openBotRef(ref, session.userId),
      })))
      const requestedById = new Map(references.map(item => [item.value.botId, item.ref]))
      if (requestedById.size !== references.length) {
        throw new ArkmePluginError('bot-mention-ref-invalid', 'Bot mention 引用重复', false)
      }
      const groupBots = await this.bot.listMentionableGroupBots(source, session, signal)
      const mentions: Array<{ bot_uid: string; display_name_snapshot: string; start_index: number; length: number }> = []
      let visibleText = ''
      for (const { botId, name } of groupBots) {
        if (!requestedById.has(botId)) continue
        const display = `@${name}`
        const startIndex = visibleText.length
        visibleText += `${display} `
        mentions.push({
          bot_uid: botId,
          display_name_snapshot: name,
          start_index: startIndex,
          length: display.length,
        })
        requestedById.delete(botId)
      }
      if (requestedById.size > 0) {
        throw new ArkmePluginError('bot-mention-not-installed', '所选 Bot 未安装到该群聊', false, 409)
      }
      visibleText += text
      if (visibleText.length > this.runtime.config.maxTextLength) {
        throw new ArkmePluginError('source-text-invalid', '发送内容超过长度限制', false)
      }
      const checksumInput = {
        text_content: visibleText,
        human_mentions: [],
        bot_mentions: mentions.map(mention => ({
          bot_uid: mention.bot_uid,
          start_index: mention.start_index,
          length: mention.length,
        })),
      }
      const contentPayload = {
        payload_kind: 1,
        schema_version: 1,
        text_state: 1,
        mention_metadata: {
          schema_version: 1,
          source_checksum: createHash('sha256').update(JSON.stringify(checksumInput)).digest('hex'),
          bot_mentions: mentions,
        },
      }
      return await this.sendChatSourceTextRaw(
        sourceRef, source.ownerRef, visibleText, recordUid, relationUid, session, undefined, contentPayload, signal, options,
      )
    }

  async sendChatSourceTextRaw(
      sourceRef: string,
      chatSessionUid: string,
      text: string,
      recordUid: string,
      relationUid: string,
      session: ArkmeSessionCredentials,
      initialAiPolish?: Record<string, unknown>,
      contentPayload?: Record<string, unknown>,
      signal?: AbortSignal,
      options: { agentAuthored?: boolean; recordDurationMillis?: number; captureContext?: ArkmeRecordCaptureContext } = {},
    ): Promise<ArkmeSourceSendResult> {
      const result = await this.postChatTextRecord(
        chatSessionUid,
        text,
        recordUid,
        relationUid,
        Date.now(),
        session,
        signal,
        {
          ...options,
          ...(initialAiPolish === undefined ? {} : { initialAiPolish }),
          ...(contentPayload === undefined ? {} : { contentPayload }),
        },
      )
      const sequence = numberValue(result.seq)
      this.realtime.scheduleChatSessionProjection(chatSessionUid, sequence)
      return {
        sourceRef,
        itemUid: stringValue(result.record_uid).trim() || recordUid,
        status: numberValue(result.audit_status),
        sequence,
        localState: 'synced',
      }
    }

  private async postChatTextRecord(
    chatSessionUid: string,
    text: string,
    recordUid: string,
    relationUid: string,
    sendAtMillis: number,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
    options: {
      agentAuthored?: boolean
      recordDurationMillis?: number
      captureContext?: ArkmeRecordCaptureContext
      initialAiPolish?: Record<string, unknown>
      contentPayload?: Record<string, unknown>
    } = {},
  ): Promise<Record<string, unknown>> {
    return await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/records/send',
      {
        chat_session_uid: chatSessionUid,
        record_uid: recordUid,
        rel_uid: relationUid,
        template_kind: 1,
        text_content: text,
        ...(Math.max(0, Math.trunc(options.recordDurationMillis ?? 0)) === 0 ? {} : { record_duration_millis: Math.max(0, Math.trunc(options.recordDurationMillis ?? 0)) }),
        ...(options.captureContext === undefined ? {} : { capture_context: arkmeRecordCaptureContextPayload(options.captureContext) }),
        ...(options.agentAuthored === true ? { creation_source: 1 } : {}),
        ...(options.initialAiPolish === undefined ? {} : { initial_ai_polish: options.initialAiPolish }),
        ...(options.contentPayload === undefined ? {} : { content_payload: options.contentPayload }),
        send_at: sendAtMillis,
      },
      session,
      signal,
    )
  }
  
  async sendSourceRich(
      sourceRef: string,
      input: ArkmeRichSendInput,
      options: { recordUid?: string; relationUid?: string; expectedUserId?: number; signal?: AbortSignal } = {},
    ): Promise<ArkmeSourceSendResult> {
      if (this.runtime.config.richMediaSendEnabled === false) {
        throw new ArkmePluginError('rich-content-disabled', '富内容发送已被插件配置关闭', false, 403)
      }
      const session = await this.runtime.requireSession()
      if (options.expectedUserId !== undefined && options.expectedUserId !== session.userId) throw new ArkmePluginError('file-account-changed', '账号已切换', false, 403)
      options.signal?.throwIfAborted()
      const source = await this.source.openSourceRef(sourceRef, session.userId)
      const title = input.title?.trim() ?? ''
      const textContent = input.textContent?.trim() ?? ''
      const assets = input.assets ?? []
      const displayKind = input.displayKind === 1 ? 1 : 0
      const longArticle = displayKind === 1
      const maxContentLength = longArticle ? 40000 : this.runtime.config.maxTextLength
      const thinkingDurationMillis = Math.max(0, Math.trunc(input.thinkingDurationMillis ?? 0))
      const recordDurationMillis = Math.max(0, Math.trunc(input.recordDurationMillis ?? (longArticle ? thinkingDurationMillis : 0)))
      const captureContext = input.captureContext === undefined ? undefined : arkmeRecordCaptureContextPayload(input.captureContext)
      if (title.length > (longArticle ? 100 : 500) || textContent.length > maxContentLength || assets.length > 20
        || (textContent === '' && title === '' && assets.length === 0)) {
        throw new ArkmePluginError('rich-content-invalid', '富内容为空、过长或附件数量超限', false)
      }
      if (longArticle && (title === '' || textContent === '')) {
        throw new ArkmePluginError('long-article-invalid', '长文标题和正文不能为空', false)
      }
      for (const asset of assets) {
        if (!/^[A-Za-z0-9._:-]{8,256}$/.test(asset.fileAssetUid) || asset.size < 0
          || ![1, 2, 3, 4].includes(asset.fileKind)) {
          throw new ArkmePluginError('rich-asset-invalid', '附件资产参数无效', false)
        }
      }
      const recordUid = options.recordUid?.trim() || randomUUID()
      const relationUid = options.relationUid?.trim() || randomUUID()
      const templateKind = longArticle ? 1 : assets.length === 0 ? 1 : 2
      const mediaContentPayload = assets.length === 0 ? undefined : {
        payload_kind: 2,
        schema_version: 1,
        text_state: textContent === '' ? 3 : 1,
        media_refs: assets.map((asset, index) => ({
          file_asset_uid: asset.fileAssetUid,
          content_file_role: 1,
          render_role: 1,
          sort_order: index,
          file_name: asset.fileName,
          file_kind: asset.fileKind,
          mime_type: asset.mimeType,
          size: asset.size,
        })),
      }
      let contentPayload: Record<string, unknown> | undefined = mediaContentPayload
      if ((input.humanMentions?.length ?? 0) > 0 || (input.botMentions?.length ?? 0) > 0) {
        if ((input.humanMentions?.length ?? 0) > 0 && source.kind !== 'group_chat') {
          throw new ArkmePluginError('mention-group-required', '真人 mention 只能发送到群聊', false)
        }
        if ((input.botMentions?.length ?? 0) > 0 && source.kind !== 'group_chat' && source.kind !== 'private_chat') {
          throw new ArkmePluginError('mention-chat-required', 'Bot mention 只能发送到聊天', false)
        }
        if (longArticle) throw new ArkmePluginError('mention-rich-invalid', '长文暂不支持 mention', false)
        const mentionPayload = await this.mentionContentPayload(
          source, input.textContent ?? '', textContent, input.humanMentions ?? [], input.botMentions ?? [], session,
          options.signal,
        )
        contentPayload = { ...(mediaContentPayload ?? {}), ...mentionPayload }
      }
      const commonBody = {
        record_uid: recordUid,
        template_kind: templateKind,
        display_kind: displayKind,
        title,
        text_content: textContent,
        ...(recordDurationMillis === 0 ? {} : { record_duration_millis: recordDurationMillis }),
        ...(captureContext === undefined || Object.keys(captureContext).length === 0 ? {} : { capture_context: captureContext }),
        ...(contentPayload === undefined ? {} : { content_payload: contentPayload }),
        send_at: Date.now(),
      }
      if (source.kind === 'send_to_self' || source.kind === 'default_category') {
        const result = await this.runtime.authenticatedPost<Record<string, unknown>>('/api/v1/records/create', commonBody, session, options.signal)
        await this.realtime.invalidateRecordProjection()
        return { sourceRef, itemUid: stringValue(result.record_uid).trim() || recordUid, status: numberValue(result.status), localState: 'synced' }
      }
      if (source.kind === 'topic') {
        const result = await this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/records/create', { topic_uid: source.ownerRef, ...commonBody }, session, options.signal,
        )
        await this.realtime.invalidateRecordProjection()
        return { sourceRef, itemUid: stringValue(result.record_uid).trim() || recordUid, status: numberValue(result.status), localState: 'synced' }
      }
      const result = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/records/send',
        { chat_session_uid: source.ownerRef, rel_uid: relationUid, ...commonBody },
        session,
        options.signal,
      )
      const sequence = numberValue(result.seq)
      this.realtime.scheduleChatSessionProjection(source.ownerRef, sequence)
      return {
        sourceRef,
        itemUid: stringValue(result.record_uid).trim() || recordUid,
        status: numberValue(result.audit_status ?? result.status),
        sequence,
        localState: 'synced',
      }
    }

  private async favoriteStickerDocument(
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<{ root: Record<string, unknown>; items: Record<string, unknown>[] }> {
    const root = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/favorite-stickers/get', {}, session, signal,
    )
    return { root, items: listValue(root.items).map(objectValue) }
  }

  private favoriteStickerView(raw: Record<string, unknown>, viewerUserId: number): ArkmeFavoriteSticker | undefined {
    const fileAssetUid = stringValue(raw.file_asset_uid).trim()
    if (fileAssetUid === '') return undefined
    const mimeType = stringValue(raw.mime_type).trim() || 'image/*'
    const fileName = stringValue(raw.file_name).trim() || '收藏表情'
    const mediaRef = this.media.favoriteStickerMediaRef(raw, viewerUserId)
    const serverAvailable = raw.is_available !== false
    return {
      fileAssetUid,
      fileName,
      mimeType,
      size: Math.max(0, Math.trunc(numberValue(raw.file_size ?? raw.size))),
      fileKind: 1,
      isAnimated: booleanValue(raw.is_animated) || mimeType.toLowerCase() === 'image/gif',
      isAvailable: serverAvailable && mediaRef !== undefined,
      ...(mediaRef === undefined ? {} : { mediaRef }),
      ...(!serverAvailable || mediaRef === undefined
        ? { unavailableReason: stringValue(raw.unavailable_reason).trim() || '表情已不可用' }
        : {}),
    }
  }

  async favoriteStickers(signal?: AbortSignal): Promise<ArkmeFavoriteStickerList> {
    const session = await this.runtime.requireSession()
    const { root, items } = await this.favoriteStickerDocument(session, signal)
    const projected = items.flatMap(item => {
      const view = this.favoriteStickerView(item, session.userId)
      return view === undefined ? [] : [view]
    })
    return {
      items: projected,
      itemCount: projected.length,
      updatedAtMillis: Math.max(0, Math.trunc(numberValue(root.updated_at_millis ?? root.updated_at))),
    }
  }

  async addFavoriteSticker(
    item: ArkmeFavoriteStickerAddInput,
    signal?: AbortSignal,
  ): Promise<ArkmeFavoriteStickerList> {
    const fileAssetUid = item.fileAssetUid.trim()
    if (!/^[A-Za-z0-9._:-]{8,256}$/.test(fileAssetUid) || item.fileKind !== 1 || !item.mimeType.toLowerCase().startsWith('image/')) {
      throw new ArkmePluginError('favorite-sticker-invalid', '收藏表情参数无效', false, 400)
    }
    return await this.serializeFavoriteStickerMutation(async () => {
      const session = await this.runtime.requireSession()
      const { items } = await this.favoriteStickerDocument(session, signal)
      const remaining = items.filter(existing => stringValue(existing.file_asset_uid).trim() !== fileAssetUid)
      if (remaining.length >= 200) throw new ArkmePluginError('favorite-stickers-limit', '收藏表情最多 200 个', false, 400)
      const normalized = {
        file_asset_uid: fileAssetUid,
        file_name: item.fileName.trim() || '收藏表情',
        mime_type: item.mimeType.trim().toLowerCase(),
        file_kind: 1,
        file_size: Math.max(0, Math.trunc(item.size)),
        is_animated: item.isAnimated === true || item.mimeType.toLowerCase() === 'image/gif',
      }
      await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/favorite-stickers/set', { items: [normalized, ...remaining.map(favoriteStickerPersistenceItem)] }, session, signal,
      )
      return await this.favoriteStickers(signal)
    })
  }

  async manageFavoriteSticker(
    fileAssetUid: string,
    action: ArkmeFavoriteStickerManageAction,
    signal?: AbortSignal,
  ): Promise<ArkmeFavoriteStickerList> {
    const normalizedUid = fileAssetUid.trim()
    if (!/^[A-Za-z0-9._:-]{8,256}$/.test(normalizedUid) || (action !== 'move-to-front' && action !== 'delete')) {
      throw new ArkmePluginError('favorite-sticker-manage-invalid', '收藏表情管理参数无效', false, 400)
    }
    return await this.serializeFavoriteStickerMutation(async () => {
      const session = await this.runtime.requireSession()
      const { items } = await this.favoriteStickerDocument(session, signal)
      const targetIndex = items.findIndex(item => stringValue(item.file_asset_uid).trim() === normalizedUid)
      if (targetIndex < 0) throw new ArkmePluginError('favorite-sticker-not-found', '收藏表情不存在', false, 404)
      const nextItems = [...items]
      const [target] = nextItems.splice(targetIndex, 1)
      if (action === 'move-to-front' && target !== undefined) nextItems.unshift(target)
      await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/favorite-stickers/set', { items: nextItems.map(favoriteStickerPersistenceItem) }, session, signal,
      )
      return await this.favoriteStickers(signal)
    })
  }

  async sendFavoriteSticker(
    sourceRef: string,
    fileAssetUid: string,
    options: { recordUid?: string; relationUid?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeSourceSendResult> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'private_chat' && source.kind !== 'group_chat') {
      throw new ArkmePluginError('favorite-sticker-chat-required', '收藏表情只能发送到聊天', false, 400)
    }
    const { items } = await this.favoriteStickerDocument(session, options.signal)
    const sticker = items.find(item => stringValue(item.file_asset_uid).trim() === fileAssetUid.trim())
    if (sticker === undefined || sticker.is_available === false) {
      throw new ArkmePluginError('favorite-sticker-unavailable', '该收藏表情已不可用', false, 404)
    }
    const recordUid = options.recordUid?.trim() || randomUUID()
    const relationUid = options.relationUid?.trim() || randomUUID()
    const result = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/records/send', {
        chat_session_uid: source.ownerRef,
        record_uid: recordUid,
        rel_uid: relationUid,
        template_kind: 2,
        text_content: '',
        content_payload: {
          payload_kind: 2,
          schema_version: 1,
          text_state: 4,
          media_refs: [{
            file_asset_uid: stringValue(sticker.file_asset_uid).trim(),
            ...(stringValue(sticker.file_id).trim() === '' ? {} : { file_id: stringValue(sticker.file_id).trim() }),
            content_file_role: 1,
            render_role: 3,
            sort_order: 0,
            file_kind: 1,
            file_type: Math.trunc(numberValue(sticker.file_type)),
            mime_type: stringValue(sticker.mime_type).trim(),
            file_name: stringValue(sticker.file_name).trim(),
          }],
        },
        send_at: Date.now(),
      }, session, options.signal,
    )
    return {
      sourceRef,
      itemUid: stringValue(result.record_uid).trim() || recordUid,
      status: numberValue(result.audit_status ?? result.status),
      sequence: numberValue(result.seq),
      localState: 'synced',
    }
  }
  
  async longArticleDetail(sourceRef: string, itemUid: string, signal?: AbortSignal): Promise<ArkmeLongArticleDetail> {
      return await this.record.longArticleDetail(sourceRef, itemUid, signal)
    }
  
  async updateLongArticle(
      sourceRef: string,
      itemUid: string,
      input: { title: string; textContent: string; version: number; editDurationMillis: number },
    ): Promise<ArkmeLongArticleDetail> {
      return await this.record.updateLongArticle(sourceRef, itemUid, input)
    }
  
  async getLongArticleDraft(sourceRef: string, itemUid?: string): Promise<ArkmeLongArticleDraft | undefined> {
      return await this.record.getLongArticleDraft(sourceRef, itemUid)
    }
  
  async putLongArticleDraft(draft: ArkmeLongArticleDraft): Promise<void> {
      return await this.record.putLongArticleDraft(draft)
    }
  
  async removeLongArticleDraft(sourceRef: string, itemUid?: string): Promise<void> {
      return await this.record.removeLongArticleDraft(sourceRef, itemUid)
    }
  
  async uploadLocalFile(
      filePath: string,
      metadata: { size: number; sha256: string; mimeType: string; fileName: string; fileKind: 1 | 2 | 3 | 4 },
    ): Promise<ArkmeUploadedAsset> {
      return await this.media.uploadLocalFile(filePath, metadata)
    }
  
  async fetchMedia(
      mediaRef: string,
      range?: string,
      signal?: AbortSignal,
    ): Promise<{ response: Response; descriptor: ArkmeMediaDescriptor }> {
      return await this.media.fetchMedia(mediaRef, range, signal)
    }
  
  async sendDirectText(
      recipientArkmeId: string,
      textContent: string,
      options: {
        recordUid?: string
        relationUid?: string
        sendAtMillis?: number
        signal?: AbortSignal
      } = {},
    ): Promise<ArkmeDirectTextSendResult> {
      const session = await this.runtime.requireSession()
      const recipient = recipientArkmeId.trim()
      if (recipient === '') {
        throw new ArkmePluginError('direct-recipient-invalid', '接收方 Arkme ID 不能为空', false)
      }
      const text = textContent.trim()
      if (text === '' || text.length > this.runtime.config.maxTextLength) {
        throw new ArkmePluginError('direct-text-invalid', '发送内容为空或超过长度限制', false)
      }
      const recordUid = options.recordUid?.trim() || randomUUID()
      const relationUid = options.relationUid?.trim() || randomUUID()
      const sendAtMillis = options.sendAtMillis ?? Date.now()
      if (!Number.isSafeInteger(sendAtMillis) || sendAtMillis <= 0) {
        throw new ArkmePluginError('direct-send-at-invalid', '发送时间无效', false)
      }
      const result = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/agent/records/send',
        {
          recipient_jotmo_id: recipient,
          record_uid: recordUid,
          rel_uid: relationUid,
          text_content: text,
          creation_source: 1,
          send_at: sendAtMillis,
        },
        session,
        options.signal,
      )
      const chatSessionUid = stringValue(result.chat_session_uid).trim()
      const sequence = numberValue(result.seq)
      const targetKind = stringValue(result.target_kind).trim()
      if (chatSessionUid === '' || !Number.isSafeInteger(sequence) || sequence <= 0 || targetKind !== 'direct') {
        throw new ArkmePluginError('direct-send-response-invalid', 'Chat Agent 发送返回了无效响应', true, 502)
      }
      const responseRecordUid = stringValue(result.record_uid).trim() || recordUid
      const responseRelationUid = stringValue(result.rel_uid).trim() || relationUid
      void this.arko.agentSourceDisplayName(session)
      return {
        recipientArkmeId: recipient,
        chatSessionUid,
        recordUid: responseRecordUid,
        relationUid: responseRelationUid,
        sequence,
        targetKind: 'direct',
      }
    }
  
  async markSourceRead(
    sourceRef: string,
    readSequence: number,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeSourceReadResult> {
      const session = await this.runtime.requireSession()
      const source = await this.source.openSourceRef(sourceRef, session.userId)
      if (source.kind !== 'private_chat' && source.kind !== 'group_chat') {
        throw new ArkmePluginError('source-read-unsupported', '当前数据源不支持聊天已读', false)
      }
      if (!Number.isSafeInteger(readSequence) || readSequence <= 0) {
        throw new ArkmePluginError('source-read-sequence-invalid', '聊天已读游标无效', false)
      }
      return await this.advanceChatReadCursor(sourceRef, source.ownerRef, readSequence, session, options.signal)
    }

  private async advanceChatReadCursor(
    sourceRef: string,
    chatSessionUid: string,
    readSequence: number,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeSourceReadResult> {
      if (!Number.isSafeInteger(readSequence) || readSequence <= 0) {
        throw new ArkmePluginError('source-read-sequence-invalid', '聊天已读游标无效', false)
      }
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/cursor/update',
        {
          chat_session_uid: chatSessionUid,
          read_seq: readSequence,
          read_at: Date.now(),
          client_ack_id: randomUUID(),
          reason: 'arkme_dsh_open_chat',
        },
        session,
        signal,
      )
      const responseSessionUid = stringValue(data.chat_session_uid).trim()
      const responseUserId = numberValue(data.user_id)
      const effectiveReadSequence = numberValue(data.effective_read_seq)
      const readAt = numberValue(data.read_at)
      const sessionLastSequence = numberValue(data.session_last_seq)
      const unreadCount = numberValue(data.unread_count)
      if (responseSessionUid !== chatSessionUid || responseUserId !== session.userId
        || !Number.isSafeInteger(effectiveReadSequence)
        || effectiveReadSequence < readSequence || !Number.isSafeInteger(readAt) || readAt <= 0
        || !Number.isSafeInteger(sessionLastSequence) || sessionLastSequence < effectiveReadSequence
        || !Number.isSafeInteger(unreadCount) || unreadCount < 0) {
        throw new ArkmePluginError('source-read-ack-invalid', '聊天已读响应不完整', true, 502)
      }
      const cacheKey = `${String(session.userId)}:${chatSessionUid}`
      const cached = this.source.cachedChatSourceByKey(cacheKey)
      if (cached !== undefined) {
        this.source.setChatSourceByKey(cacheKey, {
          ...cached,
          unreadCount,
          ...(unreadCount <= 0 ? { hasUnreadMention: false } : {}),
        })
      }
      this.realtime.emitChatClientEvent({
        type: 'read-ack',
        revision: this.realtime.nextChatClientRevision(),
        sourceRef,
        sourceKey: await this.source.chatDirectorySourceKey(session.userId, chatSessionUid),
        effectiveReadSequence,
        unreadCount,
      })
      this.realtime.scheduleChatSessionProjection(chatSessionUid, sessionLastSequence)
      return { sourceRef, effectiveReadSequence, unreadCount }
    }
  
  async chatSourceFromBundle(
      bundle: Record<string, unknown>,
      session: ArkmeSessionCredentials,
      cached: ArkmeSourceItem | undefined,
      timelineItems: ArkmeTimelineItem[],
    ): Promise<ArkmeSourceItem> {
      return await this.source.chatSourceFromBundle(bundle, session, cached, timelineItems)
    }
  
  async chatTimelineItems(
      data: Record<string, unknown>,
      session: ArkmeSessionCredentials,
      chatSessionUid: string,
    ): Promise<ArkmeTimelineItem[]> {
      const items: ArkmeTimelineItem[] = []
      const signingKey = await this.runtime.stateStore.uniqueCode()
      for (const raw of listValue(data.items)) {
        const item = objectValue(raw)
        const relation = objectValue(item.relation)
        const record = objectValue(item.record)
        const payload = objectValue(record.payload)
        const uid = stringValue(relation.record_uid ?? payload.record_uid).trim()
        if (uid === '') continue
        const senderUserId = integerLikeValue(relation.sender_user_id)
        const relationUid = stringValue(relation.rel_uid ?? relation.relUid).trim()
        const recordOwnerUserId = chatRecordOwnerUserId(relation, record, payload, senderUserId)
        const aiPolish = this.aiPolish.timelineAiPolish(record, payload)
        const sendAtMillis = numberValue(relation.attach_at ?? payload.send_at)
        const forwardRecords = await this.chatForwardRecordsPreview(item, session.userId, sendAtMillis)
        const sharedRecording = this.withSharedRecordingDetailRef(this.chatSharedRecordingPreview(item), {
          viewerUserId: session.userId,
          chatSessionUid,
          relationUid,
          recordOwnerUserId,
          recordUid: uid,
          senderUserId: integerLikeValue(relation.sender_user_id),
          sequence: integerLikeValue(relation.seq),
          signingKey,
        })
        const rawAgentSource = timelineAgentSource(relation, record, payload)
        const agentSource = senderUserId === session.userId
          ? this.arko.currentUserAgentSourceFallback(session.userId, rawAgentSource)
          : rawAgentSource
        const contentBlocks = this.media.richContentBlocks(item, session.userId)
        const senderName = stringValue(relation.display_name_snapshot).trim() || 'Arkme用户'
        const mentionsViewer = senderUserId !== session.userId
          && arkmeMentionMetadataMentionsViewer(record, payload, session.userId)
        items.push({
          itemUid: uid,
          ...(relationUid === '' ? {} : {
            messageActionRef: this.sealMessageActionRef(this.messageActionRefPayload({
              sourceKind: 'chat_relation',
              userId: session.userId,
              sourceOwnerRef: chatSessionUid,
              chatSessionUid,
              relationUid,
              recordOwnerUserId,
              recordUid: uid,
              senderUserId,
              senderName,
              title: stringValue(payload.title),
              textContent: stringValue(payload.text_content),
              sendAtMillis,
              sourceSequence: numberValue(relation.seq),
              templateKind: numberValue(payload.template_kind),
              displayKind: numberValue(payload.display_kind),
              contentBlocks,
            }), signingKey),
          }),
          ...(senderUserId > 0 ? { memberRef: await this.sealChatMemberRef(session.userId, chatSessionUid, senderUserId) } : {}),
          senderName,
          ...(agentSource === undefined ? {} : { agentSource }),
          ...(senderUserId > 0 ? { avatarRef: await this.profile.sealProfileImageRef(session.userId, senderUserId) } : {}),
          isMe: senderUserId === session.userId,
          ...(mentionsViewer ? { mentionsViewer: true } : {}),
          sendAtMillis,
          title: stringValue(payload.title),
          textContent: stringValue(payload.text_content),
          status: numberValue(record.status),
          sequence: numberValue(relation.seq),
          ...(numberValue(record.version ?? payload.version) > 0 ? { recordVersion: numberValue(record.version ?? payload.version) } : {}),
          ...(aiPolish === undefined ? {} : { aiPolish }),
          ...(forwardRecords === undefined ? {} : { forwardRecords }),
          ...(sharedRecording === undefined ? {} : { sharedRecording }),
          displayKind: numberValue(payload.display_kind),
          contentBlocks,
        })
      }
      return items
    }

  async relatedQuickNoteLocator(
      sourceRef: string,
      messageActionRef: string,
    ): Promise<ArkmeRelatedQuickNoteSourceLocator> {
      const session = await this.runtime.requireSession()
      const normalizedSourceRef = sourceRef.trim()
      const source = await this.source.openSourceRef(normalizedSourceRef, session.userId)
      const reference = await this.openMessageActionRef(messageActionRef, session.userId, source)
      const ownerUserId = reference.recordOwnerUserId > 0
        ? reference.recordOwnerUserId
        : reference.senderUserId
      if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) {
        throw new ArkmePluginError('related-quick-note-source-invalid', '当前快记缺少作者定位，请刷新后重试', false, 409)
      }
      return {
        viewerUserId: session.userId,
        sourceRef: normalizedSourceRef,
        sourceOwnerRef: source.ownerRef,
        contextType: reference.sourceKind === 'chat_relation' ? 'chat' : 'record',
        recordUid: reference.recordUid,
        recordOwnerUserId: ownerUserId,
        chatSessionUid: reference.sourceKind === 'chat_relation' ? reference.chatSessionUid : '',
      }
    }
  
  async chatForwardRecordsPreview(
      raw: unknown,
      viewerUserId: number,
      fallbackCreatedAtMillis: number,
    ): Promise<ArkmeTimelineItem['forwardRecords'] | undefined> {
      const contentPayload = this.media.recordContentPayload(raw)
      const nested = objectValue(contentPayload.forward_records ?? contentPayload.forwardRecords)
      const payload = Object.keys(nested).length > 0 ? nested : contentPayload
      if (stringValue(payload.render_kind ?? payload.renderKind).trim() !== 'forward_records') return undefined
  
      const projectedItems: ArkmeForwardRecordPreviewItem[] = []
      let truncated = false
      let remainingSegments = 2_000
      const epochMillis = (value: unknown): number => {
        const time = numberValue(value)
        return Number.isFinite(time) && time > 0 && time < 8.64e15
          ? Math.trunc(time < 1e12 ? time * 1000 : time) : 0
      }
      const appendItems = async (values: unknown[], depth: number): Promise<void> => {
        if (values.length > 100) truncated = true
        const sorted = values.slice(0, 100).map((value, index) => ({ value, index, order: numberValue(objectValue(value).item_order) }))
          .sort((left, right) => (left.order || left.index) - (right.order || right.index))
        for (const entry of sorted) {
          if (projectedItems.length >= 100) { truncated = true; return }
          const item = objectValue(entry.value)
          const nestedForward = objectValue(item.forward_records ?? item.forwardRecords)
          if (depth < 4
            && stringValue(nestedForward.render_kind ?? nestedForward.renderKind).trim() === 'forward_records') {
            await appendItems(listValue(nestedForward.items), depth + 1)
            continue
          }
          if (depth >= 4 && Object.keys(nestedForward).length > 0) truncated = true
          const senderUserId = numberValue(item.source_sender_user_id ?? item.sourceSenderUserId ?? item.owner_id ?? item.ownerId)
          const senderName = stringValue(
            item.owner_name ?? item.ownerName ?? item.source_display_name ?? item.sourceDisplayName,
          ).trim() || 'Arkme用户'
          const textContent = stringValue(item.text ?? item.text_preview ?? item.textPreview).trim()
          const title = stringValue(item.title).trim()
          const rawType = stringValue(item.source_type ?? item.sourceType ?? payload.source_type ?? payload.sourceType)
          const sourceType: ArkmeForwardRecordPreviewItem['sourceType'] =
            rawType === 'record' || rawType === 'chat_record' || rawType === 'long_recording_segments'
              || rawType === 'agent' || rawType === 'ai_letter' ? rawType : 'unknown'
          const files = listValue(item.files)
          const contentBlocks = this.media.forwardContentBlocks(files, viewerUserId)
          const call = objectValue(item.call_record_snapshot ?? item.callRecordSnapshot)
          const recordingSegments = listValue(item.long_recording_segments ?? item.longRecordingSegments)
          const rawSegments = recordingSegments.length > 0 ? recordingSegments : listValue(call.transcript_segments ?? call.transcriptSegments)
          const segmentValues = rawSegments.slice(0, Math.min(500, remainingSegments))
          remainingSegments -= segmentValues.length
          const segments: ArkmeForwardTranscriptSegment[] = segmentValues.map(value => {
            const segment = objectValue(value)
            const offset = (value: unknown) => Math.max(0, Math.trunc(numberValue(value)))
            const startMillis = offset(segment.start_millis ?? segment.startMillis ?? segment.start_ms ?? segment.startMs)
            const endMillis = Math.max(startMillis, offset(segment.end_millis ?? segment.endMillis ?? segment.end_ms ?? segment.endMs))
            const speakerNumber = offset(segment.speaker_number ?? segment.speakerNumber)
            const speakerName = stringValue(segment.speaker_label ?? segment.speakerLabel ?? segment.speaker_name ?? segment.speakerName).trim()
              || (speakerNumber > 0 ? `说话人 ${String(speakerNumber)}` : senderName)
            const audioUrl = stringValue(segment.audio_url ?? segment.audioUrl).trim()
            const segmentMedia = audioUrl === '' ? [] : this.media.forwardContentBlocks([{
              type: 2, name: '通话片段', mime_type: 'audio/wav', download_url: audioUrl,
              duration_sec: (endMillis - startMillis) / 1000,
            }], viewerUserId)
            return {
              speakerName, textContent: stringValue(segment.text ?? segment.text_content ?? segment.textContent), startMillis, endMillis,
              ...(segmentMedia.length === 0 ? {} : { contentBlocks: segmentMedia }),
              ...(audioUrl !== '' && segmentMedia.length === 0 ? { mediaUnavailable: true as const } : {}),
            }
          })
          const imageCount = Math.max(0, Math.trunc(numberValue(item.image_count ?? item.imageCount)))
          const voiceCount = Math.max(0, Math.trunc(numberValue(item.voice_count ?? item.voiceCount)))
          const fileCount = Math.max(0, Math.trunc(numberValue(item.file_count ?? item.fileCount)))
          const fileName = listValue(item.file_names ?? item.fileNames)
            .map(value => stringValue(value).trim()).find(value => value !== '')
          const contentLabel = imageCount > 0
            ? imageCount > 1 ? `[${String(imageCount)}张图片]` : '[图片]'
            : voiceCount > 0 ? '[语音]'
              : fileCount > 0 ? fileName === undefined ? '[文件]' : `[文件] ${fileName}`
                : stringValue(item.availability).trim() !== '' ? '原快记暂不可查看' : undefined
          projectedItems.push({
            senderName,
            ...(senderUserId > 0 ? { avatarRef: await this.profile.sealProfileImageRef(viewerUserId, senderUserId) } : {}),
            sendAtMillis: epochMillis(item.send_at ?? item.sendAt),
            title,
            textContent,
            sourceType,
            ...(contentBlocks.length === 0 ? {} : { contentBlocks }),
            ...(files.length > contentBlocks.length ? { mediaUnavailable: true } : {}),
            ...(segments.length === 0 ? {} : { segments }),
            ...(segmentValues.length < rawSegments.length || files.length > 32 ? { truncated: true } : {}),
            ...(contentLabel === undefined ? {} : { contentLabel }),
          })
        }
      }
      await appendItems(listValue(payload.items), 0)
  
      const summaryLines = listValue(payload.summary_lines ?? payload.summaryLines)
        .map(value => stringValue(value).trim()).filter(value => value !== '')
      const createdAtMillis = epochMillis(payload.created_at ?? payload.createdAt) || epochMillis(fallbackCreatedAtMillis)
      return {
        title: stringValue(payload.title).trim() || '转发快记',
        createdAtMillis,
        summaryLines,
        items: projectedItems,
        ...(truncated ? { truncated: true } : {}),
      }
    }

  chatSharedRecordingPreview(raw: unknown): ArkmeTimelineItem['sharedRecording'] | undefined {
    const contentPayload = this.media.recordContentPayload(raw)
    const direct = this.sharedRecordingPreviewFromPayload(contentPayload)
    if (direct !== undefined) return direct

    const root = objectValue(raw)
    const relation = objectValue(root.relation)
    const relationPayload = parsedObject(
      relation.render_content_payload ?? relation.renderContentPayload
        ?? root.render_content_payload ?? root.renderContentPayload,
    )
    const relationDirect = this.sharedRecordingPreviewFromPayload(relationPayload)
    if (relationDirect !== undefined) return relationDirect
    const relationRenderKind = stringValue(relationPayload.render_kind ?? relationPayload.renderKind).trim()
    if (relationRenderKind !== 'shared_recording_memory') return undefined

    const record = objectValue(root.record)
    const recordPayload = parsedObject(record.payload)
    const recordPayloadContent = parsedObject(recordPayload.content_payload ?? recordPayload.contentPayload)
    const recordContentPayload = parsedObject(record.content_payload ?? record.contentPayload)
    const rootPayload = parsedObject(root.payload)
    const rootContentPayload = parsedObject(root.content_payload ?? root.contentPayload)
    const candidates = [
      contentPayload,
      recordPayload,
      recordPayloadContent,
      recordContentPayload,
      rootPayload,
      rootContentPayload,
    ]
    for (const candidate of candidates) {
      const body = objectValue(candidate.shared_recording ?? candidate.sharedRecording)
      const payload = Object.keys(body).length === 0 ? candidate : body
      if (!this.sharedRecordingSourceDigestCompatible(payload, relationPayload)) continue
      const projection = this.sharedRecordingPreviewFromPayload({
        ...payload,
        ...relationPayload,
        render_kind: 'shared_recording_memory',
      })
      if (projection !== undefined) return projection
    }
    return undefined
  }

  private sharedRecordingParticipantsFromPayload(payload: Record<string, unknown>): ArkmeSharedRecordingParticipant[] {
    const participants = listValue(payload.participants)
    const mobileParticipants = listValue(payload.participant_ls ?? payload.participantLs)
    const speakers = listValue(payload.speaker_ls ?? payload.speakerLs ?? payload.speakers)
    const values = participants.length > 0 ? participants : mobileParticipants.length > 0 ? mobileParticipants : speakers
    return values.flatMap(value => {
      if (typeof value === 'string') {
        const displayName = value.trim()
        return displayName === '' ? [] : [{ displayName, role: 0 } satisfies ArkmeSharedRecordingParticipant]
      }
      const participant = objectValue(value)
      const displayName = stringValue(
        participant.display_name ?? participant.displayName
        ?? participant.nick_name ?? participant.nickName
        ?? participant.speaker_name ?? participant.speakerName
        ?? participant.name,
      ).trim()
      if (displayName === '') return []
      const refUserId = integerLikeValue(
        participant.ref_user_id ?? participant.refUserId ?? participant.ref_usr_id ?? participant.refUsrId,
      )
      return [{
        ...(refUserId > 0 ? { refUserId } : {}),
        displayName,
        role: Math.max(0, integerLikeValue(participant.role)),
      } satisfies ArkmeSharedRecordingParticipant]
    })
  }

  private sharedRecordingTranscriptFromPayload(payload: Record<string, unknown>): string {
    const direct = stringValue(
      payload.transcript ?? payload.transcript_text ?? payload.transcriptText
      ?? payload.original_text ?? payload.originalText,
    ).trim()
    if (direct !== '') return direct
    for (const key of ['transcript_ls', 'transcriptLs', 'transcript_segments', 'transcriptSegments', 'asr_ls', 'asrLs']) {
      const lines = listValue(payload[key]).flatMap(value => {
        if (typeof value === 'string') {
          const line = value.trim()
          return line === '' ? [] : [line]
        }
        const segment = objectValue(value)
        const text = stringValue(
          segment.text ?? segment.text_content ?? segment.textContent
          ?? segment.transcript ?? segment.content,
        ).trim()
        if (text === '') return []
        const speakerName = stringValue(
          segment.speaker_name ?? segment.speakerName
          ?? segment.speaker_label ?? segment.speakerLabel
          ?? segment.nick_name ?? segment.nickName
          ?? segment.display_name ?? segment.displayName,
        ).trim()
        return [speakerName === '' ? text : `${speakerName}：${text}`]
      })
      if (lines.length > 0) return lines.join('\n')
    }
    return ''
  }

  private sharedRecordingPreviewFromPayload(payload: Record<string, unknown>, depth = 0): ArkmeTimelineItem['sharedRecording'] | undefined {
    const renderKind = stringValue(payload.render_kind ?? payload.renderKind).trim()
    if (renderKind === 'shared_recording_memory') {
      const sourceDigest = stringValue(payload.source_digest ?? payload.sourceDigest).trim()
      const title = stringValue(payload.title ?? payload.orig_name ?? payload.origName).trim()
      const summary = stringValue(
        payload.summary ?? payload.summary_text ?? payload.summaryText ?? payload.content_summary ?? payload.contentSummary,
      ).trim()
      const displayAtMillis = integerLikeValue(payload.display_at ?? payload.displayAt)
      if (sourceDigest === '' || title === '' || summary === '' || displayAtMillis <= 0) return undefined
      const transcript = this.sharedRecordingTranscriptFromPayload(payload)
      return {
        sourceDigest,
        sharedByUserId: Math.max(0, integerLikeValue(payload.shared_by_user_id ?? payload.sharedByUserId)),
        sharedAtMillis: Math.max(0, integerLikeValue(payload.shared_at ?? payload.sharedAt)),
        displayAtMillis,
        endAtMillis: Math.max(0, integerLikeValue(payload.end_at ?? payload.endAt)),
        timeRangeText: stringValue(payload.time_range_text ?? payload.timeRangeText).trim(),
        title,
        summary,
        ...(transcript === '' ? {} : { transcript }),
        transcriptAvailable: transcript !== '',
        participants: this.sharedRecordingParticipantsFromPayload(payload),
      }
    }
    if (renderKind !== '' || depth >= 4) return undefined
    for (const key of [
      'shared_recording', 'sharedRecording',
      'content_payload', 'contentPayload',
      'record_payload', 'recordPayload',
      'fallback_content_payload', 'fallbackContentPayload',
      'payload', 'extra',
    ]) {
      const nested = parsedObject(payload[key])
      if (Object.keys(nested).length === 0) continue
      const projection = this.sharedRecordingPreviewFromPayload(nested, depth + 1)
      if (projection !== undefined) return projection
    }
    return undefined
  }

  private sharedRecordingSourceDigestCompatible(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
  ): boolean {
    const leftDigest = stringValue(left.source_digest ?? left.sourceDigest).trim()
    const rightDigest = stringValue(right.source_digest ?? right.sourceDigest).trim()
    return leftDigest === '' || rightDigest === '' || leftDigest === rightDigest
  }

  private withSharedRecordingDetailRef(
    recording: ArkmeSharedRecordingPreview | undefined,
    input: {
      viewerUserId: number
      chatSessionUid: string
      relationUid: string
      recordOwnerUserId: number
      recordUid: string
      senderUserId: number
      sequence: number
      signingKey: string
    },
  ): ArkmeSharedRecordingPreview | undefined {
    if (recording === undefined) return undefined
    const recordUid = input.recordUid.trim()
    const recordOwnerUserId = input.recordOwnerUserId > 0
      ? input.recordOwnerUserId
      : recording.sharedByUserId > 0
        ? recording.sharedByUserId
        : input.senderUserId
    const chatSessionUid = input.chatSessionUid.trim()
    if (chatSessionUid === '' || recordUid === '' || recordOwnerUserId <= 0) return recording
    return {
      ...recording,
      detailRef: this.sealSharedRecordingDetailRef({
        version: 1,
        viewerUserId: input.viewerUserId,
        chatSessionUid,
        relationUid: input.relationUid.trim(),
        recordOwnerUserId: Math.trunc(recordOwnerUserId),
        recordUid,
        sequence: Math.max(0, Math.trunc(input.sequence)),
      }, input.signingKey),
    }
  }

  private sealSharedRecordingDetailRef(payload: ArkmeSharedRecordingDetailRefPayload, signingKey: string): string {
    const encoded = encodeOpaqueJson(payload)
    const signature = createHmac('sha256', signingKey).update(encoded).digest('base64url')
    return `arkme-shared-recording-detail-v1.${encoded}.${signature}`
  }

  private async openSharedRecordingDetailRef(
    detailRef: string,
    expectedViewerUserId: number,
  ): Promise<ArkmeSharedRecordingDetailRefPayload> {
    const parts = detailRef.trim().split('.')
    if (parts.length !== 3 || parts[0] !== 'arkme-shared-recording-detail-v1') {
      throw new ArkmePluginError('shared-recording-detail-ref-invalid', '共享录音详情引用无效，请刷新后重试', false)
    }
    const encoded = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(encoded).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ArkmePluginError('shared-recording-detail-ref-invalid', '共享录音详情引用无效，请刷新后重试', false)
    }
    let parsed: Record<string, unknown>
    try { parsed = objectValue(decodeOpaqueJson(encoded)) }
    catch (error) {
      throw new ArkmePluginError('shared-recording-detail-ref-invalid', '共享录音详情引用无效，请刷新后重试', false, 400, { cause: error })
    }
    const result: ArkmeSharedRecordingDetailRefPayload = {
      version: 1,
      viewerUserId: integerLikeValue(parsed.viewerUserId),
      chatSessionUid: stringValue(parsed.chatSessionUid).trim(),
      relationUid: stringValue(parsed.relationUid).trim(),
      recordOwnerUserId: integerLikeValue(parsed.recordOwnerUserId),
      recordUid: stringValue(parsed.recordUid).trim(),
      sequence: Math.max(0, integerLikeValue(parsed.sequence)),
    }
    if (parsed.version !== 1 || result.viewerUserId !== expectedViewerUserId || result.chatSessionUid === ''
      || result.recordUid === '' || result.recordOwnerUserId <= 0) {
      throw new ArkmePluginError('shared-recording-detail-ref-invalid', '共享录音详情引用与当前账号不匹配，请刷新后重试', false, 403)
    }
    return result
  }

  async sharedRecordingDetail(
    detailRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeSharedRecordingPreview> {
    const session = await this.runtime.requireSession()
    const reference = await this.openSharedRecordingDetailRef(detailRef, session.userId)
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/records/detail',
      {
        chat_session_uid: reference.chatSessionUid,
        record_uid: reference.recordUid,
        record_owner_user_id: reference.recordOwnerUserId,
        ...(reference.relationUid === '' ? {} : { rel_uid: reference.relationUid }),
        ...(reference.sequence <= 0 ? {} : { seq: reference.sequence }),
      },
      session,
      options.signal,
      {
        lane: 'interactive-read',
        key: `shared-recording-detail:${reference.chatSessionUid}:${reference.recordUid}:${String(reference.sequence)}`,
        failureCooldownMs: 2_000,
      },
    )
    const projection = this.chatSharedRecordingPreview(objectValue(data.item)) ?? this.chatSharedRecordingPreview(data)
    if (projection === undefined) {
      throw new ArkmePluginError('shared-recording-detail-unavailable', '共享录音详情暂时无法读取，请稍后重试', true, 502)
    }
    return { ...projection, detailRef }
  }

  async messageSnapshotDetail(
    sourceRef: string,
    actionRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeMessageSnapshotDetail> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    const isChatSource = source.kind === 'private_chat' || source.kind === 'group_chat'
    const isRecordSource = source.kind === 'send_to_self' || source.kind === 'default_category' || source.kind === 'topic'
    if (!isChatSource && !isRecordSource) {
      throw new ArkmePluginError('message-snapshot-source-unsupported', '当前对话暂不支持读取完整快记详情', false, 400)
    }
    // The detail endpoint is scoped to a concrete chat relation, not only to a
    // record uid.  Use the account-bound action reference that was issued with
    // the timeline item, so the UI cannot accidentally lose (or forge) the
    // relation and owner identities that Flutter sends to this endpoint.
    const reference = await this.openMessageActionRef(actionRef, session.userId, source)
    if (reference.recordUid === '') {
      throw new ArkmePluginError('message-snapshot-record-invalid', '快记记录身份无效，请刷新后重试', false, 400)
    }
    if (reference.senderUserId !== session.userId) {
      throw new ArkmePluginError('message-snapshot-not-owned', '只能查看自己发送的快记详情', false, 403)
    }
    const recordOwnerUserId = reference.recordOwnerUserId > 0
      ? reference.recordOwnerUserId
      : reference.senderUserId
    if (recordOwnerUserId <= 0) {
      throw new ArkmePluginError('message-snapshot-owner-missing', '快记记录归属暂时无法确认，请刷新后重试', true, 502)
    }
    if (reference.sourceKind === 'record') {
      if (!isRecordSource) {
        throw new ArkmePluginError('message-snapshot-record-invalid', '快记记录身份与当前来源不匹配，请刷新后重试', false, 400)
      }
      return this.hydratedMessageSnapshotDetail(reference, session, options)
    }
    if (!isChatSource || reference.relationUid === '') {
      throw new ArkmePluginError('message-snapshot-record-invalid', '快记记录身份无效，请刷新后重试', false, 400)
    }
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/records/detail',
      {
        chat_session_uid: reference.chatSessionUid,
        record_uid: reference.recordUid,
        record_owner_user_id: recordOwnerUserId,
        rel_uid: reference.relationUid,
        ...(reference.sourceSequence <= 0 ? {} : { seq: reference.sourceSequence }),
      },
      session,
      options.signal,
      {
        lane: 'interactive-read',
        key: `message-snapshot-detail:${reference.chatSessionUid}:${reference.relationUid}:${reference.recordUid}:${String(reference.sourceSequence)}`,
        failureCooldownMs: 1_000,
      },
    )
    // This is the same mounted-record response used by the Flutter client.
    // It establishes the chat relation identity before the owner-record
    // hydration below supplies the full memory snapshot fields.
    const chatRaw = objectValue(data.item)
    if (Object.keys(chatRaw).length === 0) {
      throw new ArkmePluginError('message-snapshot-detail-unavailable', '完整快记详情暂时无法读取，请稍后重试', true, 502)
    }
    return this.hydratedMessageSnapshotDetail(reference, session, options, chatRaw)
  }

  private async hydratedMessageSnapshotDetail(
    reference: ArkmeMessageActionRefPayload,
    session: ArkmeSessionCredentials,
    options: { signal?: AbortSignal },
    chatRaw: Record<string, unknown> = {},
  ): Promise<ArkmeMessageSnapshotDetail> {
    // Flutter follows a verified chat-detail lookup with the owner's record
    // hydration. The second response is necessary for detail-only metadata
    // such as location, weather, device context and lifecycle timestamps.
    // Deliberately do not swallow this failure: showing a plausible but empty
    // snapshot is worse than telling the user that the full detail failed.
    const recordData = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/records/detail',
      { record_uid: reference.recordUid },
      session,
      options.signal,
      {
        lane: 'interactive-read',
        key: `message-snapshot-record-core:${reference.recordUid}`,
        failureCooldownMs: 1_000,
      },
    )
    const recordRaw = objectValue(recordData)
    const chatRecord = objectValue(chatRaw.record)
    // Flutter treats a flat response as the record core when older services do
    // not wrap it in record_core. Keep that compatibility before hydrating the
    // snapshot projection.
    const recordCore = objectValue(recordRaw.record_core ?? recordRaw.recordCore ?? recordRaw.record ?? recordRaw)
    const detailRecordUid = firstSnapshotText(
      recordCore.record_uid, recordCore.recordUid, recordCore.uid,
      recordRaw.record_uid, recordRaw.recordUid, recordRaw.uid,
    )
    const hasDetailPayload = [
      recordRaw.payload, recordRaw.content_payload, recordRaw.contentPayload, recordRaw.record_payload, recordRaw.recordPayload,
      recordRaw.location, recordRaw.position_detail, recordRaw.positionDetail, recordRaw.extra, recordRaw.record_extra, recordRaw.recordExtra,
      recordRaw.weather, recordRaw.capture_context, recordRaw.captureContext, recordRaw.background_sound, recordRaw.backgroundSound,
    ].some(value => Object.keys(parsedObject(value)).length > 0 || listValue(value).length > 0)
    const hasRecordCoreDetail = Object.keys(recordCore).some(key => !['record_uid', 'recordUid', 'uid'].includes(key))
    if (!hasRecordCoreDetail && !hasDetailPayload) {
      throw new ArkmePluginError('message-snapshot-detail-unavailable', '完整快记详情暂时无法读取，请稍后重试', true, 502)
    }
    if (detailRecordUid !== reference.recordUid) {
      throw new ArkmePluginError('message-snapshot-detail-mismatch', '完整快记详情与当前消息不匹配，请刷新后重试', true, 502)
    }
    // Flutter keeps record-detail wrapper metadata (location, position_detail,
    // record_extra and content payload) alongside record_core. Preserve that
    // wrapper while overlaying the detailed core over the sparse chat record.
    // Older entries may have a wrapper without record_core, which must still
    // contribute its metadata instead of falling back to an empty chat card.
    const chatRecordPayload = {
      ...parsedObject(chatRecord.payload), ...parsedObject(chatRecord.content_payload), ...parsedObject(chatRecord.contentPayload),
      ...parsedObject(chatRecord.record_payload), ...parsedObject(chatRecord.recordPayload),
    }
    const detailPayload = {
      ...parsedObject(recordRaw.payload), ...parsedObject(recordRaw.content_payload), ...parsedObject(recordRaw.contentPayload),
      ...parsedObject(recordRaw.record_payload), ...parsedObject(recordRaw.recordPayload),
      ...parsedObject(recordCore.payload), ...parsedObject(recordCore.content_payload), ...parsedObject(recordCore.contentPayload),
      ...parsedObject(recordCore.record_payload), ...parsedObject(recordCore.recordPayload),
    }
    let raw: Record<string, unknown> = {
      ...chatRaw,
      ...recordRaw,
      // Chat identity is authoritative when available; record sources use a
      // synthetic relation only to retain the same detail projection shape.
      relation: Object.keys(chatRaw).length === 0
        ? { record_uid: reference.recordUid, record_owner_user_id: reference.recordOwnerUserId }
        : objectValue(chatRaw.relation),
      record: {
        ...chatRecord,
        ...recordCore,
        payload: {
          ...chatRecordPayload,
          ...detailPayload,
        },
      },
    }
    // Flutter obtains weather and resolved place context from this record
    // service endpoint after the core record has been read. `records/detail`
    // alone frequently contains the coordinates but not the weather that the
    // desktop detail dialog shows. This enrichment is optional for legacy
    // records: an unavailable context must not hide the otherwise complete
    // snapshot.
    const locationContext = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/records/location/context/get',
      { record_uid: reference.recordUid },
      session,
      options.signal,
      {
        lane: 'interactive-read',
        key: `message-snapshot-location-context:${reference.recordUid}`,
        failureCooldownMs: 10_000,
      },
    ).catch(() => undefined)
    if (locationContext !== undefined) {
      const context = snapshotLocationContext(locationContext)
      const contextEnvelope = objectValue(locationContext)
      const contextData = objectValue(contextEnvelope.data)
      // Depending on the record-service gateway, the identity can remain on
      // the outer envelope while location/weather live under `data`.
      const contextRecordUid = firstSnapshotText(
        contextEnvelope.record_uid, contextEnvelope.recordUid, contextEnvelope.uid,
        contextData.record_uid, contextData.recordUid, contextData.uid,
        context.record_uid, context.recordUid, context.uid,
      )
      if (contextRecordUid !== undefined && contextRecordUid !== reference.recordUid) {
        throw new ArkmePluginError('message-snapshot-detail-mismatch', '快记地点上下文与当前消息不匹配，请刷新后重试', true, 502)
      }
      raw = mergeSnapshotLocationContext(raw, context)
    }
    const detail = snapshotDetailFromChatRaw(
      raw,
      {
      itemUid: reference.recordUid,
      textContent: reference.textContent,
      sendAtMillis: reference.sendAtMillis,
      },
    )
    if (detail.itemUid !== reference.recordUid) {
      throw new ArkmePluginError('message-snapshot-detail-mismatch', '快记详情与当前消息不匹配，请刷新后重试', true, 502)
    }
    return detail
  }

  async saveMessageLocation(
    sourceRef: string,
    itemUid: string,
    location: ArkmeRecordLocationCapture,
    recordVersion: number | undefined,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    const recordUid = itemUid.trim()
    if (recordUid === '' || !['private_chat', 'group_chat', 'send_to_self', 'default_category', 'topic'].includes(source.kind)) {
      throw new ArkmePluginError('message-location-target-invalid', '当前消息不能写入位置快照', false, 400)
    }
    const latitude = location.latitude
    const longitude = location.longitude
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new ArkmePluginError('message-location-invalid', '位置坐标无效', false, 400)
    }
    const altitude = location.altitudeMeters
    const speed = location.speedMetersPerSecond
    const accuracy = location.accuracyMeters
    await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/records/location/set',
      {
        record_uid: recordUid,
        ...(recordVersion === undefined || recordVersion <= 0 ? {} : { expected_record_version: Math.trunc(recordVersion) }),
        location: {
          source_kind: 1,
          lat: latitude,
          lon: longitude,
          ...(altitude === undefined || !Number.isFinite(altitude) ? {} : { alt: altitude }),
          ...(speed === undefined || !Number.isFinite(speed) || speed < 0 ? {} : { speed }),
          ...(accuracy === undefined || !Number.isFinite(accuracy) || accuracy < 0 ? {} : { accuracy }),
          captured_at: Math.max(1, Math.trunc(location.capturedAtMillis)),
        },
      },
      session,
      options.signal,
    )
  }
  
  private async rawChatMembers(
    chatSessionUid: string,
    activeOnly: boolean,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/members/list',
      { chat_session_uid: chatSessionUid, active_only: activeOnly },
      session,
      signal,
    )
    return listValue(data.items).map(objectValue)
  }

  private async projectChatMembers(
    chatSessionUid: string,
    rawItems: Record<string, unknown>[],
    session: ArkmeSessionCredentials,
    options: ChatMemberProjectionOptions,
  ): Promise<ArkmeConversationMemberItem[]> {
    const userIds = rawItems.map(item => Math.trunc(numberValue(item.user_id)))
      .filter(userId => Number.isSafeInteger(userId) && userId > 0)
    const [profiles, viewerLabels] = await Promise.all([
      this.profile.publicProfileSummariesByUserIds(userIds, session, options.signal).catch(() => new Map()),
      options.includeViewerLabels
        ? this.source.privateDisplayNamesByUserIds(userIds, {
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          }).catch(() => new Map())
        : Promise.resolve(new Map<number, string>()),
    ])
    const members: ArkmeConversationMemberItem[] = []
    for (const item of rawItems) {
      const userId = Math.trunc(numberValue(item.user_id))
      if (!Number.isSafeInteger(userId) || userId <= 0) continue
      const profile = profiles.get(userId)
      const { displayName, memberName, secondaryName } = projectChatMemberDisplayNames(
        item, userId, viewerLabels.get(userId), profile?.displayName,
      )
      const role = chatMemberRole(item.role)
      const status = chatMemberStatus(item.status)
      const extra = parsedObject(item.extra)
      members.push({
        memberRef: await this.sealChatMemberRef(session.userId, chatSessionUid, userId),
        ...(options.includeHumanMentionRefs && status === 'active' && userId !== session.userId ? {
          mentionRef: await this.sealChatHumanMentionRef(session.userId, chatSessionUid, userId, displayName),
        } : {}),
        displayName,
        ...(memberName === '' ? {} : { memberName }),
        ...(secondaryName === '' ? {} : { secondaryName }),
        ...(profile?.avatarUrl === undefined ? {} : { avatarRef: await this.profile.sealProfileImageRef(session.userId, userId) }),
        role,
        status,
        isSelf: userId === session.userId,
        isOwner: role === 'owner',
        joinedAtMillis: Math.max(0, Math.trunc(numberValue(item.join_at))),
        recordCount: Math.max(0, Math.trunc(numberValue(extra.record_count))),
        mentionCount: Math.max(0, Math.trunc(numberValue(extra.mention_count))),
      })
    }
    const roleRank = (role: ArkmeGroupMemberRole) => role === 'owner' ? 0 : role === 'admin' ? 1 : role === 'member' ? 2 : 3
    members.sort((left, right) => roleRank(left.role) - roleRank(right.role)
      || (right.status === 'active' ? 1 : 0) - (left.status === 'active' ? 1 : 0)
      || left.joinedAtMillis - right.joinedAtMillis
      || left.displayName.localeCompare(right.displayName))
    return members
  }

  private async projectChatTimelineItems(
    rawItems: unknown[],
    source: ArkmeSourceRefPayload,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeTimelineItem[]> {
    const items: ArkmeTimelineItem[] = []
    const senderUserIdByIndex = new Map<number, number>()
    const signingKey = await this.runtime.stateStore.uniqueCode()
    for (const raw of rawItems) {
      const item = objectValue(raw)
      const relation = objectValue(item.relation)
      const record = objectValue(item.record)
      const payload = objectValue(record.payload)
      const recordStatus = numberValue(record.status)
      if (recordStatus !== 1) continue
      const uid = stringValue(relation.record_uid ?? payload.record_uid).trim()
      if (uid === '') continue
      const relationUid = stringValue(relation.rel_uid).trim()
      const senderUserId = Math.trunc(numberValue(relation.sender_user_id))
      const recordOwnerUserId = chatRecordOwnerUserId(relation, record, payload, senderUserId)
      const aiPolish = this.aiPolish.timelineAiPolish(record, payload)
      const sendAtMillis = numberValue(relation.attach_at ?? payload.send_at)
      const forwardRecords = await this.chatForwardRecordsPreview(item, session.userId, sendAtMillis)
      const sharedRecording = this.withSharedRecordingDetailRef(this.chatSharedRecordingPreview(item), {
        viewerUserId: session.userId,
        chatSessionUid: source.ownerRef,
        relationUid,
        recordOwnerUserId,
        recordUid: uid,
        senderUserId,
        sequence: integerLikeValue(relation.seq),
        signingKey,
      })
      const rawAgentSource = timelineAgentSource(relation, record, payload)
      const agentSource = senderUserId === session.userId
        ? this.arko.currentUserAgentSourceFallback(session.userId, rawAgentSource)
        : rawAgentSource
      const contentBlocks = this.media.richContentBlocks(item, session.userId)
      const senderName = stringValue(relation.display_name_snapshot).trim() || 'Arkme用户'
      const captureContext = timelineCaptureContext({ ...record, ...payload })
      const recordDurationMillis = positiveNumberValue(
        payload.record_duration_millis, record.record_duration_millis,
        payload.recordDurationMillis, record.recordDurationMillis,
        payload.cost_mill_sec, record.cost_mill_sec, payload.costMillSec, record.costMillSec,
      )
      const editDurationMillis = positiveNumberValue(
        payload.edit_duration_millis, record.edit_duration_millis,
        payload.editDurationMillis, record.editDurationMillis,
        payload.incr_cost_mill_sec, record.incr_cost_mill_sec, payload.incrCostMillSec, record.incrCostMillSec,
      )
      const itemIndex = items.push({
        itemUid: uid,
        ...(source.kind !== 'group_chat' || relationUid === '' || senderUserId === session.userId ? {} : {
          messageRef: this.sealMessageRef(session.userId, source.ownerRef, relationUid, signingKey),
        }),
        ...(relationUid === '' ? {} : {
          messageActionRef: this.sealMessageActionRef(this.messageActionRefPayload({
            sourceKind: 'chat_relation',
            userId: session.userId,
            sourceOwnerRef: source.ownerRef,
            chatSessionUid: source.ownerRef,
            relationUid,
            recordOwnerUserId,
            recordUid: uid,
            senderUserId,
            senderName,
            title: stringValue(payload.title),
            textContent: stringValue(payload.text_content),
            sendAtMillis,
            sourceSequence: numberValue(relation.seq),
            templateKind: numberValue(payload.template_kind),
            displayKind: numberValue(payload.display_kind),
            contentBlocks,
          }), signingKey),
        }),
        ...(senderUserId > 0 ? { memberRef: await this.sealChatMemberRef(session.userId, source.ownerRef, senderUserId) } : {}),
        senderName,
        ...(agentSource === undefined ? {} : { agentSource }),
        isMe: senderUserId === session.userId,
        sendAtMillis,
        title: stringValue(payload.title),
        textContent: stringValue(payload.text_content),
        status: recordStatus,
        sequence: numberValue(relation.seq),
        ...(numberValue(record.version ?? payload.version) > 0 ? { recordVersion: numberValue(record.version ?? payload.version) } : {}),
        ...(aiPolish === undefined ? {} : { aiPolish }),
        templateKind: numberValue(payload.template_kind),
        displayKind: numberValue(payload.display_kind),
        version: numberValue(payload.version ?? record.version),
        updateAtMillis: numberValue(payload.update_at ?? record.update_at),
        ...(recordDurationMillis === undefined ? {} : { recordDurationMillis }),
        ...(editDurationMillis === undefined ? {} : { editDurationMillis }),
        ...(captureContext === undefined ? {} : { captureContext }),
        contentBlocks,
        ...(forwardRecords === undefined ? {} : { forwardRecords }),
        ...(sharedRecording === undefined ? {} : { sharedRecording }),
      }) - 1
      if (senderUserId > 0) senderUserIdByIndex.set(itemIndex, senderUserId)
    }
    try {
      const profiles = await this.profile.publicProfilesByUserIds([...new Set(senderUserIdByIndex.values())], session, signal)
      for (const [index, senderUserId] of senderUserIdByIndex) {
        if (!profiles.has(senderUserId) || items[index] === undefined) continue
        items[index].avatarRef = await this.profile.sealProfileImageRef(session.userId, senderUserId)
      }
    } catch {
      // Avatar decoration is optional; member references and record content remain usable.
    }
    return items
  }

  private async sealChatMemberRef(
    viewerUserId: number,
    chatSessionUid: string,
    targetUserId: number,
  ): Promise<string> {
    const encoded = encodeOpaqueJson({
      version: 1,
      viewerUserId,
      chatSessionUid,
      targetUserId,
    } satisfies ArkmeChatMemberRefPayload)
    const signature = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(encoded).digest('base64url')
    return `${CHAT_MEMBER_REF_PREFIX}.${encoded}.${signature}`
  }

  private async openChatMemberRef(
    memberRef: string,
    expectedViewerUserId: number,
    expectedChatSessionUid: string,
  ): Promise<ArkmeChatMemberRefPayload> {
    const parts = memberRef.trim().split('.')
    if (parts.length !== 3 || parts[0] !== CHAT_MEMBER_REF_PREFIX) {
      throw new ArkmePluginError('chat-member-ref-invalid', '聊天成员引用无效', false)
    }
    const encoded = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(encoded).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ArkmePluginError('chat-member-ref-invalid', '聊天成员引用无效', false)
    }
    let raw: Record<string, unknown>
    try { raw = objectValue(decodeOpaqueJson(encoded)) }
    catch (error) { throw new ArkmePluginError('chat-member-ref-invalid', '聊天成员引用无效', false, 400, { cause: error }) }
    const result: ArkmeChatMemberRefPayload = {
      version: 1,
      viewerUserId: Math.trunc(numberValue(raw.viewerUserId)),
      chatSessionUid: stringValue(raw.chatSessionUid).trim(),
      targetUserId: Math.trunc(numberValue(raw.targetUserId)),
    }
    if (raw.version !== 1 || result.viewerUserId !== expectedViewerUserId
      || result.chatSessionUid !== expectedChatSessionUid
      || !Number.isSafeInteger(result.targetUserId) || result.targetUserId <= 0) {
      throw new ArkmePluginError('chat-member-ref-invalid', '聊天成员引用与当前账号或会话不匹配', false, 403)
    }
    return result
  }

  private async sealChatHumanMentionRef(
    viewerUserId: number,
    chatSessionUid: string,
    targetUserId: number,
    displayNameSnapshot: string,
  ): Promise<string> {
    const normalizedDisplayNameSnapshot = normalizedJoinDisplayName(displayNameSnapshot)
    if (normalizedDisplayNameSnapshot === '') {
      throw new ArkmePluginError('chat-mention-ref-invalid', '真人 mention 展示名无效', false)
    }
    const encoded = encodeOpaqueJson({
      version: 1,
      viewerUserId,
      chatSessionUid,
      targetUserId,
      displayNameSnapshot: normalizedDisplayNameSnapshot,
    } satisfies ArkmeChatHumanMentionRefPayload)
    const signature = createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(`${CHAT_HUMAN_MENTION_REF_PREFIX}.${encoded}`).digest('base64url')
    return `${CHAT_HUMAN_MENTION_REF_PREFIX}.${encoded}.${signature}`
  }

  private async openChatHumanMentionRef(
    mentionRef: string,
    expectedViewerUserId: number,
    expectedChatSessionUid: string,
  ): Promise<ArkmeChatHumanMentionRefPayload> {
    const parts = mentionRef.trim().split('.')
    if (parts.length !== 3 || parts[0] !== CHAT_HUMAN_MENTION_REF_PREFIX) {
      throw new ArkmePluginError('chat-mention-ref-invalid', '真人 mention 引用无效', false)
    }
    const encoded = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(`${CHAT_HUMAN_MENTION_REF_PREFIX}.${encoded}`).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ArkmePluginError('chat-mention-ref-invalid', '真人 mention 引用无效', false)
    }
    let raw: Record<string, unknown>
    try { raw = objectValue(decodeOpaqueJson(encoded)) }
    catch (error) { throw new ArkmePluginError('chat-mention-ref-invalid', '真人 mention 引用无效', false, 400, { cause: error }) }
    const result: ArkmeChatHumanMentionRefPayload = {
      version: 1,
      viewerUserId: Math.trunc(numberValue(raw.viewerUserId)),
      chatSessionUid: stringValue(raw.chatSessionUid).trim(),
      targetUserId: Math.trunc(numberValue(raw.targetUserId)),
      displayNameSnapshot: normalizedJoinDisplayName(raw.displayNameSnapshot),
    }
    if (raw.version !== 1 || result.viewerUserId !== expectedViewerUserId
      || result.chatSessionUid !== expectedChatSessionUid
      || !Number.isSafeInteger(result.targetUserId) || result.targetUserId <= 0
      || result.displayNameSnapshot === '') {
      throw new ArkmePluginError('chat-mention-ref-invalid', '真人 mention 引用与当前账号或会话不匹配', false, 403)
    }
    return result
  }

  private messageActionRefPayload(input: {
    sourceKind: 'chat_relation' | 'record'
    userId: number
    sourceOwnerRef: string
    chatSessionUid: string
    relationUid: string
    recordOwnerUserId: number
    recordUid: string
    senderUserId: number
    senderName: string
    title: string
    textContent: string
    sendAtMillis: number
    templateKind: number
    displayKind: number
    sourceSequence?: number
    contentBlocks?: ArkmeTimelineItem['contentBlocks']
  }): ArkmeMessageActionRefPayload {
    const contentBlocks = input.contentBlocks ?? []
    const fileNames = contentBlocks
      .filter(block => block.kind === 'file' && block.fileName.trim() !== '')
      .slice(0, 5)
      .map(block => block.fileName.trim().slice(0, 256))
    return {
      version: 1,
      sourceKind: input.sourceKind,
      userId: input.userId,
      sourceOwnerRef: input.sourceOwnerRef,
      chatSessionUid: input.chatSessionUid,
      relationUid: input.relationUid,
      recordOwnerUserId: Math.trunc(input.recordOwnerUserId),
      recordUid: input.recordUid,
      senderUserId: Math.trunc(input.senderUserId),
      senderName: input.senderName.trim() || 'Arkme用户',
      title: input.title.slice(0, 500),
      textContent: input.textContent.slice(0, this.runtime.config.maxTextLength),
      sendAtMillis: Math.trunc(input.sendAtMillis),
      sourceSequence: Math.max(0, Math.trunc(numberValue(input.sourceSequence))),
      templateKind: Math.trunc(input.templateKind),
      displayKind: Math.trunc(input.displayKind),
      imageCount: contentBlocks.filter(block => block.kind === 'image').length,
      voiceCount: contentBlocks.filter(block => block.kind === 'audio').length,
      fileCount: contentBlocks.filter(block => block.kind === 'file').length,
      fileNames,
    }
  }

  private withRecordMessageActionRef(
    source: ArkmeSourceRefPayload,
    item: ArkmeTimelineItem,
    userId: number,
    signingKey: string,
  ): ArkmeTimelineItem {
    if ((source.kind !== 'send_to_self' && source.kind !== 'default_category' && source.kind !== 'topic')
      || item.itemUid.trim() === '' || !item.isMe) {
      return item
    }
    return {
      ...item,
      messageActionRef: this.sealMessageActionRef(this.messageActionRefPayload({
        sourceKind: 'record',
        userId,
        sourceOwnerRef: source.ownerRef,
        chatSessionUid: '',
        relationUid: '',
        recordOwnerUserId: userId,
        recordUid: item.itemUid,
        senderUserId: userId,
        senderName: item.senderName,
        title: item.title,
        textContent: item.textContent,
        sendAtMillis: item.sendAtMillis,
        templateKind: item.templateKind ?? 1,
        displayKind: item.displayKind ?? 0,
        contentBlocks: item.contentBlocks,
      }), signingKey),
    }
  }

  private sealMessageActionRef(payload: ArkmeMessageActionRefPayload, signingKey: string): string {
    const encoded = encodeOpaqueJson(payload)
    const signature = createHmac('sha256', signingKey).update(encoded).digest('base64url')
    return `arkme-message-action-v1.${encoded}.${signature}`
  }

  private async openMessageActionRefs(
    actionRefs: readonly string[],
    expectedUserId: number,
    source: ArkmeSourceRefPayload,
  ): Promise<ArkmeMessageActionRefPayload[]> {
    const normalizedRefs = actionRefs.map(value => value.trim()).filter(value => value !== '')
    const uniqueRefs = new Set(normalizedRefs)
    if (normalizedRefs.length !== uniqueRefs.size) {
      throw new ArkmePluginError('message-actions-selection-invalid', '不能选择重复消息', false)
    }
    const references: ArkmeMessageActionRefPayload[] = []
    const relationIdentities = new Set<string>()
    for (const actionRef of normalizedRefs) {
      const reference = await this.openMessageActionRef(actionRef, expectedUserId, source)
      const relationIdentity = reference.sourceKind === 'chat_relation'
        ? `chat_relation\u0000${reference.chatSessionUid}\u0000${reference.relationUid}`
        : `record\u0000${String(reference.recordOwnerUserId)}\u0000${reference.recordUid}`
      if (!relationIdentities.add(relationIdentity)) {
        throw new ArkmePluginError('message-actions-selection-invalid', '不能选择重复消息', false)
      }
      references.push(reference)
    }
    return references
  }

  private async openMessageActionRef(
    actionRef: string,
    expectedUserId: number,
    source: ArkmeSourceRefPayload,
  ): Promise<ArkmeMessageActionRefPayload> {
    const parts = actionRef.trim().split('.')
    if (parts.length !== 3 || parts[0] !== 'arkme-message-action-v1') {
      throw new ArkmePluginError('message-action-ref-invalid', '消息操作引用无效，请刷新后重试', false)
    }
    const payload = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(payload).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ArkmePluginError('message-action-ref-invalid', '消息操作引用无效，请刷新后重试', false)
    }
    let parsed: Record<string, unknown>
    try { parsed = objectValue(decodeOpaqueJson(payload)) }
    catch (error) {
      throw new ArkmePluginError('message-action-ref-invalid', '消息操作引用无效，请刷新后重试', false, 400, { cause: error })
    }
    const fileNames = listValue(parsed.fileNames).map(value => stringValue(value).trim()).filter(value => value !== '').slice(0, 5)
    const sourceKind = stringValue(parsed.sourceKind).trim()
    const result: ArkmeMessageActionRefPayload = {
      version: 1,
      sourceKind: sourceKind === 'record' ? 'record' : 'chat_relation',
      userId: Math.trunc(numberValue(parsed.userId)),
      sourceOwnerRef: stringValue(parsed.sourceOwnerRef).trim(),
      chatSessionUid: stringValue(parsed.chatSessionUid).trim(),
      relationUid: stringValue(parsed.relationUid).trim(),
      recordOwnerUserId: Math.trunc(numberValue(parsed.recordOwnerUserId)),
      recordUid: stringValue(parsed.recordUid).trim(),
      senderUserId: Math.trunc(numberValue(parsed.senderUserId)),
      senderName: stringValue(parsed.senderName).trim() || 'Arkme用户',
      title: stringValue(parsed.title),
      textContent: stringValue(parsed.textContent),
      sendAtMillis: Math.trunc(numberValue(parsed.sendAtMillis)),
      sourceSequence: Math.max(0, Math.trunc(numberValue(parsed.sourceSequence))),
      templateKind: Math.trunc(numberValue(parsed.templateKind)),
      displayKind: Math.trunc(numberValue(parsed.displayKind)),
      imageCount: Math.max(0, Math.trunc(numberValue(parsed.imageCount))),
      voiceCount: Math.max(0, Math.trunc(numberValue(parsed.voiceCount))),
      fileCount: Math.max(0, Math.trunc(numberValue(parsed.fileCount))),
      fileNames,
    }
    const matchesChatSource = result.sourceKind === 'chat_relation'
      && (source.kind === 'private_chat' || source.kind === 'group_chat')
      && result.sourceOwnerRef === source.ownerRef
      && result.chatSessionUid === source.ownerRef
      && result.relationUid !== ''
      && result.recordUid !== ''
    const matchesRecordSource = result.sourceKind === 'record'
      && (source.kind === 'send_to_self' || source.kind === 'default_category' || source.kind === 'topic')
      && result.sourceOwnerRef === source.ownerRef
      && result.chatSessionUid === ''
      && result.relationUid === ''
      && result.recordOwnerUserId === expectedUserId
      && result.recordUid !== ''
    if (parsed.version !== 1 || result.userId !== expectedUserId || (!matchesChatSource && !matchesRecordSource)) {
      throw new ArkmePluginError('message-action-ref-invalid', '消息操作引用与当前账号或会话不匹配，请刷新后重试', false, 403)
    }
    return result
  }

  private forwardPayloadItem(reference: ArkmeMessageActionRefPayload, itemOrder: number): Record<string, unknown> {
    return {
      item_order: itemOrder,
      source_kind: reference.sourceKind,
      record_uid: reference.recordUid,
      source_type: reference.sourceKind === 'chat_relation' ? 'chat_record' : 'record',
      ...(reference.recordOwnerUserId > 0 ? { owner_id: reference.recordOwnerUserId } : {}),
      ...(reference.relationUid === '' ? {} : { source_rel_uid: reference.relationUid }),
      ...(reference.chatSessionUid === '' ? {} : { source_chat_session_uid: reference.chatSessionUid }),
      ...(reference.sourceSequence > 0 ? { source_seq: reference.sourceSequence } : {}),
      source_sender_user_id: reference.senderUserId,
      source_display_name: reference.senderName,
      owner_name: reference.senderName,
      send_at: reference.sendAtMillis,
      title: reference.title,
      text: reference.textContent,
      text_preview: reference.textContent.trim().slice(0, 500),
      template_kind: reference.templateKind,
      display_kind: reference.displayKind,
      image_count: reference.imageCount,
      voice_count: reference.voiceCount,
      file_count: reference.fileCount,
      file_names: reference.fileNames,
    }
  }

  private forwardClientRequestId(targetChatSessionUid: string, references: readonly ArkmeMessageActionRefPayload[], sendAtMillis: number): string {
    const sourceIdentity = references.map(reference => reference.sourceKind === 'chat_relation'
      ? `chat_record:${reference.chatSessionUid}:${reference.relationUid}`
      : reference.recordUid).join('|')
    const sourceHash = createHash('sha256').update(sourceIdentity).digest('hex').slice(0, 16)
    return `forward_${targetChatSessionUid}_${String(Math.trunc(sendAtMillis))}_${sourceHash}`
  }

  private forwardReferencesOrderedForCommand(references: ArkmeMessageActionRefPayload[]): ArkmeMessageActionRefPayload[] {
    if (references.length < 2 || !references.every(reference =>
      reference.sourceKind === 'chat_relation' && reference.sourceSequence > 0 && reference.chatSessionUid.trim() !== '',
    )) {
      return references
    }
    const sourceSessionUid = references[0]?.chatSessionUid.trim() ?? ''
    if (sourceSessionUid === '' || !references.every(reference => reference.chatSessionUid.trim() === sourceSessionUid)) {
      return references
    }
    const ordered = references.map((reference, index) => ({ reference, index }))
      .sort((left, right) => {
        const sequenceCompare = left.reference.sourceSequence - right.reference.sourceSequence
        return sequenceCompare === 0 ? left.index - right.index : sequenceCompare
      })
      .map(item => item.reference)
    return ordered.every((reference, index) => reference === references[index]) ? references : ordered
  }

  private validateForwardReferences(references: readonly ArkmeMessageActionRefPayload[]): void {
    const sourceTypes = new Set(references.map(reference => reference.sourceKind))
    if (sourceTypes.size > 1) {
      throw new ArkmePluginError('message-actions-selection-invalid', '暂不支持混合转发不同类型的消息', false)
    }
    if (!sourceTypes.has('chat_relation')) return
    const sourceChatSessionUids = new Set(references.map(reference => reference.chatSessionUid.trim()).filter(value => value !== ''))
    if (sourceChatSessionUids.size > 1) {
      throw new ArkmePluginError('message-actions-selection-invalid', '暂不支持跨会话转发聊天消息', false)
    }
  }

  private forwardSourceItemBody(reference: ArkmeMessageActionRefPayload): Record<string, unknown> {
    if (reference.sourceKind === 'chat_relation') {
      return {
        source_type: 'chat_record',
        record_uid: reference.recordUid,
        source_chat_session_uid: reference.chatSessionUid,
        source_rel_uid: reference.relationUid,
        ...(reference.sourceSequence > 0 ? { source_seq: reference.sourceSequence } : {}),
      }
    }
    return {
      source_type: 'record',
      record_uid: reference.recordUid,
    }
  }

  sealMessageRef(userId: number, chatSessionUid: string, relationUid: string, signingKey: string): string {
      const payload = encodeOpaqueJson({ version: 1, userId, chatSessionUid, relationUid } satisfies ArkmeMessageRefPayload)
      const signature = createHmac('sha256', signingKey).update(payload).digest('base64url')
      return `arkme-message-v1.${payload}.${signature}`
    }
  
  async openMessageRef(messageRef: string, expectedUserId: number): Promise<ArkmeMessageRefPayload> {
      const parts = messageRef.trim().split('.')
      if (parts.length !== 3 || parts[0] !== 'arkme-message-v1') {
        throw new ArkmePluginError('message-ref-invalid', 'Arkme 消息引用无效', false)
      }
      const payload = parts[1] ?? ''
      const supplied = Buffer.from(parts[2] ?? '', 'base64url')
      const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(payload).digest()
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        throw new ArkmePluginError('message-ref-invalid', 'Arkme 消息引用无效', false)
      }
      let parsed: Record<string, unknown>
      try {
        parsed = objectValue(decodeOpaqueJson(payload))
      } catch (error) {
        throw new ArkmePluginError('message-ref-invalid', 'Arkme 消息引用无效', false, 400, { cause: error })
      }
      const result: ArkmeMessageRefPayload = {
        version: 1,
        userId: numberValue(parsed.userId),
        chatSessionUid: stringValue(parsed.chatSessionUid).trim(),
        relationUid: stringValue(parsed.relationUid).trim(),
      }
      if (parsed.version !== 1 || result.userId !== expectedUserId || result.chatSessionUid === ''
        || result.relationUid === '') {
        throw new ArkmePluginError('message-ref-invalid', 'Arkme 消息引用与当前账号不匹配', false, 403)
      }
      return result
    }
}
