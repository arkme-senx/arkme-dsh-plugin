import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeRelatedQuickNoteDetail,
  ArkmeRelatedQuickNoteItem,
  ArkmeRelatedQuickNoteList,
} from '../types.js'
import { MediaService } from './media-service.js'
import { ProfileService } from './profile-service.js'
import { ArkmePrivacyVisibilityService, arkmePrivacyLockedRecord } from './privacy-visibility.js'
import { RecordService } from './record-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

const RELATED_QUICK_NOTE_LIMIT = 20
const RELATED_QUICK_NOTE_REF_TTL_MS = 12 * 60 * 60 * 1000
const RELATED_QUICK_NOTE_REF_CAP = 1000

export interface ArkmeRelatedQuickNoteSourceLocator {
  viewerUserId: number
  sourceRef: string
  sourceOwnerRef: string
  contextType: 'record' | 'chat'
  recordUid: string
  recordOwnerUserId: number
  chatSessionUid: string
}

interface ArkmeRelatedQuickNoteReference {
  viewerUserId: number
  sourceRef: string
  sourceOwnerRef: string
  recordUid: string
  recordOwnerUserId: number
  senderName: string
  senderAvatarRef?: string
  expiresAtMillis: number
}

interface RelatedQuickNoteDescriptor {
  recordUid: string
  recordOwnerUserId: number
  authorUserId: number
  senderName: string
  sendAtMillis: number
  title: string
  textPreview: string
  sourceLabel?: string
}

interface RelatedQuickNoteCandidate {
  uid: string
  raw: unknown
}

interface RelatedQuickNotePrivacyReader {
  lockedRecordUids(
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ReadonlySet<string>>
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function firstString(item: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = stringValue(item[key]).trim()
    if (value !== '') return value
  }
  return ''
}

function firstPositiveInteger(item: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = Math.trunc(numberValue(item[key]))
    if (Number.isSafeInteger(value) && value > 0) return value
  }
  return 0
}

function recordCore(raw: unknown): Record<string, unknown> {
  const item = objectValue(raw)
  return objectValue(item.record_core ?? item.recordCore)
}

function recordUid(raw: unknown): string {
  const item = objectValue(raw)
  const core = recordCore(raw)
  return firstString(item, ['record_uid', 'recordUid', 'uid', 'target_record_uid', 'targetRecordUid'])
    || firstString(core, ['record_uid', 'recordUid', 'uid'])
}

function recordOwnerUserId(raw: unknown): number {
  const item = objectValue(raw)
  const core = recordCore(raw)
  return firstPositiveInteger(item, [
    'record_owner_user_id', 'recordOwnerUserId', 'owner_user_id', 'ownerUserId',
  ]) || firstPositiveInteger(core, [
    'record_owner_user_id', 'recordOwnerUserId', 'owner_user_id', 'ownerUserId',
  ])
}

function matchesRecordIdentity(raw: unknown, expectedUid: string, expectedOwnerUserId: number): boolean {
  const uidKeys = ['record_uid', 'recordUid', 'uid', 'target_record_uid', 'targetRecordUid'] as const
  const ownerKeys = ['record_owner_user_id', 'recordOwnerUserId', 'owner_user_id', 'ownerUserId'] as const
  const identities = [objectValue(raw), recordCore(raw)]
  const uids = identities.flatMap(item => uidKeys
    .map(key => stringValue(item[key]).trim())
    .filter(value => value !== ''))
  const ownerUserIds = identities.flatMap(item => ownerKeys
    .map(key => Math.trunc(numberValue(item[key])))
    .filter(value => Number.isSafeInteger(value) && value > 0))
  return uids.length > 0 && ownerUserIds.length > 0
    && uids.every(value => value === expectedUid)
    && ownerUserIds.every(value => value === expectedOwnerUserId)
}

