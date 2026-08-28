import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { ArkmeInterwovenBootstrap, ArkmeInterwovenDetail, ArkmeInterwovenMention } from '../types.js'
import { ProfileService } from './profile-service.js'
import type { ArkmeRelatedQuickNoteSourceLocator } from './related-quick-note-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'
import { SourceService, type ArkmeSourceRefPayload } from './source-service.js'

interface ArkmeInterwovenMomentReference {
  userId: number
  sourceOwnerRef: string
  sourceChatSessionUid: string
  recordOwnerUserId: number
  recordUid: string
  relationUid: string
  sequence: number
  momentId: string
  groupName: string
  senderUserId: number
  senderName: string
  senderAvatarRef?: string
  occurredAtMillis: number
  detailMode: 'chat' | 'owner_payload'
  fallbackTitle: string
  fallbackTextContent: string
  expiresAtMillis: number
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function booleanValue(value: unknown): boolean { return value === true }
function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

export class InterwovenService {
  private readonly momentReferences = new Map<string, ArkmeInterwovenMomentReference>()

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: SourceService,
    private readonly profile: ProfileService,
  ) {}

  dispose(): void {
    this.momentReferences.clear()
  }

  async interwovenMoments(
    sourceRef: string,
    signal?: AbortSignal,
  ): Promise<ArkmeInterwovenBootstrap> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'private_chat') {
      throw new ArkmePluginError('interwoven-source-invalid', '交织瞬间仅支持普通私聊', false, 400)
    }
    if (!this.runtime.config.interwovenMomentsEnabled) {
      return { state: 'disabled', moments: [], preparedAtMillis: Date.now() }
    }
    const gate = await this.runtime.authenticatedAuthPost<Record<string, unknown>>(
      '/api/v1/auth/able-func',
      { func_type: 12 },
      session,
      signal,
    )
    if (!booleanValue(gate.able)) {
      return { state: 'disabled', moments: [], preparedAtMillis: Date.now() }
    }
    const counterpartUserId = await this.assertHumanPrivateSource(source, session, signal)
    const legacyRmSubjectId = await this.resolveLegacyPrivateSubjectId(counterpartUserId, session, signal)
    let data: Record<string, unknown> | undefined
    if (legacyRmSubjectId > 0) {
      try {
        data = await this.runtime.authenticatedWorldPost<Record<string, unknown>>(
          '/api/v1/interwoven-moments/inline-bootstrap',
          { rm_subject_id: legacyRmSubjectId, force_refresh: true },
          session,
          signal,
        )
      } catch (error) {
        if (!this.isUnsupportedInterwovenWorldRoute(error)) throw error
      }
    }
    data ??= await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/interwoven/inline-bootstrap',
      { chat_session_uid: source.ownerRef, rm_subject_id: legacyRmSubjectId, limit: 100 },
      session,
      signal,
    )
    const preparedAtMillis = Math.max(0, Math.trunc(numberValue(data.prepared_at))) || Date.now()
    const descriptors: Array<{
      rawMomentId: string
      occurredAtMillis: number
      groupName: string
      senderUserId: number
      summary: string
      degraded: boolean
      sourceChatSessionUid: string
      recordOwnerUserId: number
      recordUid: string
      relationUid: string
      sequence: number
      detailMode: 'chat' | 'owner_payload'
      fallbackTitle: string
      fallbackTextContent: string
    }> = []
    let invalidItemCount = 0
    for (const rawGroup of listValue(data.groups)) {
      const group = objectValue(rawGroup)
      if (numberValue(group.moment_type) !== 1) continue
      const groupTitle = stringValue(group.group_title).trim() || '群聊'
      for (const rawItem of listValue(group.group_preview_items)) {
        const item = objectValue(rawItem)
        if (numberValue(item.moment_type) !== 1) continue
        const jumpTarget = objectValue(item.jump_target)
        const renderPayload = objectValue(item.render_payload)
        const groupName = stringValue(renderPayload.group_name ?? item.title).trim() || groupTitle
        const rawMomentId = stringValue(item.moment_id).trim()
        const occurredAtMillis = Math.trunc(numberValue(item.occurred_at))
        const sourceChatSessionUid = stringValue(jumpTarget.chat_session_uid).trim()
        const recordOwnerUserId = Math.trunc(numberValue(
          jumpTarget.record_owner_user_id ?? renderPayload.record_owner_user_id ?? renderPayload.sender_user_id,
        ))
        const recordUid = stringValue(jumpTarget.record_uid ?? renderPayload.record_uid).trim()
        const relationUid = stringValue(jumpTarget.rel_uid).trim()
        const sequence = Math.trunc(numberValue(jumpTarget.seq))
        const senderUserId = Math.trunc(numberValue(renderPayload.sender_user_id))
        const hasChatDetailLocator = sourceChatSessionUid !== '' && recordOwnerUserId > 0
          && recordUid !== '' && relationUid !== '' && sequence > 0
        const fallbackTextContent = stringValue(
          renderPayload.content ?? renderPayload.mention_text ?? item.summary,
        ).trim().slice(0, 20_000)
        const fallbackTitle = stringValue(item.title ?? renderPayload.group_name).trim().slice(0, 500)
        if (rawMomentId === '' || !Number.isSafeInteger(occurredAtMillis) || occurredAtMillis <= 0
          || occurredAtMillis > 8_640_000_000_000_000
          || !Number.isSafeInteger(recordOwnerUserId) || recordOwnerUserId <= 0
          || recordUid === ''
          || !Number.isSafeInteger(senderUserId) || senderUserId <= 0) {
          invalidItemCount += 1
          continue
        }
        descriptors.push({
          rawMomentId,
          occurredAtMillis,
          groupName,
          senderUserId,
          summary: stringValue(renderPayload.content ?? item.summary).trim().slice(0, 1000),
          degraded: booleanValue(item.is_degraded),
          sourceChatSessionUid,
          recordOwnerUserId,
          recordUid,
          relationUid,
          sequence,
          detailMode: hasChatDetailLocator ? 'chat' : 'owner_payload',
          fallbackTitle,
          fallbackTextContent,
        })
      }
    }
    const profiles = await this.profile.interwovenProfilesByUserIds(
      descriptors.map(item => item.senderUserId), session, signal,
    ).catch(() => new Map<number, { displayName: string; hasAvatar: boolean }>())
    const moments: ArkmeInterwovenMention[] = []
    const seenMomentIds = new Set<string>()
    for (const descriptor of descriptors) {
      const momentId = await this.interwovenStableMomentId(descriptor.rawMomentId)
      if (seenMomentIds.has(momentId)) continue
      seenMomentIds.add(momentId)
      const profile = profiles.get(descriptor.senderUserId)
      const senderName = profile?.displayName
        || (descriptor.senderUserId === session.userId ? '我' : descriptor.senderUserId === counterpartUserId
          ? source.displayName : 'Arkme 用户')
      const senderAvatarRef = profile?.hasAvatar === true
        ? await this.profile.sealProfileImageRef(session.userId, descriptor.senderUserId)
        : undefined
      const reference: Omit<ArkmeInterwovenMomentReference, 'expiresAtMillis'> = {
        userId: session.userId,
        sourceOwnerRef: source.ownerRef,
        sourceChatSessionUid: descriptor.sourceChatSessionUid,
        recordOwnerUserId: descriptor.recordOwnerUserId,
        recordUid: descriptor.recordUid,
        relationUid: descriptor.relationUid,
        sequence: descriptor.sequence,
        momentId,
        groupName: descriptor.groupName,
        senderUserId: descriptor.senderUserId,
        senderName,
        ...(senderAvatarRef === undefined ? {} : { senderAvatarRef }),
        occurredAtMillis: descriptor.occurredAtMillis,
        detailMode: descriptor.detailMode,
        fallbackTitle: descriptor.fallbackTitle,
        fallbackTextContent: descriptor.fallbackTextContent,
      }
      moments.push({
        momentId,
        momentRef: await this.sealInterwovenMomentRef(reference),
        occurredAtMillis: descriptor.occurredAtMillis,
        groupName: descriptor.groupName,
        senderName,
        senderIsMe: descriptor.senderUserId === session.userId,
        ...(senderAvatarRef === undefined ? {} : { senderAvatarRef }),
        summary: descriptor.summary,
        degraded: descriptor.degraded,
      })
    }
    moments.sort((left, right) => left.occurredAtMillis - right.occurredAtMillis
      || left.momentId.localeCompare(right.momentId))
    const sourceStatusPartial = listValue(data.source_status).some(raw => {
      const status = objectValue(raw)
      return numberValue(status.moment_type) === 1 && numberValue(status.status) !== 1
    })
    if (moments.length === 0 && invalidItemCount === 0 && !sourceStatusPartial) {
      return { state: 'empty', moments, preparedAtMillis }
    }
    const partial = invalidItemCount > 0 || sourceStatusPartial || moments.some(moment => moment.degraded)
    return {
      state: partial ? 'partial' : 'success',
      moments,
      preparedAtMillis,
      ...(partial ? { message: '部分交织瞬间暂时不可用，可稍后重试' } : {}),
    }
  }

  async interwovenMomentDetail(
    sourceRef: string,
    momentRef: string,
    signal?: AbortSignal,
  ): Promise<ArkmeInterwovenDetail> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'private_chat') {
      throw new ArkmePluginError('interwoven-source-invalid', '交织瞬间仅支持普通私聊', false, 400)
    }
    const reference = await this.openInterwovenMomentRef(momentRef, session.userId, source.ownerRef)
    await this.assertInterwovenOperationAllowed(source, session, signal)
    if (reference.detailMode === 'owner_payload') {
      return {
        momentId: reference.momentId,
        groupName: reference.groupName,
        senderName: reference.senderName,
        senderIsMe: reference.senderUserId === session.userId,
        ...(reference.senderAvatarRef === undefined ? {} : { senderAvatarRef: reference.senderAvatarRef }),
        occurredAtMillis: reference.occurredAtMillis,
        title: reference.fallbackTitle || reference.groupName,
        textContent: reference.fallbackTextContent,
        status: 1,
        degraded: true,
      }
    }
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/records/detail',
      {
        chat_session_uid: reference.sourceChatSessionUid,
        record_owner_user_id: reference.recordOwnerUserId,
        record_uid: reference.recordUid,
        rel_uid: reference.relationUid,
        seq: reference.sequence,
      },
      session,
      signal,
    )
    const item = objectValue(data.item)
    const relation = objectValue(item.relation)
    const record = objectValue(item.record)
    const payload = objectValue(record.payload)
    if (stringValue(data.chat_session_uid).trim() !== reference.sourceChatSessionUid
      || stringValue(relation.chat_session_uid).trim() !== reference.sourceChatSessionUid
      || numberValue(relation.record_owner_user_id) !== reference.recordOwnerUserId
      || stringValue(relation.record_uid).trim() !== reference.recordUid
      || stringValue(relation.rel_uid).trim() !== reference.relationUid
      || numberValue(relation.seq) !== reference.sequence) {
      throw new ArkmePluginError(
        'interwoven-detail-contract-invalid', '快记详情响应与所选交织瞬间不一致', true, 502,
      )
    }
    const status = Math.trunc(numberValue(record.status))
    const title = stringValue(payload.title).trim() || reference.groupName
    const textContent = stringValue(payload.text_content).trim()
    return {
      momentId: reference.momentId,
      groupName: reference.groupName,
      senderName: reference.senderName,
      senderIsMe: reference.senderUserId === session.userId,
      ...(reference.senderAvatarRef === undefined ? {} : { senderAvatarRef: reference.senderAvatarRef }),
      occurredAtMillis: reference.occurredAtMillis,
      title,
      textContent,
      status,
      degraded: status !== 1 || textContent === '',
    }
  }

  async relatedQuickNoteLocator(
    sourceRef: string,
    momentRef: string,
    signal?: AbortSignal,
  ): Promise<ArkmeRelatedQuickNoteSourceLocator> {
    const session = await this.runtime.requireSession()
    const normalizedSourceRef = sourceRef.trim()
    const source = await this.source.openSourceRef(normalizedSourceRef, session.userId)
    if (source.kind !== 'private_chat') {
      throw new ArkmePluginError('interwoven-source-invalid', '交织瞬间仅支持普通私聊', false, 400)
    }
    const reference = await this.openInterwovenMomentRef(momentRef, session.userId, source.ownerRef)
    await this.assertInterwovenOperationAllowed(source, session, signal)
    return {
      viewerUserId: session.userId,
      sourceRef: normalizedSourceRef,
      sourceOwnerRef: source.ownerRef,
      contextType: reference.sourceChatSessionUid === '' ? 'record' : 'chat',
      recordUid: reference.recordUid,
      recordOwnerUserId: reference.recordOwnerUserId,
      chatSessionUid: reference.sourceChatSessionUid,
    }
  }

  private async assertInterwovenOperationAllowed(
    source: ArkmeSourceRefPayload,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<void> {
    if (source.kind !== 'private_chat') {
      throw new ArkmePluginError('interwoven-source-invalid', '交织瞬间仅支持普通私聊', false, 400)
    }
    if (!this.runtime.config.interwovenMomentsEnabled) {
      throw new ArkmePluginError('interwoven-disabled', '交织瞬间能力当前未开启', false, 403)
    }
    const gate = await this.runtime.authenticatedAuthPost<Record<string, unknown>>(
      '/api/v1/auth/able-func', { func_type: 12 }, session, signal,
    )
    if (!booleanValue(gate.able)) {
      throw new ArkmePluginError('interwoven-disabled', '交织瞬间能力当前未开放', false, 403)
    }
    await this.assertHumanPrivateSource(source, session, signal)
  }

  private async assertHumanPrivateSource(
    source: ArkmeSourceRefPayload,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<number> {
    const detail = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/detail', { chat_session_uid: source.ownerRef }, session, signal,
    )
    const chatSession = objectValue(detail.session)
    const counterpart = objectValue(detail.private_counterpart)
    const counterpartUserId = Math.trunc(numberValue(counterpart.user_id))
    if (stringValue(chatSession.chat_session_uid).trim() !== source.ownerRef
      || numberValue(chatSession.session_kind) !== 1
      || !Number.isSafeInteger(counterpartUserId) || counterpartUserId <= 0
      || counterpartUserId === session.userId) {
      throw new ArkmePluginError('interwoven-source-invalid', '交织瞬间仅支持有效的双人私聊', false, 409)
    }
    return counterpartUserId
  }

  private async resolveLegacyPrivateSubjectId(
    counterpartUserId: number,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<number> {
    const data = await this.runtime.authenticatedSubjectPost<Record<string, unknown>>(
      '/api/v1/private/check-contact-chat',
      { target_user_id: counterpartUserId },
      session,
      signal,
    )
    if (!booleanValue(data.exist)) return 0
    const rmSubjectId = Math.trunc(numberValue(data.rm_subject_id))
    if (!Number.isSafeInteger(rmSubjectId) || rmSubjectId <= 0) {
      throw new ArkmePluginError(
        'interwoven-subject-contract-invalid',
        '私聊交织主题定位响应不完整',
        true,
        502,
      )
    }
    return rmSubjectId
  }

  private isUnsupportedInterwovenWorldRoute(error: unknown): boolean {
    return error instanceof ArkmePluginError
      && ((error.code === 'arkme-http-error' && error.upstreamStatus === 404)
        || error.code === 'arkme-code-404')
  }

  private async interwovenStableMomentId(rawMomentId: string): Promise<string> {
    return `arkme-moment-${createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(`interwoven:${rawMomentId}`).digest('base64url').slice(0, 32)}`
  }

  private async sealInterwovenMomentRef(
    reference: Omit<ArkmeInterwovenMomentReference, 'expiresAtMillis'>,
  ): Promise<string> {
    const now = Date.now()
    for (const [key, value] of this.momentReferences) {
      if (value.expiresAtMillis <= now) this.momentReferences.delete(key)
    }
    while (this.momentReferences.size >= 1000) {
      const oldest = this.momentReferences.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.momentReferences.delete(oldest)
    }
    const nonce = randomUUID()
    const signature = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(nonce).digest('base64url')
    this.momentReferences.set(nonce, { ...reference, expiresAtMillis: now + 12 * 60 * 60 * 1000 })
    return `arkme-moment-v1.${nonce}.${signature}`
  }

  private async openInterwovenMomentRef(
    momentRef: string,
    expectedUserId: number,
    expectedSourceOwnerRef: string,
  ): Promise<ArkmeInterwovenMomentReference> {
    const parts = momentRef.trim().split('.')
    if (parts.length !== 3 || parts[0] !== 'arkme-moment-v1') {
      throw new ArkmePluginError('interwoven-ref-invalid', '交织瞬间引用无效，请刷新会话后重试', false, 400)
    }
    const nonce = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(nonce).digest()
    if (nonce === '' || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ArkmePluginError('interwoven-ref-invalid', '交织瞬间引用无效，请刷新会话后重试', false, 400)
    }
    const reference = this.momentReferences.get(nonce)
    if (reference === undefined || reference.expiresAtMillis <= Date.now()) {
      this.momentReferences.delete(nonce)
      throw new ArkmePluginError('interwoven-ref-expired', '交织瞬间引用已过期，请刷新会话后重试', true, 410)
    }
    if (reference.userId !== expectedUserId || reference.sourceOwnerRef !== expectedSourceOwnerRef) {
      throw new ArkmePluginError('interwoven-ref-invalid', '交织瞬间引用与当前会话不匹配', false, 403)
    }
    return reference
  }
}
