import { TimelineTokenCodec } from './timeline-token.js'
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { ArkmePrivateInteraction, ArkmePrivateInteractionCoverage, ArkmePrivateInteractionSummary, ArkmePrivateInteractionPage, ArkmePrivateInteractionDirectoryPage, ArkmePrivateInteractionQueryOptions } from '../types.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { ArkmeInterwovenBootstrap, ArkmeInterwovenDetail, ArkmeInterwovenMention, ArkmeInterwovenReadReceipt, ArkmeInterwovenReadReceiptList } from '../types.js'
import { ProfileService } from './profile-service.js'
import type { ArkmeRelatedQuickNoteSourceLocator } from './related-quick-note-service.js'
import { ArkmePluginError, ArkmeUpstreamResponseError, ServiceRuntime, objectValue, stringValue } from './service.js'
import { SourceService, arkmeChatConversationPreview, type ArkmeSourceRefPayload } from './source-service.js'

interface ArkmeInterwovenMomentReference {
  userId: number
  sourceOwnerRef: string
  sourceChatSessionUid: string
  legacyGroupUid?: string
  receiptSequence?: number
  receiptRecordUid?: string
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
  private interactionEpoch = 0
  private readonly momentReferences = new Map<string, ArkmeInterwovenMomentReference>()

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: SourceService,
    private readonly profile: ProfileService,
  ) {}

  dispose(): void {
    this.interactionEpoch += 1
    this.momentReferences.clear()
  }

  async privateInteractionSummary(sourceRef: string, options: Pick<ArkmePrivateInteractionQueryOptions, 'expectedVersion' | 'signal'> = {}): Promise<ArkmePrivateInteractionSummary> {
    if (sourceRef.trim() === '') throw new ArkmePluginError('interaction-source-invalid', '请选择一个私聊联系人', false, 400)
    const { data, userId, epoch } = await this.readPrivateInteractions('contacts/summary', { ...options, sourceRef })
    const result: ArkmePrivateInteractionSummary = {
      ...this.interactionCoverage(data),
      unreadCount: this.interactionCount(data.unread_count),
      attentionCount: this.interactionCount(data.attention_count),
      ...(data.latest === undefined ? {} : { latest: await this.projectInteraction(data.latest, userId) }),
    }
    await this.assertInteractionAccount(userId, epoch, options.signal)
    return result
  }

  async queryPrivateInteractions(options: ArkmePrivateInteractionQueryOptions = {}): Promise<ArkmePrivateInteractionPage> {
    const { data, userId, epoch } = await this.readPrivateInteractions('occurrences/query', options)
    if (!Array.isArray(data.items) || data.items.length > (options.limit ?? 30) || typeof data.has_more !== 'boolean'
      || (data.has_more && (typeof data.next_cursor !== 'string' || data.next_cursor.length === 0 || data.next_cursor.length > 2048))) {
      throw new ArkmePluginError('interaction-contract-invalid', '互动分页返回不完整，请重新查询', true)
    }
    const items: ArkmePrivateInteraction[] = []
    for (const item of data.items) items.push(await this.projectInteraction(item, userId))
    await this.assertInteractionAccount(userId, epoch, options.signal)
    return {
      ...this.interactionCoverage(data), items, hasMore: data.has_more,
      ...(data.has_more ? { nextCursor: data.next_cursor as string } : {}),
    }
  }

  async privateInteractionDirectory(options: Pick<ArkmePrivateInteractionQueryOptions, 'limit' | 'cursor' | 'expectedVersion' | 'signal'> = {}): Promise<ArkmePrivateInteractionDirectoryPage> {
    const { data, userId, epoch, session } = await this.readPrivateInteractions('directory/query', options)
    const coverage = this.interactionCoverage(data)
    if (!Array.isArray(data.items) || data.items.length > (options.limit ?? 30) || typeof data.has_more !== 'boolean'
      || (data.has_more && (typeof data.next_cursor !== 'string' || !data.next_cursor || data.next_cursor.length > 2048))) {
      throw new ArkmePluginError('interaction-contract-invalid', '互动目录返回不完整，请重试', true)
    }
    const items: ArkmePrivateInteractionDirectoryPage['items'] = []
    for (const raw of data.items) {
      options.signal?.throwIfAborted()
      const bundle = objectValue(raw)
      const row = await this.source.chatSourceFromBundle(bundle, session, undefined, [])
      if (row.kind === 'private_chat' && row.peerUserId !== undefined) {
        row.avatarRef = await this.profile.sealProfileImageRef(userId, row.peerUserId)
      }
      // Keep the direct message facts separate. The Browser compares them with
      // live direct-message deltas, so an older directory cannot replace a new DM.
      row.latestPreview = arkmeChatConversationPreview(objectValue(objectValue(bundle.latest_preview).record), userId)
      const summary = objectValue(bundle.interaction)
      if (row.kind === 'private_chat' && summary.latest !== undefined && summary.latest !== null) {
        const latest = await this.projectInteraction(summary.latest, userId)
        if (latest.privateSourceKey !== row.sourceKey) throw new ArkmePluginError('interaction-contract-invalid', '互动联系人与会话不匹配', true)
        row.privateInteraction = {
          latest, version: coverage.version,
          unreadCount: this.interactionCount(summary.unread_count),
          attentionCount: this.interactionCount(summary.attention_count),
        }
        if (bundle.latest_display_source === 'group_interaction') {
          const sender = latest.senderIsMe ? '我' : row.displayName
          row.latestPreview = `${latest.groupName} · ${sender}：${latest.summary.replace(/\s+/gu, ' ').trim()}`
        }
      }
      items.push(row)
    }
    await this.assertInteractionAccount(userId, epoch, options.signal)
    return { ...coverage, items, hasMore: data.has_more, ...(data.has_more ? { nextCursor: data.next_cursor as string } : {}) }
  }

  private async assertInteractionAccount(userId: number, epoch: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const session = await this.runtime.requireSession()
    signal?.throwIfAborted()
    if (epoch !== this.interactionEpoch || session.userId !== userId) {
      throw new ArkmePluginError('interaction-account-changed', '账号已切换，请重新查询互动', true)
    }
  }

  private async readPrivateInteractions(route: string, options: ArkmePrivateInteractionQueryOptions) {
    const epoch = this.interactionEpoch
    const session = await this.runtime.requireSession()
    if (!this.runtime.config.interwovenMomentsEnabled) throw new ArkmePluginError('interaction-disabled', '群互动能力已关闭', false, 403)
    const limit = options.limit ?? 30
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > (route === 'directory/query' ? 100 : 50) || (options.cursor?.length ?? 0) > 2048
      || (options.expectedVersion !== undefined && !/^[a-f0-9]{64}$/.test(options.expectedVersion))) {
      throw new ArkmePluginError('interaction-input-invalid', '互动查询参数无效', false, 400)
    }
    const source = options.sourceRef === undefined ? undefined : await this.source.openSourceRef(options.sourceRef, session.userId)
    if (source !== undefined && source.kind !== 'private_chat') throw new ArkmePluginError('interaction-source-invalid', '群互动摘要需要普通私聊联系人', false, 400)
    let data: Record<string, unknown>
    try {
      data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        `/api/v1/chats/interwoven/${route}`,
        {
          ...(source === undefined ? {} : { chat_session_uid: source.ownerRef }),
          ...(route.endsWith('/query') ? { limit, ...(options.cursor === undefined ? {} : { cursor: options.cursor }) } : {}),
          ...(route === 'occurrences/query' ? { unread_only: options.unreadOnly ?? false } : {}),
          ...(options.expectedVersion === undefined ? {} : { expected_version: options.expectedVersion }),
        }, session, options.signal,
        { lane: 'interactive-read', bypassCache: true },
      )
    } catch (error) {
      const status = error instanceof ArkmeUpstreamResponseError ? stringValue(objectValue(error.responseData).status) : ''
      if (status === 'version_changed') throw new ArkmePluginError('interaction-version-changed', '互动或已读状态已变化，请从第一页重新查询', true, 409)
      if (status === 'capacity_exceeded') throw new ArkmePluginError('interaction-capacity-exceeded', '互动查询超过当前容量，结果不可视为完整，请缩小到指定联系人或升级后端查询能力', false, 409)
      if (error instanceof ArkmePluginError && error.upstreamStatus === 404) throw new ArkmePluginError('interaction-unsupported', '当前 Chat 后端尚未支持互动目录查询，请先升级后端', false, 501)
      throw error
    }
    await this.assertInteractionAccount(session.userId, epoch, options.signal)
    return { data, userId: session.userId, epoch, session }
  }

  private interactionCount(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new ArkmePluginError('interaction-contract-invalid', '互动计数不可用，不能视为零未读', true)
    }
    return value
  }

  private interactionCoverage(data: Record<string, unknown>): ArkmePrivateInteractionCoverage {
    if (data.source_scope !== 'chat_group_mentions' || data.scope_complete !== true
      || typeof data.version !== 'string' || !/^[a-f0-9]{64}$/.test(data.version)
      || !Array.isArray(data.uncovered_sources) || !data.uncovered_sources.every(item => typeof item === 'string')) {
      throw new ArkmePluginError('interaction-contract-invalid', '后端未提供完整的 Chat 互动范围，请检查服务版本或重试', true)
    }
    return { contractVersion: 1, version: data.version, sourceScope: 'chat_group_mentions', scopeComplete: true, uncoveredSources: data.uncovered_sources as string[] }
  }

  private async projectInteraction(raw: unknown, userId: number): Promise<ArkmePrivateInteraction> {
    const item = objectValue(raw)
    const privateUid = stringValue(item.private_chat_session_uid).trim()
    const groupUid = stringValue(item.source_chat_session_uid).trim()
    const id = stringValue(item.interaction_id)
    if (privateUid === '' || groupUid === '' || !/^[a-f0-9]{64}$/.test(id)
      || typeof item.summary !== 'string' || typeof item.sender_is_me !== 'boolean'
      || typeof item.unread !== 'boolean' || typeof item.attention !== 'boolean'
      || (item.sender_is_me && item.unread) || (item.attention && !item.unread)
      || this.interactionCount(item.seq) === 0 || this.interactionCount(item.occurred_at) === 0) {
      throw new ArkmePluginError('interaction-contract-invalid', '群互动来源或状态无效', true)
    }
    const peerName = stringValue(item.peer_name).slice(0, 256) || '联系人'
    const groupName = stringValue(item.group_name).slice(0, 256) || '群聊'
    return {
      interactionRef: id,
      privateSourceRef: await this.source.sealSourceRef(userId, 'private_chat', privateUid, peerName),
      privateSourceKey: await this.source.chatDirectorySourceKey(userId, privateUid),
      peerName,
      groupSourceRef: await this.source.sealSourceRef(userId, 'group_chat', groupUid, groupName),
      groupName, sequence: item.seq as number, occurredAtMillis: item.occurred_at as number,
      senderIsMe: item.sender_is_me, summary: item.summary.slice(0, 2000), unread: item.unread, attention: item.attention,
    }
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
    return await this.projectUnifiedGroups(data, source, session, counterpartUserId, signal)
  }

  /** Project already-authorized Chat payloads without starting an independent structure read. */
  async projectUnifiedGroups(
    data: Record<string, unknown>, source: ArkmeSourceRefPayload, session: ArkmeSessionCredentials,
    counterpartUserId = 0, signal?: AbortSignal,
  ): Promise<ArkmeInterwovenBootstrap> {
    const preparedAtMillis = Math.max(0, Math.trunc(numberValue(data.prepared_at))) || Date.now()
    const descriptors: Array<{
      rawMomentId: string
      occurredAtMillis: number
      groupName: string
      senderUserId: number
      summary: string
      degraded: boolean
      sourceChatSessionUid: string
      legacyGroupUid?: string
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
          ...(stringValue(jumpTarget.subject_uid).trim() === '' ? {} : { legacyGroupUid: stringValue(jumpTarget.subject_uid).trim() }),
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
        ...(descriptor.legacyGroupUid === undefined ? {} : { legacyGroupUid: descriptor.legacyGroupUid }),
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

  async interwovenReadReceipts(sourceRef: string, momentRefs: readonly string[], signal?: AbortSignal): Promise<ArkmeInterwovenReadReceiptList> {
    const epoch = this.interactionEpoch
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'private_chat' || momentRefs.length < 1 || momentRefs.length > 20
      || momentRefs.some(ref => typeof ref !== 'string' || !ref.trim() || ref.length > 32768)
      || new Set(momentRefs).size !== momentRefs.length) {
      throw new ArkmePluginError('interwoven-param-invalid', '群互动已读查询参数无效', false, 400)
    }
    // Validate every signed, account/private-conversation-bound reference before any receipt reads.
    const references = await Promise.all(momentRefs.map(ref => this.openInterwovenMomentRef(ref, session.userId, source.ownerRef)))
    const peerId = await this.assertInterwovenOperationAllowed(source, session, signal)
    await this.resolveReceiptBridgeReferences(sourceRef, source.ownerRef, references, signal)
    const groupReads = new Map<string, Promise<Record<string, unknown>>>()
    const read = (path: string, body: Record<string, unknown>) => this.runtime.authenticatedChatPost<Record<string, unknown>>(
      path, body, session, signal, { lane: 'interactive-read', bypassCache: true },
    )
    const groupDetail = (uid: string) => {
      let pending = groupReads.get(uid)
      if (!pending) {
        pending = read('/api/v1/chats/detail', { chat_session_uid: uid })
        groupReads.set(uid, pending)
      }
      return pending
    }
    const items: ArkmeInterwovenReadReceipt[] = new Array(references.length)
    let next = 0
    const worker = async () => {
      while (next < references.length) {
        signal?.throwIfAborted()
        const index = next++
        const ref = references[index]!
        const reader = ref.senderUserId === session.userId ? 'peer' : 'self'
        const unknown: ArkmeInterwovenReadReceipt = { momentId: ref.momentId, reader, status: 'unknown' }
        items[index] = unknown
        const groupUid = ref.sourceChatSessionUid || ref.legacyGroupUid || ''
        if (!groupUid || (reader === 'self' && ref.senderUserId !== peerId)) continue
        try {
          const group = await groupDetail(groupUid)
          const groupSession = objectValue(group.session)
          if (groupSession.chat_session_uid !== groupUid || groupSession.session_kind !== 2 || groupSession.status !== 1) continue
          let sequence = ref.sequence || ref.receiptSequence || 0
          const receiptRecordUid = ref.receiptRecordUid || ref.recordUid
          if (sequence <= 0) {
            // A Chat->Subject projection UID is not a canonical record UID.
            if (ref.recordUid.startsWith('chat_legacy_receive_')) continue
            // Legacy World rows have a group subject UID, not a Chat sequence.
            // Resolve by exact group + owner + record, never by group name/summary/time.
            const around = await read('/api/v1/chat/timeline/around', {
              chat_session_uid: groupUid, record_uid: ref.recordUid, record_owner_user_id: ref.recordOwnerUserId,
              before_limit: 1, after_limit: 1,
            })
            if (around.chat_session_uid !== groupUid) continue
            const candidates = [...listValue(around.items), around.anchor].map(objectValue)
              .filter(item => {
                const relation = objectValue(item.relation ?? item)
                return relation.chat_session_uid === groupUid && relation.record_uid === ref.recordUid
                  && relation.record_owner_user_id === ref.recordOwnerUserId && relation.sender_user_id === ref.senderUserId
                  && Number.isSafeInteger(relation.seq) && numberValue(relation.seq) > 0
                  && objectValue(item.record).status === 1
              })
            const sequences = new Set(candidates.map(item => numberValue(objectValue(item.relation ?? item).seq)))
            if (sequences.size !== 1) continue
            sequence = [...sequences][0]!
            ref.receiptSequence = sequence
          }
          if (reader === 'self') {
            const cursor = objectValue(group.current_cursor)
            const snapshot = objectValue(group.unread_snapshot)
            if (cursor.user_id !== session.userId || cursor.chat_session_uid !== groupUid || cursor.status !== 1) continue
            const readSeq = snapshot.read_seq ?? cursor.read_seq
            const lastSeq = snapshot.session_last_seq ?? groupSession.last_seq
            if (typeof readSeq !== 'number' || !Number.isSafeInteger(readSeq) || readSeq < 0
              || typeof lastSeq !== 'number' || !Number.isSafeInteger(lastSeq) || lastSeq < sequence) continue
            // Cursor read_at is not this individual message's read time.
            items[index] = { ...unknown, status: readSeq >= sequence ? 'read' : 'unread' }
          } else {
            const detail = await read('/api/v1/chats/read-receipts/detail', {
              chat_session_uid: groupUid, record_uid: receiptRecordUid, seq: sequence,
            })
            if (detail.chat_session_uid !== groupUid || detail.record_uid !== receiptRecordUid || detail.seq !== sequence
              || !Array.isArray(detail.items)) continue
            const peers = detail.items.map(objectValue).filter(member => member.user_id === peerId)
            if (peers.length !== 1) continue
            const peer = peers[0]!
            if ((peer.read_status !== 'read' && peer.read_status !== 'unread')
              || typeof peer.read_at !== 'number' || !Number.isSafeInteger(peer.read_at) || peer.read_at < 0
              || (peer.read_status === 'unread' && peer.read_at !== 0)) continue
            items[index] = { ...unknown, status: peer.read_status,
              ...(peer.read_status === 'read' && peer.read_at > 0 ? { readAtMillis: peer.read_at } : {}) }
          }
        } catch {
          // Unavailable/withdrawn original, expired access or missing member is unknown, never unread.
          signal?.throwIfAborted()
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, references.length) }, worker))
    await this.assertInteractionAccount(session.userId, epoch, signal)
    return { items }
  }

  private async resolveReceiptBridgeReferences(
    sourceRef: string, privateUid: string, references: ArkmeInterwovenMomentReference[], signal?: AbortSignal,
  ): Promise<void> {
    const pending = references.filter(ref => !ref.sequence && !ref.receiptSequence
      && /^chat_legacy_receive_[a-f0-9]{32}$/.test(ref.recordUid))
    if (!pending.length) return
    const matches = new Map<ArkmeInterwovenMomentReference, { recordUid: string; sequence: number } | null>()
    let cursor: string | undefined
    let expectedVersion: string | undefined
    try {
      // Bound compatibility work to 150 recent interactions; never scan full group history.
      for (let page = 0; page < 3; page++) {
        const { data, userId } = await this.readPrivateInteractions('occurrences/query', {
          sourceRef, limit: 50, ...(cursor === undefined ? {} : { cursor }),
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
          ...(signal === undefined ? {} : { signal }),
        })
        const coverage = this.interactionCoverage(data)
        if (expectedVersion && coverage.version !== expectedVersion) return
        expectedVersion = coverage.version
        if (!Array.isArray(data.items) || data.items.length > 50 || typeof data.has_more !== 'boolean') return
        for (const raw of data.items) {
          const item = objectValue(raw)
          if (this.interactionCount(item.seq) === 0) return
          const groupUid = stringValue(item.source_chat_session_uid).trim()
          const relationUid = stringValue(item.rel_uid).trim()
          const recordUid = stringValue(item.record_uid).trim()
          if (!relationUid || !recordUid || item.private_chat_session_uid !== privateUid) continue
          // Exact parity with Subject buildLegacyReceiveRecordEdgeUID(group, relation).
          // This is an immutable identity mapping, never a text/time/name heuristic.
          const alias = `chat_legacy_receive_${createHash('sha256').update(`${groupUid}:${relationUid}`).digest('hex').slice(0, 32)}`
          for (const ref of pending) {
            if (ref.recordUid !== alias || (ref.sourceChatSessionUid || ref.legacyGroupUid) !== groupUid
              || ref.recordOwnerUserId !== item.record_owner_user_id || ref.senderUserId !== item.sender_user_id
              || item.sender_is_me !== (ref.senderUserId === userId)) continue
            const next = { recordUid, sequence: item.seq as number }
            const previous = matches.get(ref)
            matches.set(ref, previous === null || (previous && (previous.recordUid !== recordUid || previous.sequence !== next.sequence)) ? null : next)
          }
        }
        if (!data.has_more || pending.every(ref => matches.has(ref))) break
        if (typeof data.next_cursor !== 'string' || !data.next_cursor || data.next_cursor.length > 2048) return
        cursor = data.next_cursor
      }
      for (const [ref, match] of matches) if (match) {
        ref.receiptRecordUid = match.recordUid
        ref.receiptSequence = match.sequence
      }
    } catch {
      signal?.throwIfAborted()
      // Missing/incomplete bridge coverage remains unknown, never an inferred unread.
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
  ): Promise<number> {
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
    return await this.assertHumanPrivateSource(source, session, signal)
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

  async interwovenStableMomentId(rawMomentId: string): Promise<string> {
    return `arkme-moment-${createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(`interwoven:${rawMomentId}`).digest('base64url').slice(0, 32)}`
  }

  private async sealInterwovenMomentRef(
    reference: Omit<ArkmeInterwovenMomentReference, 'expiresAtMillis'>,
  ): Promise<string> {
    const codec = new TimelineTokenCodec(await this.runtime.stateStore.uniqueCode(),
      JSON.stringify([this.runtime.config.environment, reference.userId, reference.sourceOwnerRef]))
    return codec.seal(JSON.stringify({ ...reference, expiresAtMillis: Date.now() + 12 * 60 * 60 * 1000 }), 'interwoven-detail')
  }

  private async openInterwovenMomentRef(
    momentRef: string,
    expectedUserId: number,
    expectedSourceOwnerRef: string,
  ): Promise<ArkmeInterwovenMomentReference> {
    if (momentRef.startsWith('atw1.')) {
      const cached = this.momentReferences.get(momentRef)
      if (cached && cached.expiresAtMillis > Date.now() && cached.userId === expectedUserId && cached.sourceOwnerRef === expectedSourceOwnerRef) return cached
      const codec = new TimelineTokenCodec(await this.runtime.stateStore.uniqueCode(),
        JSON.stringify([this.runtime.config.environment, expectedUserId, expectedSourceOwnerRef]))
      let reference: ArkmeInterwovenMomentReference
      try { reference = JSON.parse(codec.open(momentRef, 'interwoven-detail')) as ArkmeInterwovenMomentReference }
      catch { throw new ArkmePluginError('interwoven-ref-invalid', '交织瞬间引用与当前会话不匹配', false, 403) }
      if (reference.expiresAtMillis <= Date.now()) throw new ArkmePluginError('interwoven-ref-expired', '交织瞬间引用已过期，请刷新会话后重试', true, 410)
      for (const [key, value] of this.momentReferences) if (value.expiresAtMillis <= Date.now()) this.momentReferences.delete(key)
      while (this.momentReferences.size >= 1000) this.momentReferences.delete(this.momentReferences.keys().next().value!)
      // Receipt resolution enriches this object in place. Reuse the verified relation within this runtime.
      this.momentReferences.set(momentRef, reference)
      return reference
    }
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