function millisValue(value: unknown): number {
  const parsed = Math.trunc(numberValue(value))
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return 0
  return parsed > 100_000_000_000 ? parsed : parsed * 1000
}

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function descriptorFromRaw(raw: unknown): RelatedQuickNoteDescriptor | undefined {
  const item = objectValue(raw)
  const core = recordCore(raw)
  const uid = recordUid(raw)
  const ownerUserId = recordOwnerUserId(raw)
  if (uid === '' || ownerUserId <= 0) return undefined
  const authorUserId = firstPositiveInteger(item, [
    'author_user_id', 'authorUserId', 'creator_user_id', 'creatorUserId',
  ]) || firstPositiveInteger(core, ['creator_user_id', 'creatorUserId']) || ownerUserId
  const senderName = firstString(item, [
    'author_name', 'authorName', 'author_nickname', 'authorNickname',
    'sender_name', 'senderName', 'nickname', 'nick_name',
  ])
  const title = firstString(item, ['title']) || firstString(core, ['title'])
  const textPreview = firstString(item, [
    'text_preview', 'textPreview', 'text', 'content', 'text_content', 'textContent',
  ]) || firstString(core, ['text_content', 'textContent'])
  const sendAtMillis = millisValue(
    item.send_at ?? item.sendAt ?? core.send_at ?? core.sendAt,
  )
  const sourceLabel = firstString(item, ['source_label', 'sourceLabel'])
  return {
    recordUid: uid,
    recordOwnerUserId: ownerUserId,
    authorUserId,
    senderName: senderName.slice(0, 200),
    sendAtMillis,
    title: title.slice(0, 500),
    textPreview: textPreview.slice(0, 2000),
    ...(sourceLabel === '' ? {} : { sourceLabel: sourceLabel.slice(0, 200) }),
  }
}

