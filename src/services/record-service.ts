import { createHash, createHmac } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeRecordReeditCommitResult,
  ArkmeRecordReeditDiscardPreparedContext,
  ArkmeRecordReeditDiscardResult,
  ArkmeRecordReeditEditorSnapshot,
  ArkmeRecordReeditPrepareInput,
  ArkmeRecordReeditPreparedContext,
} from '../record-reedit-contract.js'
import type {
  ArkmeCachedQueryResult,
  ArkmeCachedSnapshot,
  ArkmeConversationWriteResult,
  ArkmeCreateFileAssetRecordResult,
  ArkmeCreateTextResult,
  ArkmeLongArticleDetail,
  ArkmeLongArticleDraft,
  ArkmePendingWrite,
  ArkmeRecordTagList,
  ArkmeRecordCaptureContext,
  ArkmeRecordCursor,
  ArkmeRecordReeditDraft,
  ArkmeSelfRecordItem,
  ArkmeSelfRecordList,
  ArkmeSelfSummary,
  ArkmeTimelineItem,
  ArkmeUploadedAsset,
} from '../types.js'
import { arkmeHashTagPayload } from '../hashtag.js'
import { projectRecordRecordingForward } from '../recording-forward-presentation.js'
import { MediaService } from './media-service.js'
import { ArkmePrivacyVisibilityService, arkmePrivacyLockedRecord } from './privacy-visibility.js'
import type { ArkmeSourceRefPayload } from './source-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

export interface ArkmeRecordSourceReader {
  openSourceRef(sourceRef: string, expectedUserId: number): Promise<ArkmeSourceRefPayload>
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

const DSH_AGENT_INPUT_CREATION_SOURCE = 3
const MAX_DEFAULT_CATEGORY_FILTER_BACKFILL_PAGES = 5
const RECORD_REEDIT_SUPPORTED_TEMPLATE_KINDS = new Set([1, 2, 3, 4])

function integerLikeValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return 0
}

function recordCreationSource(raw: unknown): number {
  const item = objectValue(raw)
  const core = objectValue(item.record_core)
  return integerLikeValue(item.creation_source ?? item.creationSource ?? core.creation_source ?? core.creationSource)
}

function isDSHAgentInputRecord(raw: unknown): boolean {
  return recordCreationSource(raw) === DSH_AGENT_INPUT_CREATION_SOURCE
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof ArkmePluginError) return error.message
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return '未知错误'
}