export class RelatedQuickNoteService {
  private readonly references = new Map<string, ArkmeRelatedQuickNoteReference>()

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly record: RecordService,
    private readonly media: MediaService,
    private readonly profile: ProfileService,
    private readonly privacy: RelatedQuickNotePrivacyReader = new ArkmePrivacyVisibilityService(runtime),
  ) {}

  dispose(): void {
    this.references.clear()
  }

  async list(
    locator: ArkmeRelatedQuickNoteSourceLocator,
    signal?: AbortSignal,
  ): Promise<ArkmeRelatedQuickNoteList> {
    const session = await this.runtime.requireSession()
    const source = this.validLocator(locator, session.userId)
    const response = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/records/related/query',
      {
        record_uid: source.recordUid,
        record_owner_user_id: source.recordOwnerUserId,
        context_type: source.contextType,
        ...(source.contextType === 'chat' ? { chat_session_uid: source.chatSessionUid } : {}),
        limit: RELATED_QUICK_NOTE_LIMIT,
      },
      session,
      signal,
    )
    const excluded = new Set([source.recordUid])
    const lockedRecordUids = await this.privacy.lockedRecordUids(session, signal)
    const directItems = listValue(response.items ?? response.records)
    const candidates = this.relatedCandidates(response, directItems, excluded, lockedRecordUids)
    const missingUids = candidates
      .filter(candidate => descriptorFromRaw(candidate.raw) === undefined)
      .map(candidate => candidate.uid)
    const hydratedByUid = new Map<string, unknown>()
    if (missingUids.length > 0) {
      const batch = await this.runtime.authenticatedDataPost<Record<string, unknown>>(
        '/api/v1/memo/batch-get-records',
        { record_uids: missingUids },
        session,
        signal,
      )
      for (const raw of listValue(batch.items)) {
        const uid = recordUid(raw)
        if (uid !== '' && !hydratedByUid.has(uid)) hydratedByUid.set(uid, raw)
      }
    }
    const descriptors = this.descriptorsFromItems(
      candidates.flatMap(candidate => descriptorFromRaw(candidate.raw) === undefined
        ? (hydratedByUid.has(candidate.uid) ? [hydratedByUid.get(candidate.uid)] : [])
        : [candidate.raw]),
      excluded,
      lockedRecordUids,
    )
    const profiles = await this.profile.publicProfileSummariesByUserIds(
      descriptors.map(item => item.authorUserId),
      session,
      signal,
    ).catch(() => new Map())
    const items: ArkmeRelatedQuickNoteItem[] = []
    for (const descriptor of descriptors) {
      const profile = profiles.get(descriptor.authorUserId)
      const senderName = descriptor.senderName || profile?.displayName
        || (descriptor.authorUserId === session.userId ? '我' : 'Arkme 用户')
      const senderAvatarRef = profile?.avatarUrl === undefined
        ? undefined
        : await this.profile.sealProfileImageRef(session.userId, descriptor.authorUserId)
      const relatedRef = await this.sealReference({
        viewerUserId: session.userId,
        sourceRef: source.sourceRef,
        sourceOwnerRef: source.sourceOwnerRef,
        recordUid: descriptor.recordUid,
        recordOwnerUserId: descriptor.recordOwnerUserId,
        senderName,
        ...(senderAvatarRef === undefined ? {} : { senderAvatarRef }),
      })
      items.push({
        relatedRef,
        senderName,
        ...(senderAvatarRef === undefined ? {} : { senderAvatarRef }),
        sendAtMillis: descriptor.sendAtMillis,
        title: descriptor.title,
        textPreview: descriptor.textPreview,
        ...(descriptor.sourceLabel === undefined ? {} : { sourceLabel: descriptor.sourceLabel }),
      })
    }
    return { items, total: items.length }
  }

  async detail(
    sourceRef: string,
    relatedRef: string,
    signal?: AbortSignal,
  ): Promise<ArkmeRelatedQuickNoteDetail> {
    const session = await this.runtime.requireSession()
    const reference = await this.openReference(relatedRef, session.userId, sourceRef.trim())
    const raw = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/records/detail',
      { record_uid: reference.recordUid },
      session,
      signal,
    )
    if (!matchesRecordIdentity(raw, reference.recordUid, reference.recordOwnerUserId)) {
      throw new ArkmePluginError(
        'related-quick-note-detail-contract-invalid',
        '相关快记详情响应与所选快记不一致',
        true,
        502,
      )
    }
    const lockedRecordUids = await this.privacy.lockedRecordUids(session, signal)
    if (arkmePrivacyLockedRecord(raw) || lockedRecordUids.has(reference.recordUid)) {
      throw new ArkmePluginError('related-quick-note-private', '该相关快记不可查看', false, 403)
    }
    const hydrated = await this.media.hydrateRecordMediaPage([raw], session, signal)
    const displayItems = hydrated.displayItemsByRecordUid.get(reference.recordUid)
    const mediaUnavailable = hydrated.unavailableRecordUids.has(reference.recordUid)
    const detail = this.record.recordTimelineItemFromRaw(raw, session.userId, {
      ...(displayItems === undefined ? {} : { displayItems }),
      ...(mediaUnavailable ? { mediaUnavailable: true } : {}),
      isMe: reference.recordOwnerUserId === session.userId,
    })
    if (detail.itemUid !== reference.recordUid) {
      throw new ArkmePluginError(
        'related-quick-note-detail-contract-invalid',
        '相关快记详情标识无效',
        true,
        502,
      )
    }
    return {
      relatedRef,
      senderName: reference.senderName,
      ...(reference.senderAvatarRef === undefined ? {} : { avatarRef: reference.senderAvatarRef }),
      isMe: reference.recordOwnerUserId === session.userId,
      sendAtMillis: detail.sendAtMillis,
      title: detail.title,
      textContent: detail.textContent,
      status: detail.status,
      ...(detail.recordVersion === undefined ? {} : { recordVersion: detail.recordVersion }),
      ...(detail.aiPolish === undefined ? {} : { aiPolish: detail.aiPolish }),
      ...(detail.templateKind === undefined ? {} : { templateKind: detail.templateKind }),
      ...(detail.displayKind === undefined ? {} : { displayKind: detail.displayKind }),
      ...(detail.version === undefined ? {} : { version: detail.version }),
      ...(detail.updateAtMillis === undefined ? {} : { updateAtMillis: detail.updateAtMillis }),
      ...(detail.recordDurationMillis === undefined ? {} : { recordDurationMillis: detail.recordDurationMillis }),
      ...(detail.editDurationMillis === undefined ? {} : { editDurationMillis: detail.editDurationMillis }),
      ...(detail.contentBlocks === undefined ? {} : { contentBlocks: detail.contentBlocks }),
      ...(detail.mediaUnavailable === undefined ? {} : { mediaUnavailable: detail.mediaUnavailable }),
      ...(detail.forwardRecords === undefined ? {} : { forwardRecords: detail.forwardRecords }),
    }
  }

  private validLocator(
    locator: ArkmeRelatedQuickNoteSourceLocator,
    expectedViewerUserId: number,
  ): ArkmeRelatedQuickNoteSourceLocator {
    const sourceRef = locator.sourceRef.trim()
    const sourceOwnerRef = locator.sourceOwnerRef.trim()
    const recordUidValue = locator.recordUid.trim()
    const chatSessionUid = locator.chatSessionUid.trim()
    if (locator.viewerUserId !== expectedViewerUserId || sourceRef === '' || sourceOwnerRef === ''
      || recordUidValue === '' || !Number.isSafeInteger(locator.recordOwnerUserId)
      || locator.recordOwnerUserId <= 0 || (locator.contextType !== 'record' && locator.contextType !== 'chat')
      || (locator.contextType === 'chat' && chatSessionUid === '')) {
      throw new ArkmePluginError('related-quick-note-source-invalid', '当前快记来源无效，请刷新后重试', false, 400)
    }
    return {
      ...locator,
      sourceRef,
      sourceOwnerRef,
      recordUid: recordUidValue,
      chatSessionUid: locator.contextType === 'chat' ? chatSessionUid : '',
    }
  }

  private descriptorsFromItems(
    rawItems: unknown[],
    excluded: ReadonlySet<string>,
    lockedRecordUids: ReadonlySet<string>,
  ): RelatedQuickNoteDescriptor[] {
    const seen = new Set<string>()
    const result: RelatedQuickNoteDescriptor[] = []
    for (const raw of rawItems) {
      if (result.length >= RELATED_QUICK_NOTE_LIMIT || arkmePrivacyLockedRecord(raw)) continue
      const descriptor = descriptorFromRaw(raw)
      if (descriptor === undefined || excluded.has(descriptor.recordUid)
        || lockedRecordUids.has(descriptor.recordUid) || seen.has(descriptor.recordUid)) continue
      seen.add(descriptor.recordUid)
      result.push(descriptor)
    }
    return result
  }

  private relatedCandidates(
    response: Record<string, unknown>,
    directItems: unknown[],
    excluded: ReadonlySet<string>,
    lockedRecordUids: ReadonlySet<string>,
  ): RelatedQuickNoteCandidate[] {
    const rawItems = [
      ...directItems,
      ...listValue(response.similarLs ?? response.similar_ls ?? response.similarRecords ?? response.similar_records),
    ]
    const blocked = new Set(lockedRecordUids)
    for (const raw of rawItems) {
      if (!arkmePrivacyLockedRecord(raw)) continue
      const uid = typeof raw === 'string' ? raw.trim() : recordUid(raw)
      if (uid !== '') blocked.add(uid)
    }
    const result: RelatedQuickNoteCandidate[] = []
    const seen = new Set<string>()
    for (const raw of rawItems) {
      const uid = typeof raw === 'string' ? raw.trim() : recordUid(raw)
      if (uid === '' || excluded.has(uid) || blocked.has(uid)
        || seen.has(uid) || arkmePrivacyLockedRecord(raw)) continue
      seen.add(uid)
      result.push({ uid, raw })
      if (result.length >= RELATED_QUICK_NOTE_LIMIT) break
    }
    return result
  }

  private async sealReference(
    reference: Omit<ArkmeRelatedQuickNoteReference, 'expiresAtMillis'>,
  ): Promise<string> {
    const now = Date.now()
    for (const [key, value] of this.references) {
      if (value.expiresAtMillis <= now) this.references.delete(key)
    }
    while (this.references.size >= RELATED_QUICK_NOTE_REF_CAP) {
      const oldest = this.references.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.references.delete(oldest)
    }
    const nonce = randomUUID()
    const signature = createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(nonce).digest('base64url')
    this.references.set(nonce, {
      ...reference,
      expiresAtMillis: now + RELATED_QUICK_NOTE_REF_TTL_MS,
    })
    return `arkme-related-quick-note-v1.${nonce}.${signature}`
  }

  private async openReference(
    relatedRef: string,
    expectedViewerUserId: number,
    expectedSourceRef: string,
  ): Promise<ArkmeRelatedQuickNoteReference> {
    const parts = relatedRef.trim().split('.')
    if (parts.length !== 3 || parts[0] !== 'arkme-related-quick-note-v1') {
      throw this.invalidReference()
    }
    const nonce = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(nonce).digest()
    if (nonce === '' || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw this.invalidReference()
    }
    const reference = this.references.get(nonce)
    if (reference === undefined || reference.expiresAtMillis <= Date.now()) {
      this.references.delete(nonce)
      throw new ArkmePluginError(
        'related-quick-note-ref-expired',
        '相关快记引用已过期，请刷新后重试',
        true,
        410,
      )
    }
    if (reference.viewerUserId !== expectedViewerUserId || reference.sourceRef !== expectedSourceRef) {
      throw this.invalidReference()
    }
    return reference
  }

  private invalidReference(): ArkmePluginError {
    return new ArkmePluginError(
      'related-quick-note-ref-invalid',
      '相关快记引用无效，请刷新后重试',
      false,
      403,
    )
  }
}