function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    return `{${Object.keys(source).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(source[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function cloneKnownFields(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined) {
      result[field] = structuredClone(source[field])
    }
  }
  return result
}

const RECORD_REEDIT_DYNAMIC_PHOTO_FIELDS = [
  'logical_uid', 'role', 'source_platform', 'source_packaging',
  'presentation_timestamp_millis', 'duration_millis',
] as const

function recordReeditDynamicPhoto(raw: unknown): Record<string, unknown> | undefined {
  const source = objectValue(raw)
  if (Object.keys(source).length === 0) return undefined
  return cloneKnownFields(source, RECORD_REEDIT_DYNAMIC_PHOTO_FIELDS)
}

function recordReeditReadContentPayload(raw: unknown): Record<string, unknown> | undefined {
  const source = objectValue(raw)
  if (Object.keys(source).length === 0) return undefined
  if (listValue(source.legacy_file_refs).length > 0) {
    throw new ArkmePluginError(
      'record-reedit-legacy-files-unsupported',
      '该快记包含尚未升级的历史附件，当前无法安全重新编辑',
      false,
      409,
    )
  }
  const output = cloneKnownFields(source, ['payload_kind', 'schema_version', 'text_state'])
  const mediaRefs = listValue(source.media_refs).map(rawRef => {
    const ref = objectValue(rawRef)
    if (ref.legacy_file_ref === true) {
      throw new ArkmePluginError(
        'record-reedit-legacy-files-unsupported',
        '该快记包含尚未升级的历史附件，当前无法安全重新编辑',
        false,
        409,
      )
    }
    const writable = cloneKnownFields(ref, [
      'file_asset_uid', 'render_role', 'sort_order', 'duration_sec', 'file_name',
    ])
    const dynamicPhoto = recordReeditDynamicPhoto(ref.dynamic_photo)
    if (dynamicPhoto !== undefined) writable.dynamic_photo = dynamicPhoto
    return writable
  }).filter(ref => Object.keys(ref).length > 0)
  if (mediaRefs.length > 0) output.media_refs = mediaRefs

  const voiceSource = objectValue(source.voice)
  if (Object.keys(voiceSource).length > 0) {
    if (voiceSource.legacy_file_ref === true) {
      throw new ArkmePluginError(
        'record-reedit-legacy-files-unsupported',
        '该快记包含尚未升级的历史附件，当前无法安全重新编辑',
        false,
        409,
      )
    }
    output.voice = cloneKnownFields(voiceSource, [
      'source_file_asset_uid', 'duration_millis', 'transcription_state', 'file_name',
    ])
  }
  const mentionMetadata = objectValue(source.mention_metadata)
  if (Object.keys(mentionMetadata).length > 0) {
    const writable = cloneKnownFields(mentionMetadata, ['schema_version', 'source_checksum'])
    const humanMentions = listValue(mentionMetadata.human_mentions)
      .map(rawMention => cloneKnownFields(objectValue(rawMention), [
        'user_id', 'display_name_snapshot', 'start_index', 'length',
      ]))
      .filter(mention => Object.keys(mention).length > 0)
    const botMentions = listValue(mentionMetadata.bot_mentions)
      .map(rawMention => cloneKnownFields(objectValue(rawMention), [
        'bot_uid', 'display_name_snapshot', 'start_index', 'length',
      ]))
      .filter(mention => Object.keys(mention).length > 0)
    if (humanMentions.length > 0) writable.human_mentions = humanMentions
    if (botMentions.length > 0) writable.bot_mentions = botMentions
    output.mention_metadata = writable
  }
  const locationMentions = listValue(source.location_mentions)
    .map(rawMention => cloneKnownFields(objectValue(rawMention), [
      'poi_name', 'address', 'lat', 'lon', 'city', 'county', 'road', 'provider', 'place_id',
      'start_index', 'length',
    ]))
    .filter(mention => Object.keys(mention).length > 0)
  if (locationMentions.length > 0) output.location_mentions = locationMentions
  return output
}

function recordReeditContentPayloadForWrite(
  contentPayload: Record<string, unknown> | undefined,
  currentText: string,
  nextText: string,
): Record<string, unknown> | undefined {
  if (contentPayload === undefined) return undefined
  if (nextText !== currentText
    && (Object.keys(objectValue(contentPayload.mention_metadata)).length > 0
      || listValue(contentPayload.location_mentions).length > 0)) {
    throw new ArkmePluginError(
      'record-reedit-rich-text-unsupported',
      '该快记包含 @ 或位置内容，当前只能保持正文不变后修改标题',
      false,
      409,
    )
  }
  const output = structuredClone(contentPayload)
  if (Object.prototype.hasOwnProperty.call(output, 'text_state')) output.text_state = 1
  return output
}

function recordReeditHasAttachments(contentPayload: Record<string, unknown> | undefined): boolean {
  if (contentPayload === undefined) return false
  return listValue(contentPayload.media_refs).length > 0
    || Object.keys(objectValue(contentPayload.voice)).length > 0
}

interface RecordReeditOwnerSnapshot {
  source: ArkmeSourceRefPayload
  sourceIdentityKey: string
  itemUid: string
  ownerUserId: number
  originContainerRef: string
  title: string
  textContent: string
  templateKind: number
  displayKind: number
  contentPayload?: Record<string, unknown>
  recordDurationMillis: number
  editDurationMillis: number
  sendAtMillis: number
  status: number
  version: number
  fingerprint: string
}

function recordReeditFingerprint(input: Omit<RecordReeditOwnerSnapshot, 'source' | 'sourceIdentityKey' | 'fingerprint'>): string {
  return createHash('sha256').update(canonicalJSON(input)).digest('hex')
}

export function arkmeRecordCaptureContextPayload(input: ArkmeRecordCaptureContext): Record<string, unknown> {
  const clientName = input.clientName?.trim().slice(0, 120) ?? ''
  const networkName = input.networkName?.trim().slice(0, 120) ?? ''
  const electric = input.electric === undefined ? undefined : Math.trunc(input.electric)
  const charge = Math.trunc(input.charge ?? 0)
  return {
    ...(clientName === '' ? {} : { client_name: clientName }),
    ...(networkName === '' ? {} : { network_name: networkName }),
    ...(electric === undefined || electric < 0 || electric > 100 ? {} : { electric }),
    ...(charge < 1 || charge > 3 ? {} : { charge }),
  }
}

function normalizedRecordCaptureContext(input: ArkmeRecordCaptureContext | undefined): ArkmeRecordCaptureContext | undefined {
  if (input === undefined) return undefined
  const payload = arkmeRecordCaptureContextPayload(input)
  const clientName = stringValue(payload.client_name)
  const networkName = stringValue(payload.network_name)
  const electric = numberValue(payload.electric)
  const charge = numberValue(payload.charge)
  const normalized: ArkmeRecordCaptureContext = {
    ...(clientName === '' ? {} : { clientName }),
    ...(networkName === '' ? {} : { networkName }),
    ...(payload.electric === undefined ? {} : { electric }),
    ...(charge === 0 ? {} : { charge }),
  }
  return Object.keys(normalized).length === 0 ? undefined : normalized
}

export class RecordService {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly media: MediaService,
    private readonly source: ArkmeRecordSourceReader,
    private readonly privacy = new ArkmePrivacyVisibilityService(runtime),
  ) {}

  async prepareRecordReedit(
    input: ArkmeRecordReeditPrepareInput,
    options: { expectedBaseVersion?: number } = {},
  ): Promise<ArkmeRecordReeditPreparedContext> {
    const session = await this.runtime.requireSession()
    const sourceRef = input.sourceRef.trim()
    const itemUid = input.itemUid.trim()
    if (sourceRef === '' || itemUid === '') {
      throw new ArkmePluginError('record-reedit-target-invalid', '重新编辑目标无效', false)
    }
    const owner = await this.recordReeditOwnerSnapshot(sourceRef, itemUid, session)
    const previous = await this.runtime.stateStore.getRecordReeditDraft(
      session.userId, owner.sourceIdentityKey, itemUid,
    )
    const expectedBaseVersion = options.expectedBaseVersion
    if (expectedBaseVersion !== undefined
      && (!Number.isSafeInteger(expectedBaseVersion) || expectedBaseVersion <= 0)) {
      throw new ArkmePluginError('record-reedit-version-invalid', '重新编辑版本无效，请重新打开后再试', false, 409)
    }
    const hasNewText = input.newText !== undefined
    if (!hasNewText && previous === undefined) {
      throw new ArkmePluginError('record-reedit-draft-not-found', '该快记没有可恢复的重新编辑草稿，请提供新的正文', false, 404)
    }
    const textContent = (hasNewText ? input.newText! : previous!.textContent).trim()
    const title = (input.newTitle !== undefined
      ? input.newTitle
      : hasNewText ? owner.title : previous!.title).trim()
    const maxTextLength = owner.displayKind === 1 ? 40_000 : this.runtime.config.maxTextLength
    if (textContent === '' || textContent.length > maxTextLength || title.length > 100) {
      throw new ArkmePluginError('record-reedit-content-invalid', '重新编辑的标题或正文长度无效', false)
    }
    recordReeditContentPayloadForWrite(owner.contentPayload, owner.textContent, textContent)
    const preservesExpectedBaseline = expectedBaseVersion !== undefined
      && previous?.baseVersion === expectedBaseVersion
    const baseVersion = expectedBaseVersion ?? owner.version
    const baseContentFingerprint = preservesExpectedBaseline
      ? previous.baseContentFingerprint
      : owner.fingerprint
    const editing = await this.runtime.stateStore.putRecordReeditDraft(session.userId, {
      schemaVersion: 1,
      sourceIdentityKey: owner.sourceIdentityKey,
      lastSourceRef: sourceRef,
      itemUid,
      title,
      textContent,
      baseVersion,
      baseContentFingerprint,
      editDurationMillis: previous?.editDurationMillis ?? owner.editDurationMillis,
      updatedAtMillis: Date.now(),
    })
    return {
      expectedUserId: session.userId,
      sourceRef,
      sourceIdentityKey: owner.sourceIdentityKey,
      sourceKind: owner.source.kind,
      sourceDisplayName: owner.source.displayName,
      itemUid,
      draftRevision: editing.draftRevision,
      baseVersion: editing.baseVersion,
      baseContentFingerprint: editing.baseContentFingerprint,
      oldTitle: owner.title,
      oldTextPreview: owner.textContent.slice(0, 160),
      newTitle: title,
      newTextPreview: textContent.slice(0, 160),
      sendAtMillis: owner.sendAtMillis,
      preservesAttachments: recordReeditHasAttachments(owner.contentPayload),
    }
  }

  async recordReeditEditor(sourceRefInput: string, itemUidInput: string): Promise<ArkmeRecordReeditEditorSnapshot> {
    const session = await this.runtime.requireSession()
    const sourceRef = sourceRefInput.trim()
    const itemUid = itemUidInput.trim()
    if (sourceRef === '' || itemUid === '') {
      throw new ArkmePluginError('record-reedit-target-invalid', '重新编辑目标无效', false)
    }
    const owner = await this.recordReeditOwnerSnapshot(sourceRef, itemUid, session)
    const draft = await this.runtime.stateStore.getRecordReeditDraft(
      session.userId, owner.sourceIdentityKey, itemUid,
    )
    return {
      sourceRef,
      itemUid,
      title: owner.title,
      textContent: owner.textContent,
      sendAtMillis: owner.sendAtMillis,
      templateKind: owner.templateKind,
      displayKind: owner.displayKind,
      version: owner.version,
      maxTextLength: owner.displayKind === 1 ? 40_000 : this.runtime.config.maxTextLength,
      preservesAttachments: recordReeditHasAttachments(owner.contentPayload),
      ...(draft === undefined ? {} : { draft: {
        title: draft.title,
        textContent: draft.textContent,
        updatedAtMillis: draft.updatedAtMillis,
      } }),
    }
  }

  async commitRecordReedit(context: ArkmeRecordReeditPreparedContext): Promise<ArkmeRecordReeditCommitResult> {
    const session = await this.runtime.requireSession()
    if (session.userId !== context.expectedUserId) {
      throw new ArkmePluginError('record-reedit-account-changed', '当前账号已变化，请切回原账号后重新确认', false, 409)
    }
    const source = await this.source.openSourceRef(context.sourceRef, session.userId)
    const sourceIdentityKey = await this.recordReeditSourceIdentityKey(source)
    if (sourceIdentityKey !== context.sourceIdentityKey) {
      throw new ArkmePluginError('record-reedit-source-changed', '重新编辑来源已变化，请重新发起', false, 409)
    }
    const draft = await this.runtime.stateStore.getRecordReeditDraft(
      session.userId, sourceIdentityKey, context.itemUid,
    )
    if (draft === undefined || draft.draftRevision !== context.draftRevision) {
      throw new ArkmePluginError('record-reedit-draft-changed', '重新编辑草稿已变化，请重新确认', false, 409)
    }
    const owner = await this.recordReeditOwnerSnapshot(context.sourceRef, context.itemUid, session, source)
    if (owner.version !== context.baseVersion || owner.fingerprint !== context.baseContentFingerprint) {
      throw new ArkmePluginError('record-reedit-conflict', '快记已在其他位置更新，草稿已保留，请检查后重新确认', false, 409)
    }
    const body = this.recordReeditUpdateBody(owner, draft.title, draft.textContent)
    const committedContentPayload = objectValue(body.content_payload)
    const { source: _source, sourceIdentityKey: _sourceIdentityKey, fingerprint: _fingerprint, ...baseFields } = owner
    const expectedCommittedFingerprint = recordReeditFingerprint({
      ...baseFields,
      title: draft.title,
      textContent: draft.textContent,
      ...(owner.contentPayload === undefined ? {} : { contentPayload: committedContentPayload }),
      version: owner.version + 1,
    })
    try {
      const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
        '/api/v1/records/update', body, session, undefined, { trackWriteOutcome: true },
      )
      return await this.acceptRecordReeditCommit(session.userId, context, draft, data)
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || error.writeOutcomeUnknown !== true) throw error
      return await this.reconcileRecordReeditUnknownOutcome(
        session, context, draft, expectedCommittedFingerprint,
      )
    }
  }

  async prepareDiscardRecordReeditDraft(
    sourceRefInput: string,
    itemUidInput: string,
  ): Promise<ArkmeRecordReeditDiscardPreparedContext> {
    const session = await this.runtime.requireSession()
    const sourceRef = sourceRefInput.trim()
    const itemUid = itemUidInput.trim()
    if (sourceRef === '' || itemUid === '') {
      throw new ArkmePluginError('record-reedit-target-invalid', '重新编辑目标无效', false)
    }
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    const sourceIdentityKey = await this.recordReeditSourceIdentityKey(source)
    const draft = await this.runtime.stateStore.getRecordReeditDraft(session.userId, sourceIdentityKey, itemUid)
    if (draft === undefined) {
      throw new ArkmePluginError('record-reedit-draft-not-found', '该快记没有可放弃的重新编辑草稿', false, 404)
    }
    return {
      expectedUserId: session.userId,
      sourceRef,
      sourceIdentityKey,
      sourceDisplayName: source.displayName,
      itemUid,
      draftRevision: draft.draftRevision,
      textPreview: draft.textContent.slice(0, 160),
    }
  }

  async discardRecordReeditDraft(
    context: ArkmeRecordReeditDiscardPreparedContext,
  ): Promise<ArkmeRecordReeditDiscardResult> {
    const session = await this.runtime.requireSession()
    if (session.userId !== context.expectedUserId) {
      throw new ArkmePluginError('record-reedit-account-changed', '当前账号已变化，请切回原账号后重新确认', false, 409)
    }
    const source = await this.source.openSourceRef(context.sourceRef, session.userId)
    const sourceIdentityKey = await this.recordReeditSourceIdentityKey(source)
    if (sourceIdentityKey !== context.sourceIdentityKey) {
      throw new ArkmePluginError('record-reedit-source-changed', '重新编辑来源已变化，请重新发起', false, 409)
    }
    if (!await this.runtime.stateStore.removeRecordReeditDraft(
      session.userId, sourceIdentityKey, context.itemUid, context.draftRevision,
    )) {
      throw new ArkmePluginError('record-reedit-draft-changed', '重新编辑草稿已变化，请重新确认', false, 409)
    }
    return { status: 'discarded', itemUid: context.itemUid }
  }

  async longArticleDetail(sourceRef: string, itemUid: string, signal?: AbortSignal): Promise<ArkmeLongArticleDetail> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    const uid = itemUid.trim()
    if (uid === '') throw new ArkmePluginError('long-article-item-invalid', '长文记录标识无效', false)
    const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/records/detail', { record_uid: uid }, session, signal,
    )
    const core = objectValue(data.record_core)
    const recordUid = stringValue(core.record_uid).trim()
    const templateKind = numberValue(core.template_kind)
    const displayKind = numberValue(core.display_kind)
    if (recordUid !== uid || (templateKind !== 8 && displayKind !== 1)) {
      throw new ArkmePluginError('long-article-not-found', '未找到可用的长文详情', false, 404)
    }
    const originContainerRef = stringValue(core.origin_container_ref).trim()
    if (source.kind === 'topic') {
      const topicUid = stringValue(objectValue(data.topic_core).topic_uid).trim()
      if (topicUid !== source.ownerRef) throw new ArkmePluginError('long-article-source-mismatch', '长文不属于当前会话', false, 403)
    } else if (source.kind === 'private_chat' || source.kind === 'group_chat') {
      if (originContainerRef !== source.ownerRef) throw new ArkmePluginError('long-article-source-mismatch', '长文不属于当前会话', false, 403)
    } else if (numberValue(core.owner_user_id) !== session.userId) {
      throw new ArkmePluginError('long-article-source-mismatch', '长文不属于当前会话', false, 403)
    }
    const recordDurationMillis = Math.max(0, Math.trunc(numberValue(core.record_duration_millis)))
    const editDurationMillis = Math.max(0, Math.trunc(numberValue(core.edit_duration_millis)))
    return {
      sourceRef,
      itemUid: recordUid,
      title: stringValue(core.title),
      textContent: stringValue(core.text_content),
      sendAtMillis: Math.trunc(numberValue(core.send_at)),
      updateAtMillis: Math.trunc(numberValue(core.update_at)),
      recordDurationMillis,
      editDurationMillis,
      thinkingDurationMillis: recordDurationMillis + editDurationMillis,
      version: Math.trunc(numberValue(core.version)),
      editable: numberValue(core.owner_user_id) === session.userId && numberValue(core.creator_user_id) === session.userId,
    }
  }

  async updateLongArticle(
    sourceRef: string,
    itemUid: string,
    input: { title: string; textContent: string; version: number; editDurationMillis: number },
  ): Promise<ArkmeLongArticleDetail> {
    if (this.runtime.config.richMediaSendEnabled === false) {
      throw new ArkmePluginError('rich-content-disabled', '长文编辑已被插件配置关闭', false, 403)
    }
    const session = await this.runtime.requireSession()
    const detail = await this.longArticleDetail(sourceRef, itemUid)
    const title = input.title.trim()
    const textContent = input.textContent.trim()
    const editDurationMillis = Math.max(0, Math.trunc(input.editDurationMillis))
    if (!detail.editable) throw new ArkmePluginError('long-article-not-editable', '只能编辑自己发布的长文', false, 403)
    if (title === '' || title.length > 100 || textContent === '' || textContent.length > 40000
      || !Number.isSafeInteger(input.version) || input.version <= 0 || input.version !== detail.version) {
      throw new ArkmePluginError('long-article-update-invalid', '长文内容或版本无效，请刷新后重试', false, 409)
    }
    await this.runtime.authenticatedPost<Record<string, unknown>>('/api/v1/records/update', {
      record_uid: detail.itemUid,
      template_kind: 1,
      display_kind: 1,
      title,
      text_content: textContent,
      record_duration_millis: detail.recordDurationMillis,
      edit_duration_millis: editDurationMillis,
      version: detail.version,
    }, session)
    return await this.longArticleDetail(sourceRef, itemUid)
  }

  async getLongArticleDraft(sourceRef: string, itemUid?: string): Promise<ArkmeLongArticleDraft | undefined> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    const uid = itemUid?.trim() || undefined
    if (uid === undefined) return await this.runtime.stateStore.getLongArticleDraft(session.userId, sourceRef)
    const sourceIdentityKey = await this.recordReeditSourceIdentityKey(source)
    const current = await this.runtime.stateStore.getRecordReeditDraft(session.userId, sourceIdentityKey, uid)
    if (current !== undefined) return this.longArticleDraftFromRecordReedit(current, sourceRef)
    const legacy = await this.runtime.stateStore.getLongArticleDraft(session.userId, sourceRef, uid)
    if (legacy === undefined) return undefined
    const detail = await this.longArticleDetail(sourceRef, uid)
    const migrated = await this.runtime.stateStore.putRecordReeditDraft(session.userId, {
      schemaVersion: 1,
      sourceIdentityKey,
      lastSourceRef: sourceRef,
      itemUid: uid,
      title: legacy.title,
      textContent: legacy.textContent,
      baseVersion: detail.version,
      baseContentFingerprint: this.longArticleContentFingerprint(detail),
      editDurationMillis: legacy.durationMillis,
      updatedAtMillis: legacy.updatedAtMillis,
    })
    await this.runtime.stateStore.removeLongArticleDraft(session.userId, sourceRef, uid)
    return this.longArticleDraftFromRecordReedit(migrated, sourceRef)
  }

  async putLongArticleDraft(draft: ArkmeLongArticleDraft): Promise<void> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(draft.sourceRef, session.userId)
    const itemUid = draft.itemUid?.trim() || undefined
    if (draft.title.length > 100 || draft.textContent.length > 40000 || draft.durationMillis < 0) {
      throw new ArkmePluginError('long-article-draft-invalid', '长文草稿内容无效', false)
    }
    if (itemUid === undefined) {
      await this.runtime.stateStore.putLongArticleDraft(session.userId, {
        sourceRef: draft.sourceRef,
        title: draft.title,
        textContent: draft.textContent,
        durationMillis: Math.max(0, Math.trunc(draft.durationMillis)),
        updatedAtMillis: Date.now(),
      })
      return
    }
    const sourceIdentityKey = await this.recordReeditSourceIdentityKey(source)
    const current = await this.runtime.stateStore.getRecordReeditDraft(session.userId, sourceIdentityKey, itemUid)
    const detail = current === undefined ? await this.longArticleDetail(draft.sourceRef, itemUid) : undefined
    await this.runtime.stateStore.putRecordReeditDraft(session.userId, {
      schemaVersion: 1,
      sourceIdentityKey,
      lastSourceRef: draft.sourceRef,
      itemUid,
      title: draft.title,
      textContent: draft.textContent,
      baseVersion: current?.baseVersion ?? detail!.version,
      baseContentFingerprint: current?.baseContentFingerprint ?? this.longArticleContentFingerprint(detail!),
      editDurationMillis: Math.max(0, Math.trunc(draft.durationMillis)),
      updatedAtMillis: Date.now(),
    })
    await this.runtime.stateStore.removeLongArticleDraft(session.userId, draft.sourceRef, itemUid)
  }

  async removeLongArticleDraft(sourceRef: string, itemUid?: string): Promise<void> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    const uid = itemUid?.trim() || undefined
    if (uid !== undefined) {
      const sourceIdentityKey = await this.recordReeditSourceIdentityKey(source)
      const current = await this.runtime.stateStore.getRecordReeditDraft(session.userId, sourceIdentityKey, uid)
      if (current !== undefined) {
        await this.runtime.stateStore.removeRecordReeditDraft(
          session.userId, sourceIdentityKey, uid, current.draftRevision,
        )
      }
    }
    await this.runtime.stateStore.removeLongArticleDraft(session.userId, sourceRef, uid)
  }

  private async recordReeditSourceIdentityKey(source: ArkmeSourceRefPayload): Promise<string> {
    const digest = createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(`record-reedit-source-v1:${String(source.userId)}:${source.kind}:${source.ownerRef}`)
      .digest('base64url')
    return `arkme-record-reedit-source-v1.${digest}`
  }

  private async recordReeditOwnerSnapshot(
    sourceRef: string,
    itemUid: string,
    session: ArkmeSessionCredentials,
    openedSource?: ArkmeSourceRefPayload,
  ): Promise<RecordReeditOwnerSnapshot> {
    const source = openedSource ?? await this.source.openSourceRef(sourceRef, session.userId)
    const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/records/detail', { record_uid: itemUid }, session,
    )
    const core = objectValue(data.record_core)
    if (stringValue(core.record_uid).trim() !== itemUid) {
      throw new ArkmePluginError('record-reedit-not-found', '未找到可重新编辑的快记', false, 404)
    }
    if (numberValue(core.owner_user_id) !== session.userId || numberValue(core.creator_user_id) !== session.userId) {
      throw new ArkmePluginError('record-reedit-not-editable', '只能重新编辑自己创建并拥有的快记', false, 403)
    }
    if (numberValue(core.status) !== 1 || arkmePrivacyLockedRecord(data)) {
      throw new ArkmePluginError('record-reedit-not-editable', '该快记当前不可重新编辑', false, 403)
    }
    const originContainerRef = stringValue(core.origin_container_ref).trim()
    const originKind = Math.trunc(numberValue(core.origin_kind))
    const topicUid = stringValue(objectValue(data.topic_core).topic_uid).trim()
    if (source.kind === 'topic') {
      if (originKind !== 2 || topicUid !== source.ownerRef) {
        throw new ArkmePluginError('record-reedit-source-mismatch', '快记不属于当前来源', false, 403)
      }
    } else if (source.kind === 'private_chat' || source.kind === 'group_chat') {
      const expectedOriginKind = source.kind === 'private_chat' ? 3 : 4
      if (originKind !== expectedOriginKind || originContainerRef !== source.ownerRef) {
        throw new ArkmePluginError('record-reedit-source-mismatch', '快记不属于当前会话', false, 403)
      }
    } else if (source.kind === 'default_category') {
      if (originKind !== 1 || originContainerRef !== '' || topicUid !== '') {
        throw new ArkmePluginError('record-reedit-source-mismatch', '快记不属于未分类来源', false, 403)
      }
    } else if (source.kind === 'send_to_self' && originKind !== 1 && originKind !== 2) {
      throw new ArkmePluginError('record-reedit-source-mismatch', '快记不属于发给自己的内容来源', false, 403)
    }
    const templateKind = Math.trunc(numberValue(core.template_kind))
    const displayKind = Math.trunc(numberValue(core.display_kind))
    if (!RECORD_REEDIT_SUPPORTED_TEMPLATE_KINDS.has(templateKind)) {
      throw new ArkmePluginError('record-reedit-shape-unsupported', '该内容形态暂不支持重新编辑', false, 409)
    }
    const version = Math.trunc(numberValue(core.version))
    if (version <= 0) throw new ArkmePluginError('record-reedit-detail-invalid', '快记版本无效，请刷新后重试', true, 502)
    if (objectValue(objectValue(core.content_payload).forward_records).source_type === 'long_recording_segments') {
      throw new ArkmePluginError('record-reedit-shape-unsupported', '录音片段快照不支持重新编辑', false, 409)
    }
    const contentPayload = recordReeditReadContentPayload(core.content_payload)
    const snapshotFields: Omit<RecordReeditOwnerSnapshot, 'source' | 'sourceIdentityKey' | 'fingerprint'> = {
      itemUid,
      ownerUserId: session.userId,
      originContainerRef,
      templateKind,
      displayKind,
      title: stringValue(core.title),
      textContent: stringValue(core.text_content),
      ...(contentPayload === undefined ? {} : { contentPayload }),
      recordDurationMillis: Math.max(0, Math.trunc(numberValue(core.record_duration_millis))),
      editDurationMillis: Math.max(0, Math.trunc(numberValue(core.edit_duration_millis))),
      sendAtMillis: Math.trunc(numberValue(core.send_at)),
      status: 1,
      version,
    }
    return {
      source,
      sourceIdentityKey: await this.recordReeditSourceIdentityKey(source),
      ...snapshotFields,
      fingerprint: recordReeditFingerprint(snapshotFields),
    }
  }

  private recordReeditUpdateBody(
    owner: RecordReeditOwnerSnapshot,
    title: string,
    textContent: string,
  ): Record<string, unknown> {
    const contentPayload = recordReeditContentPayloadForWrite(owner.contentPayload, owner.textContent, textContent)
    return {
      record_uid: owner.itemUid,
      template_kind: owner.templateKind,
      ...(owner.displayKind <= 0 ? {} : { display_kind: owner.displayKind }),
      title,
      text_content: textContent,
      ...(contentPayload === undefined ? {} : { content_payload: contentPayload }),
      record_duration_millis: owner.recordDurationMillis,
      edit_duration_millis: owner.editDurationMillis,
      version: owner.version,
    }
  }

  private async acceptRecordReeditCommit(
    userId: number,
    context: ArkmeRecordReeditPreparedContext,
    draft: ArkmeRecordReeditDraft,
    data: Record<string, unknown>,
  ): Promise<ArkmeRecordReeditCommitResult> {
    const core = objectValue(data.record_core)
    const itemUid = stringValue(core.record_uid).trim()
    const version = Math.trunc(numberValue(core.version))
    const revisionUid = stringValue(data.revision_uid).trim()
    if (itemUid !== context.itemUid || version !== context.baseVersion + 1 || revisionUid === '') {
      throw new ArkmePluginError(
        'record-reedit-response-invalid', '快记更新响应不完整，正在等待状态确认', false, 502,
        { writeOutcomeUnknown: true },
      )
    }
    if (!await this.runtime.stateStore.removeRecordReeditDraft(
      userId, context.sourceIdentityKey, context.itemUid, draft.draftRevision,
    )) {
      throw new ArkmePluginError('record-reedit-draft-changed', '快记已更新，但本机草稿发生变化，请勿重复提交', false, 409)
    }
    return { status: 'committed', itemUid, version, revisionUid, projectionState: 'pending' }
  }

  private async reconcileRecordReeditUnknownOutcome(
    session: ArkmeSessionCredentials,
    context: ArkmeRecordReeditPreparedContext,
    draft: ArkmeRecordReeditDraft,
    expectedCommittedFingerprint: string,
  ): Promise<ArkmeRecordReeditCommitResult> {
    let current: RecordReeditOwnerSnapshot
    try {
      current = await this.recordReeditOwnerSnapshot(context.sourceRef, context.itemUid, session)
    } catch (error) {
      throw new ArkmePluginError('record-reedit-outcome-unknown', '提交结果暂时无法确认，草稿已保留，请稍后查询，勿重复提交', false, 409, { cause: error })
    }
    if (current.version === context.baseVersion + 1 && current.fingerprint === expectedCommittedFingerprint) {
      const removed = await this.runtime.stateStore.removeRecordReeditDraft(
        session.userId, context.sourceIdentityKey, context.itemUid, draft.draftRevision,
      )
      if (!removed) throw new ArkmePluginError('record-reedit-draft-changed', '快记已更新，但本机草稿发生变化，请勿重复提交', false, 409)
      return {
        status: 'committed', itemUid: current.itemUid, version: current.version,
        revisionUid: '', projectionState: 'pending',
      }
    }
    if (current.version === context.baseVersion && current.fingerprint === context.baseContentFingerprint) {
      throw new ArkmePluginError('record-reedit-outcome-unknown', '提交结果暂时无法确认，草稿已保留，请稍后查询，勿重复提交', false, 409)
    }
    throw new ArkmePluginError('record-reedit-conflict', '快记内容已变化，草稿已保留，请检查后重新确认', false, 409)
  }

  private longArticleContentFingerprint(detail: ArkmeLongArticleDetail): string {
    return createHash('sha256')
      .update(JSON.stringify([detail.itemUid, detail.title, detail.textContent, detail.version]))
      .digest('hex')
  }

  private longArticleDraftFromRecordReedit(
    draft: ArkmeRecordReeditDraft,
    sourceRef: string,
  ): ArkmeLongArticleDraft {
    return {
      sourceRef,
      itemUid: draft.itemUid,
      title: draft.title,
      textContent: draft.textContent,
      durationMillis: draft.editDurationMillis,
      updatedAtMillis: draft.updatedAtMillis,
    }
  }

  async cachedSnapshot(): Promise<ArkmeCachedSnapshot> {
    const session = await this.runtime.requireSession()
    return await this.runtime.stateStore.cachedSnapshot(session.userId)
  }

  async queryCached(options: {
    query?: string
    limit: number
    beforeMillis?: number
  }): Promise<ArkmeCachedQueryResult> {
    const session = await this.runtime.requireSession()
    return await this.runtime.stateStore.queryCached(session.userId, options)
  }

  async refreshLatest(): Promise<void> {
    await Promise.all([this.summary(), this.list(50)])
  }

  async listTags(limit = 100, signal?: AbortSignal): Promise<ArkmeRecordTagList> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/records/tags/list',
      { limit: Math.max(1, Math.min(200, Math.trunc(limit))) },
      session,
      signal,
    )
    return {
      items: listValue(data.items).flatMap(raw => {
        const item = objectValue(raw)
        const tagText = stringValue(item.tag_text ?? item.tagText).trim()
        if (tagText === '') return []
        return [{
          normalizedTag: stringValue(item.normalized_tag ?? item.normalizedTag).trim() || tagText.toLowerCase(),
          tagText,
          recordCount: Math.max(0, Math.trunc(numberValue(item.record_count ?? item.recordCount))),
          latestRecordUid: stringValue(item.latest_record_uid ?? item.latestRecordUid).trim(),
          latestSendAtMillis: Math.max(0, Math.trunc(numberValue(item.latest_send_at ?? item.latestSendAtMillis))),
        }]
      }),
    }
  }

  /**
   * Mirrors Flutter's post-commit tag sync. Record creation is already the
   * commit boundary, so a projection-side failure is diagnostic only and must
   * never turn an accepted message into a retryable send.
   */
  async syncCreatedRecordTags(
    recordUid: string,
    textContent: string,
    expectedUserId?: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const tags = arkmeHashTagPayload(textContent)
    if (tags.length === 0) return
    try {
      const session = await this.runtime.requireSession()
      if (expectedUserId !== undefined && session.userId !== expectedUserId) return
      await this.runtime.authenticatedPost(
        '/api/v1/records/tags/set',
        {
          record_uid: recordUid.trim(),
          expected_record_version: 1,
          tags: tags.map(tag => ({
            tag_text: tag.tag,
            start_index: tag.start_index,
            length: tag.length,
          })),
        },
        session,
        signal,
      )
    } catch (error) {
      if (signal?.aborted !== true) {
        console.warn('dsh-arkme: record tag post-commit sync failed', safeFailureMessage(error))
      }
    }
  }

  async refreshSnapshot(): Promise<ArkmeCachedSnapshot> {
    await this.refreshLatest()
    return await this.cachedSnapshot()
  }

  async summary(): Promise<ArkmeSelfSummary> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/records/uncategorized/summary',
      {},
      session,
    )
    const summary = {
      recordCount: numberValue(data.record_count),
      wordsCount: numberValue(data.words_count ?? data.available_text_rune_count),
      totalSec: numberValue(data.total_sec ?? data.available_voice_duration_sec),
    }
    await this.runtime.stateStore.cacheSummary(session.userId, summary)
    return summary
  }

  async list(limit: number, cursor?: ArkmeRecordCursor): Promise<ArkmeSelfRecordList> {
    const session = await this.runtime.requireSession()
    const lockedRecordUids = await this.privacy.lockedRecordUids(session)
    const normalizedLimit = Math.min(50, Math.max(1, Math.trunc(limit || 30)))
    let requestCursor = cursor
    let hasMore = false
    let backendNextCursor: ArkmeRecordCursor | undefined
    const visibleRawItems: unknown[] = []
    for (let pageIndex = 0; pageIndex < MAX_DEFAULT_CATEGORY_FILTER_BACKFILL_PAGES; pageIndex += 1) {
      const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
        '/api/v1/records/uncategorized/query',
        {
          limit: normalizedLimit,
          ...(requestCursor === undefined ? {} : {
            cursor_send_at: requestCursor.sendAtMillis,
            cursor_record_uid: requestCursor.recordUid,
          }),
        },
        session,
      )
      const rawPageItems = listValue(data.items)
      const visiblePageItems = rawPageItems.filter(raw => !isDSHAgentInputRecord(raw)
        && !arkmePrivacyLockedRecord(raw) && !lockedRecordUids.has(this.recordUid(raw)))
      visibleRawItems.push(...visiblePageItems)
      hasMore = data.has_more === true
      const nextSendAt = numberValue(data.next_cursor_send_at)
      const nextUid = stringValue(data.next_cursor_record_uid)
      backendNextCursor = nextSendAt > 0 && nextUid !== ''
        ? { sendAtMillis: nextSendAt, recordUid: nextUid }
        : undefined
      const filteredCount = rawPageItems.length - visiblePageItems.length
      if (visibleRawItems.length >= normalizedLimit || !hasMore || backendNextCursor === undefined || filteredCount === 0) break
      requestCursor = backendNextCursor
    }
    const visibleOverflow = visibleRawItems.length > normalizedLimit
    const rawItems = visibleRawItems.slice(0, normalizedLimit)
    const media = await this.media.hydrateRecordMediaPage(rawItems, session)
    const items = rawItems.map(raw => {
      const recordUid = this.recordUid(raw)
      const displayItems = media.displayItemsByRecordUid.get(recordUid)
      return this.recordItem(raw, session.userId, {
        ...(displayItems === undefined ? {} : { displayItems }),
        mediaUnavailable: media.unavailableRecordUids.has(recordUid),
      })
    }).filter(
      (item): item is ArkmeSelfRecordItem => item !== undefined,
    )
    const lastVisibleRaw = rawItems.at(-1)
    const lastVisibleCursor = lastVisibleRaw === undefined ? undefined : {
      sendAtMillis: numberValue(objectValue(lastVisibleRaw).send_at ?? objectValue(objectValue(lastVisibleRaw).record_core).send_at),
      recordUid: this.recordUid(lastVisibleRaw),
    }
    const filledRequestedPage = rawItems.length >= normalizedLimit
    const nextCursor = lastVisibleCursor !== undefined
      && lastVisibleCursor.sendAtMillis > 0
      && lastVisibleCursor.recordUid !== ''
      && (visibleOverflow || (filledRequestedPage && hasMore))
      ? lastVisibleCursor
      : backendNextCursor
    const page: ArkmeSelfRecordList = {
      items,
      hasMore: hasMore || visibleOverflow,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    }
    await this.runtime.stateStore.cachePage(session.userId, page, cursor)
    return page
  }

  async createText(
    recordUid: string,
    textContent: string,
    options: { expectedUserId?: number; recordDurationMillis?: number; captureContext?: ArkmeRecordCaptureContext } = {},
  ): Promise<ArkmeCreateTextResult> {
    const session = await this.runtime.requireSession()
    if (options.expectedUserId !== undefined && options.expectedUserId !== session.userId) {
      throw new ArkmePluginError('file-account-changed', '账号已切换，本次发送已取消', false, 409)
    }
    const normalizedUid = recordUid.trim()
    const normalizedText = textContent.trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedUid)) {
      throw new ArkmePluginError('record-uid-invalid', '写入标识无效，请重试', false)
    }
    if (normalizedText === '') {
      throw new ArkmePluginError('record-text-empty', '请输入要发给自己的内容', false)
    }
    if (normalizedText.length > this.runtime.config.maxTextLength) {
      throw new ArkmePluginError(
        'record-text-too-long',
        `内容不能超过 ${this.runtime.config.maxTextLength} 个字符`,
        false,
      )
    }
    const now = Date.now()
    const recordDurationMillis = Math.max(0, Math.trunc(options.recordDurationMillis ?? 0))
    const captureContext = normalizedRecordCaptureContext(options.captureContext)
    const pending: ArkmePendingWrite = {
      recordUid: normalizedUid,
      textContent: normalizedText,
      createdAtMillis: now,
      sendAtMillis: now,
      attempts: 0,
      ...(recordDurationMillis === 0 ? {} : { recordDurationMillis }),
      ...(captureContext === undefined ? {} : { captureContext }),
    }
    await this.runtime.stateStore.putPending(session.userId, pending)
    return await this.sendPending(session, pending)
  }

  async createTextForConversation(
    recordUid: string,
    textContent: string,
    options: { expectedUserId?: number; recordDurationMillis?: number; captureContext?: ArkmeRecordCaptureContext } = {},
  ): Promise<ArkmeConversationWriteResult> {
    try {
      const result = await this.createText(recordUid, textContent, options)
      return { ...result, localState: 'synced' }
    } catch (error) {
      const session = await this.runtime.requireSession()
      if (options.expectedUserId !== undefined && options.expectedUserId !== session.userId) throw error
      const pending = (await this.runtime.stateStore.listPending(session.userId))
        .find(item => item.recordUid === recordUid)
      if (pending === undefined) throw error
      return {
        recordUid,
        status: 0,
        localState: 'failed',
        error: pending.lastError ?? safeFailureMessage(error),
      }
    }
  }

  async createDSHAgentInputText(
    recordUid: string,
    textContent: string,
    sendAtMillis: number,
  ): Promise<ArkmeCreateTextResult> {
    const session = await this.runtime.requireSession()
    const normalizedUid = recordUid.trim()
    const normalizedText = textContent.trim()
    const normalizedSendAt = Math.max(0, Math.trunc(sendAtMillis))
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedUid)) {
      throw new ArkmePluginError('record-uid-invalid', '写入标识无效，请重试', false)
    }
    if (normalizedText === '') {
      throw new ArkmePluginError('record-text-empty', '请输入要发给自己的内容', false)
    }
    if (normalizedText.length > this.runtime.config.maxTextLength) {
      throw new ArkmePluginError(
        'record-text-too-long',
        `内容不能超过 ${this.runtime.config.maxTextLength} 个字符`,
        false,
      )
    }
    const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/records/dsh-agent-input/create',
      {
        record_uid: normalizedUid,
        template_kind: 1,
        title: '',
        text_content: normalizedText,
        send_at: normalizedSendAt > 0 ? normalizedSendAt : Date.now(),
      },
      session,
      undefined,
      {
        scope: this.runtime.requestScope(session.userId),
        key: `dsh-agent-input:${normalizedUid}`,
      },
    )
    this.runtime.invalidateScope(this.runtime.requestScope(session.userId))
    return {
      recordUid: stringValue(data.record_uid) || normalizedUid,
      status: numberValue(data.status),
    }
  }

  async createFileAssetsForConversation(
    recordUid: string,
    textContent: string,
    assets: readonly ArkmeUploadedAsset[],
  ): Promise<ArkmeCreateFileAssetRecordResult> {
    const session = await this.runtime.requireSession()
    const normalizedUid = recordUid.trim()
    const normalizedText = textContent.trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedUid)) {
      throw new ArkmePluginError('record-uid-invalid', '写入标识无效，请重试', false)
    }
    if (assets.length === 0 || assets.length > 20 || normalizedText.length > this.runtime.config.maxTextLength) {
      throw new ArkmePluginError('record-file-assets-invalid', '附件内容为空、过长或数量超限', false)
    }
    for (const asset of assets) {
      if (!/^[A-Za-z0-9._:-]{8,256}$/.test(asset.fileAssetUid) || asset.fileName.trim() === ''
        || asset.fileName.length > 255 || !Number.isSafeInteger(asset.size) || asset.size <= 0
        || ![1, 2, 3, 4].includes(asset.fileKind)) {
        throw new ArkmePluginError('record-file-asset-invalid', '附件资产参数无效', false)
      }
    }
    const hashTags = arkmeHashTagPayload(normalizedText)
    const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/records/create',
      {
        record_uid: normalizedUid,
        template_kind: 2,
        display_kind: 0,
        title: '',
        text_content: normalizedText,
        content_payload: {
          payload_kind: 2,
          schema_version: 1,
          text_state: normalizedText === '' ? 3 : 1,
          ...(hashTags.length === 0 ? {} : { hash_tags: hashTags }),
          media_refs: assets.map((asset, index) => ({
            file_asset_uid: asset.fileAssetUid,
            content_file_role: 1,
            render_role: 1,
            sort_order: index,
            file_name: asset.fileName,
          })),
        },
        send_at: Date.now(),
      },
      session,
    )
    const result = {
      recordUid: stringValue(data.record_uid).trim() || normalizedUid,
      status: numberValue(data.status),
    }
    await this.syncCreatedRecordTags(result.recordUid, normalizedText, session.userId)
    return result
  }

  async createExtensionForConversation(
    parentRecordUid: string,
    recordUid: string,
    textContent: string,
    assets: readonly ArkmeUploadedAsset[] = [],
  ): Promise<ArkmeConversationWriteResult & { localState: 'synced' }> {
    const session = await this.runtime.requireSession()
    const normalizedParentUid = parentRecordUid.trim()
    const normalizedUid = recordUid.trim()
    const normalizedText = textContent.trim()
    if (normalizedParentUid === '' || normalizedParentUid === normalizedUid
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedUid)) {
      throw new ArkmePluginError('record-extension-identity-invalid', '延展记录标识无效，请重试', false)
    }
    if ((normalizedText === '' && assets.length === 0)
      || normalizedText.length > this.runtime.config.maxTextLength || assets.length > 20) {
      throw new ArkmePluginError('record-file-assets-invalid', '延展内容为空、过长或附件数量超限', false)
    }
    for (const asset of assets) {
      if (!/^[A-Za-z0-9._:-]{8,256}$/.test(asset.fileAssetUid) || asset.fileName.trim() === ''
        || asset.fileName.length > 255 || !Number.isSafeInteger(asset.size) || asset.size <= 0
        || ![1, 2, 3, 4].includes(asset.fileKind)) {
        throw new ArkmePluginError('record-file-asset-invalid', '附件资产参数无效', false)
      }
    }
    const hashTags = arkmeHashTagPayload(normalizedText)
    const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/records/extensions/create',
      {
        parent_record_uid: normalizedParentUid,
        record_uid: normalizedUid,
        template_kind: assets.length === 0 ? 1 : 2,
        title: '',
        text_content: normalizedText,
        content_payload: {
          payload_kind: assets.length === 0 ? 1 : 2,
          schema_version: 1,
          text_state: normalizedText === '' ? 3 : 1,
          ...(hashTags.length === 0 ? {} : { hash_tags: hashTags }),
          ...(assets.length === 0 ? {} : {
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
          }),
        },
        send_at: Date.now(),
      },
      session,
    )
    const createdRecordUid = stringValue(data.record_uid).trim() || normalizedUid
    const createdParentUid = stringValue(data.parent_record_uid).trim()
    const edgeUid = stringValue(data.edge_uid).trim()
    if (createdRecordUid !== normalizedUid || createdParentUid !== normalizedParentUid || edgeUid === '') {
      throw new ArkmePluginError('record-extension-response-invalid', '延展写入结果无效，请刷新后重试', true, 502)
    }
    await this.syncCreatedRecordTags(createdRecordUid, normalizedText, session.userId)
    return {
      recordUid: createdRecordUid,
      status: numberValue(data.record_status ?? data.status),
      localState: 'synced',
    }
  }

  async pendingWrites(): Promise<ArkmePendingWrite[]> {
    const session = await this.runtime.requireSession()
    return await this.runtime.stateStore.listPending(session.userId)
  }

  async retryPending(recordUid: string): Promise<ArkmeCreateTextResult> {
    const session = await this.runtime.requireSession()
    const pending = (await this.runtime.stateStore.listPending(session.userId))
      .find(item => item.recordUid === recordUid)
    if (pending === undefined) {
      throw new ArkmePluginError('outbox-entry-not-found', '待重试内容不存在', false, 404)
    }
    return await this.sendPending(session, pending)
  }

  private async sendPending(
    session: ArkmeSessionCredentials,
    pending: ArkmePendingWrite,
  ): Promise<ArkmeCreateTextResult> {
    try {
      const captureContext = pending.captureContext === undefined
        ? undefined
        : arkmeRecordCaptureContextPayload(pending.captureContext)
      const hashTags = arkmeHashTagPayload(pending.textContent)
      const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
        '/api/v1/records/create',
        {
          record_uid: pending.recordUid,
          template_kind: 1,
          title: '',
          text_content: pending.textContent,
          ...(Math.max(0, Math.trunc(pending.recordDurationMillis ?? 0)) === 0
            ? {}
            : { record_duration_millis: Math.max(0, Math.trunc(pending.recordDurationMillis ?? 0)) }),
          ...(captureContext === undefined || Object.keys(captureContext).length === 0
            ? {}
            : { capture_context: captureContext }),
          ...(hashTags.length === 0
            ? {}
            : { content_payload: { payload_kind: 1, schema_version: 1, text_state: 1, hash_tags: hashTags } }),
          send_at: pending.sendAtMillis,
        },
        session,
      )
      const result = {
        recordUid: stringValue(data.record_uid) || pending.recordUid,
        status: numberValue(data.status),
      }
      await this.syncCreatedRecordTags(result.recordUid, pending.textContent, session.userId)
      await this.runtime.stateStore.markSynced(session.userId, pending.recordUid, result.status)
      return result
    } catch (error) {
      await this.runtime.stateStore.markAttempt(session.userId, pending.recordUid, safeFailureMessage(error))
      throw error
    }
  }

  recordUid(raw: unknown): string {
    const item = objectValue(raw)
    return stringValue(item.record_uid ?? objectValue(item.record_core).record_uid).trim()
  }

  recordTimelineItem(item: ArkmeSelfRecordItem): ArkmeTimelineItem {
    return {
      itemUid: item.recordUid,
      senderName: '我',
      isMe: true,
      sendAtMillis: item.sendAtMillis,
      title: item.title,
      textContent: item.textContent,
      status: item.status,
      templateKind: item.templateKind,
      version: item.version,
      ...(item.displayKind === undefined ? {} : { displayKind: item.displayKind }),
      ...(item.contentBlocks === undefined ? {} : { contentBlocks: item.contentBlocks }),
      ...(item.forwardRecords === undefined ? {} : { forwardRecords: item.forwardRecords }),
      ...(item.extensionParentRecordUid === undefined ? {} : { extensionParentRecordUid: item.extensionParentRecordUid }),
      ...(item.extensionParent === undefined ? {} : { extensionParent: item.extensionParent }),
      ...(item.mediaUnavailable === true ? { mediaUnavailable: true } : {}),
    }
  }

  private recordExtensionProjection(
    raw: unknown,
    viewerUserId: number,
  ): Pick<ArkmeTimelineItem, 'extensionParentRecordUid' | 'extensionParent'> | undefined {
    const item = objectValue(raw)
    const core = objectValue(item.record_core)
    const edge = objectValue(item.extension_edge ?? core.extension_edge)
    const preview = objectValue(
      item.extension_parent_preview ?? item.extensionParentPreview
        ?? core.extension_parent_preview ?? core.extensionParentPreview,
    )
    const previewRecord = objectValue(preview.record ?? preview.record_core ?? preview.recordCore)
    const previewPayload = objectValue(previewRecord.payload)
    const parentRecordUid = stringValue(
      item.parent_record_uid ?? item.parentRecordUid
        ?? item.parent_extend_record_uid ?? item.parentExtendRecordUid
        ?? core.parent_record_uid ?? core.parentRecordUid
        ?? core.parent_extend_record_uid ?? core.parentExtendRecordUid
        ?? edge.parent_record_uid ?? edge.parentRecordUid,
    ).trim()
    if (parentRecordUid === '') return undefined
    const previewRecordUid = stringValue(
      previewRecord.record_uid ?? previewRecord.recordUid ?? previewPayload.record_uid ?? previewPayload.recordUid,
    ).trim()
    if (previewRecordUid === '' || previewRecordUid !== parentRecordUid) {
      return { extensionParentRecordUid: parentRecordUid }
    }
    return {
      extensionParentRecordUid: parentRecordUid,
      extensionParent: {
        itemUid: parentRecordUid,
        senderName: stringValue(
          previewRecord.nickname ?? previewRecord.nick_name
            ?? preview.nickname ?? preview.nick_name,
        ).trim() || '我',
        title: stringValue(previewRecord.title ?? previewPayload.title),
        textContent: stringValue(
          previewRecord.text_content ?? previewRecord.textContent
            ?? previewPayload.text_content ?? previewPayload.textContent,
        ),
        contentBlocks: this.media.richContentBlocks({ ...preview, record_core: previewRecord }, viewerUserId),
      },
    }
  }

  recordTimelineItemFromRaw(
    raw: unknown,
    userId: number,
    options: { displayItems?: unknown[]; mediaUnavailable?: boolean; selfTopic?: ArkmeTimelineItem['selfTopic']; isMe?: boolean } = {},
  ): ArkmeTimelineItem {
    const item = objectValue(raw)
    const core = objectValue(item.record_core)
    const extensionProjection = this.recordExtensionProjection(raw, userId)
    const forwardRecords = projectRecordRecordingForward(item.content_payload ?? core.content_payload)
    return {
      itemUid: stringValue(item.record_uid ?? core.record_uid).trim(),
      senderName: stringValue(item.nickname).trim() || '我',
      isMe: options.isMe ?? numberValue(item.creator_user_id ?? item.owner_user_id ?? core.creator_user_id ?? core.owner_user_id) === userId,
      sendAtMillis: numberValue(item.send_at ?? core.send_at),
      title: stringValue(item.title ?? core.title),
      textContent: stringValue(item.text_content ?? core.text_content),
      status: numberValue(item.status ?? core.status),
      templateKind: numberValue(item.template_kind ?? core.template_kind),
      displayKind: numberValue(item.display_kind ?? core.display_kind),
      version: numberValue(item.version ?? core.version),
      updateAtMillis: numberValue(item.update_at ?? core.update_at),
      recordDurationMillis: numberValue(item.record_duration_millis ?? core.record_duration_millis),
      editDurationMillis: numberValue(item.edit_duration_millis ?? core.edit_duration_millis),
      contentBlocks: this.media.richContentBlocks(raw, userId, options.displayItems),
      ...(forwardRecords === undefined ? {} : { forwardRecords }),
      ...(extensionProjection === undefined ? {} : extensionProjection),
      ...(options.selfTopic === undefined ? {} : { selfTopic: options.selfTopic }),
      ...(options.mediaUnavailable === true ? { mediaUnavailable: true } : {}),
    }
  }

  recordItem(
    raw: unknown,
    userId?: number,
    options: { displayItems?: unknown[]; mediaUnavailable?: boolean } = {},
  ): ArkmeSelfRecordItem | undefined {
    const item = objectValue(raw)
    const core = objectValue(item.record_core)
    const recordUid = stringValue(item.record_uid ?? core.record_uid).trim()
    if (recordUid === '') return undefined
    const extensionProjection = userId === undefined ? undefined : this.recordExtensionProjection(raw, userId)
    const forwardRecords = projectRecordRecordingForward(item.content_payload ?? core.content_payload)
    return {
      recordUid,
      sendAtMillis: numberValue(item.send_at ?? core.send_at),
      title: stringValue(core.title),
      textContent: stringValue(core.text_content),
      templateKind: numberValue(core.template_kind),
      status: numberValue(core.status),
      version: numberValue(core.version),
      creationSource: recordCreationSource(raw),
      displayKind: numberValue(item.display_kind ?? core.display_kind),
      ...(forwardRecords === undefined ? {} : { forwardRecords }),
      ...(userId === undefined ? {} : { contentBlocks: this.media.richContentBlocks(raw, userId, options.displayItems) }),
      ...(extensionProjection === undefined ? {} : extensionProjection),
      ...(options.mediaUnavailable === true ? { mediaUnavailable: true } : {}),
    }
  }

  isDSHAgentInput(raw: unknown): boolean {
    return isDSHAgentInputRecord(raw)
  }

  isPrivacyLocked(raw: unknown): boolean {
    return arkmePrivacyLockedRecord(raw)
  }

  async syncHistory(maxPages = 20, signal?: AbortSignal): Promise<{ pages: number; complete: boolean }> {
    const pageCap = Math.min(20, Math.max(1, Math.trunc(maxPages)))
    await this.refreshLatest()
    let snapshot = await this.cachedSnapshot()
    let pages = 0
    while (snapshot.hasMore && snapshot.nextCursor !== undefined && pages < pageCap) {
      if (signal?.aborted === true) throw new Error('Arkme历史同步已取消')
      await this.list(50, snapshot.nextCursor)
      pages += 1
      snapshot = await this.cachedSnapshot()
    }
    return { pages, complete: !snapshot.hasMore }
  }
}
