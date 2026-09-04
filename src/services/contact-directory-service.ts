import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

import { contactDirectoryLetter } from '../contact-directory-presentation.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeDirectoryContactProfile,
  ArkmeDirectoryItem,
  ArkmeDirectoryPage,
  ArkmeDirectorySectionKind,
  ArkmeOpenPrivateChatResult,
  ArkmeSourceItem,
  ArkmeWorldFeedPage,
} from '../types.js'
import type { BotService } from './bot-service.js'
import type { ChatService } from './chat-service.js'
import type { ArkmePublicProfile, ProfileService } from './profile-service.js'
import { ArkmePluginError, type ServiceRuntime, objectValue, stringValue } from './service.js'
import type { SourceService } from './source-service.js'
import type { WorldService } from './world-service.js'

interface ContactDirectoryRefEntry {
  viewerUserId: number
  targetUserId: number
  chatSessionUid?: string
  displayNameSnapshot?: string
  displayName: string
  nickname: string
  remark: string
  accountName?: string
  avatarRef?: string
  expiresAtMillis: number
}

interface ContactDirectoryDescriptor {
  targetUserId: number
  chatSessionUid?: string
  displayNameSnapshot?: string
  remark: string
}

const CONTACT_DIRECTORY_REF_TTL_MS = 30 * 60_000
const CONTACT_DIRECTORY_REF_CAP = 2_000
const CONTACT_DIRECTORY_PAGE_LIMIT = 50
const CONTACT_DIRECTORY_MAX_SOURCE_PAGES = 20
const CONTACT_DIRECTORY_REF_PATTERN = /^arkme-directory-contact-v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OFFSET_CURSOR_PATTERN = /^arkme-directory-offset-v1\.(bots|contacts)\.([0-9]+)\.([A-Za-z0-9_-]+)$/

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return 0
}

function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

function boundedLimit(value: number | undefined, fallback = 30): number {
  return Math.min(50, Math.max(1, Math.trunc(value ?? fallback)))
}

function cloneWorldOptions(options: { limit?: number; offset?: number; signal?: AbortSignal }): {
  limit?: number; offset?: number; signal?: AbortSignal
} {
  return {
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.offset === undefined ? {} : { offset: options.offset }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
}

export class ContactDirectoryService {
  private readonly contactRefs = new Map<string, ContactDirectoryRefEntry>()

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: SourceService,
    private readonly bot: BotService,
    private readonly profile: ProfileService,
    private readonly world: WorldService,
    private readonly chat: ChatService,
  ) {}

  dispose(): void { this.contactRefs.clear() }

  async listRecordingSpeakerUsers(
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Array<{ userId: number; label: string; avatarRef?: string }>> {
    const descriptors = await this.loadMergedContactDescriptors(session, signal === undefined ? {} : { signal })
    const userIds = [session.userId, ...descriptors.map(descriptor => descriptor.targetUserId)]
    const profiles = await this.profile.publicProfileSummariesByUserIds(userIds, session, signal)
    const candidates: Array<{ userId: number; label: string; avatarRef?: string }> = []
    const currentProfile = profiles.get(session.userId)
    candidates.push({
      userId: session.userId,
      label: currentProfile?.displayName || currentProfile?.nickname || '我',
      ...(currentProfile?.avatarUrl === undefined
        ? {}
        : { avatarRef: await this.profile.sealProfileImageRef(session.userId, session.userId) }),
    })
    for (const descriptor of descriptors) {
      const identity = await this.contactIdentity(
        descriptor.targetUserId,
        descriptor.remark,
        profiles.get(descriptor.targetUserId),
        session,
        descriptor.displayNameSnapshot,
      )
      candidates.push({
        userId: descriptor.targetUserId,
        label: identity.displayName,
        ...(identity.avatarRef === undefined ? {} : { avatarRef: identity.avatarRef }),
      })
    }
    return candidates
  }

  async list(
    section: ArkmeDirectorySectionKind,
    options: { limit?: number; cursor?: string; countOnly?: boolean; refresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<ArkmeDirectoryPage> {
    if (section === 'unmarked-speakers' || section === 'teams') {
      throw new ArkmePluginError('directory-section-not-owned', '该目录由独立业务服务提供', false, 501)
    }
    if (options.countOnly === true) return await this.count(section, options.signal)
    switch (section) {
      case 'groups': return await this.listGroups(options)
      case 'bots': return await this.listBots(options)
      case 'contacts': return await this.listContacts(options)
    }
  }

  private async count(section: Exclude<ArkmeDirectorySectionKind, 'unmarked-speakers' | 'teams'>, signal?: AbortSignal): Promise<ArkmeDirectoryPage> {
    const session = await this.runtime.requireSession()
    let total = 0
    switch (section) {
      case 'groups':
        total = await this.source.countGroupSources(signal)
        break
      case 'bots':
        total = await this.bot.countBots(signal === undefined ? {} : { signal })
        break
      case 'contacts': {
        total = (await this.loadMergedContactDescriptors(
          session, signal === undefined ? {} : { signal },
        )).length
        break
      }
    }
    return { section, items: [], total, hasMore: false }
  }

  async contactProfile(contactRef: string, signal?: AbortSignal): Promise<ArkmeDirectoryContactProfile> {
    const { session, entry } = await this.resolveContactRef(contactRef)
    const publicProfile = (await this.profile.publicProfileSummariesByUserIds(
      [entry.targetUserId], session, signal,
    )).get(entry.targetUserId)
    const identity = await this.contactIdentity(
      entry.targetUserId, entry.remark, publicProfile, session, entry.displayNameSnapshot,
    )
    const updated = { ...entry, ...identity }
    this.contactRefs.set(contactRef.trim(), updated)
    return {
      contactRef: contactRef.trim(),
      displayName: updated.displayName,
      nickname: updated.nickname,
      remark: updated.remark,
      ...(updated.avatarRef === undefined ? {} : { avatarRef: updated.avatarRef }),
    }
  }

  async contactWorld(
    contactRef: string,
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldFeedPage> {
    const { entry } = await this.resolveContactRef(contactRef)
    return await this.world.listUserWorldFeed(entry.targetUserId, cloneWorldOptions(options))
  }

  async openContactChat(contactRef: string, signal?: AbortSignal): Promise<ArkmeOpenPrivateChatResult> {
    const { entry } = await this.resolveContactRef(contactRef)
    return await this.chat.openPrivateChatFromUser(entry.targetUserId, {
      presentationDisplayName: entry.displayName,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async openGroupChat(sourceRef: string, signal?: AbortSignal): Promise<ArkmeSourceItem> {
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
    const session = await this.runtime.requireSession()
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
    if (source.kind !== 'group_chat') throw new ArkmePluginError('directory-group-invalid', '群聊引用无效', false, 403)
    const item = await this.source.sourceItem(source)
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
    return item
  }

  private async listGroups(
    options: { limit?: number; cursor?: string; refresh?: boolean; signal?: AbortSignal },
  ): Promise<ArkmeDirectoryPage> {
    const page = await this.source.listGroupSources(options)
    const items: ArkmeDirectoryItem[] = page.items.map(item => ({
      kind: 'group', sourceRef: item.sourceRef, displayName: item.displayName,
      ...(item.avatarRef === undefined ? {} : { avatarRef: item.avatarRef }),
      ...(item.groupAvatar === undefined ? {} : { groupAvatar: item.groupAvatar }),
    }))
    return {
      section: 'groups', items, total: page.total ?? items.length, hasMore: page.hasMore,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    }
  }

  private async listBots(
    options: { limit?: number; cursor?: string; signal?: AbortSignal },
  ): Promise<ArkmeDirectoryPage> {
    const session = await this.runtime.requireSession()
    const limit = boundedLimit(options.limit)
    const offset = await this.openOffsetCursor('bots', options.cursor, session.userId)
    const bots = (await this.bot.listBots(options.signal === undefined ? {} : { signal: options.signal })).items
    const slice = bots.slice(offset, offset + limit)
    const items: ArkmeDirectoryItem[] = slice.map(bot => ({ kind: 'bot', bot }))
    const hasMore = offset + slice.length < bots.length
    return {
      section: 'bots', items, total: bots.length, hasMore,
      ...(hasMore ? { nextCursor: await this.sealOffsetCursor('bots', offset + slice.length, session.userId) } : {}),
    }
  }

  private async listContacts(
    options: { limit?: number; cursor?: string; refresh?: boolean; signal?: AbortSignal },
  ): Promise<ArkmeDirectoryPage> {
    const session = await this.runtime.requireSession()
    const limit = boundedLimit(options.limit)
    const offset = await this.openOffsetCursor('contacts', options.cursor, session.userId)
    const descriptors = await this.loadMergedContactDescriptors(session, options)
    const pageDescriptors = descriptors.slice(offset, offset + limit)
    const profiles = await this.profile.publicProfileSummariesByUserIds(
      pageDescriptors.map(item => item.targetUserId), session, options.signal,
    )
    const items: ArkmeDirectoryItem[] = []
    this.pruneContactRefs()
    for (const descriptor of pageDescriptors) {
      const identity = await this.contactIdentity(
        descriptor.targetUserId, descriptor.remark, profiles.get(descriptor.targetUserId), session,
        descriptor.displayNameSnapshot,
      )
      const contactRef = `arkme-directory-contact-v1.${randomUUID()}`
      const entry: ContactDirectoryRefEntry = {
        viewerUserId: session.userId,
        targetUserId: descriptor.targetUserId,
        ...(descriptor.chatSessionUid === undefined ? {} : { chatSessionUid: descriptor.chatSessionUid }),
        ...(descriptor.displayNameSnapshot === undefined ? {} : { displayNameSnapshot: descriptor.displayNameSnapshot }),
        ...identity,
        expiresAtMillis: Date.now() + CONTACT_DIRECTORY_REF_TTL_MS,
      }
      this.contactRefs.set(contactRef, entry)
      const item: Extract<ArkmeDirectoryItem, { kind: 'contact' }> = {
        kind: 'contact', contactRef, displayName: entry.displayName,
        nickname: entry.nickname, remark: entry.remark,
        ...(entry.accountName === undefined ? {} : { accountName: entry.accountName }),
        ...(entry.avatarRef === undefined ? {} : { avatarRef: entry.avatarRef }),
        letter: '#',
      }
      item.letter = contactDirectoryLetter(item)
      items.push(item)
    }
    this.pruneContactRefs()
    const hasMore = offset + pageDescriptors.length < descriptors.length
    return {
      section: 'contacts', items, total: descriptors.length, hasMore,
      ...(hasMore ? { nextCursor: await this.sealOffsetCursor('contacts', offset + pageDescriptors.length, session.userId) } : {}),
    }
  }

  private async loadMergedContactDescriptors(
    session: ArkmeSessionCredentials,
    options: { refresh?: boolean; signal?: AbortSignal },
  ): Promise<ContactDirectoryDescriptor[]> {
    const descriptorsByUserId = new Map<number, ContactDirectoryDescriptor>()
    let offset = 0
    let baseComplete = false
    for (let pageIndex = 0; pageIndex < CONTACT_DIRECTORY_MAX_SOURCE_PAGES; pageIndex += 1) {
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/contacts/list', { limit: CONTACT_DIRECTORY_PAGE_LIMIT, offset }, session, options.signal,
        {
          lane: 'interactive-read', key: `directory:contacts:base:${String(offset)}`,
          failureCooldownMs: 2_000, bypassCache: options.refresh === true,
        },
      )
      const rawItems = listValue(data.items)
      for (const value of rawItems) {
        const raw = objectValue(value)
        const targetUserId = numberValue(raw.user_id)
        if (targetUserId <= 0 || !Number.isSafeInteger(targetUserId)
          || targetUserId === session.userId || descriptorsByUserId.has(targetUserId)) continue
        const chatSessionUid = stringValue(raw.chat_session_uid).trim()
        descriptorsByUserId.set(targetUserId, {
          targetUserId,
          ...(chatSessionUid === '' ? {} : { chatSessionUid }),
          remark: stringValue(raw.remark).trim(),
        })
      }
      if (data.has_more !== true) {
        baseComplete = true
        break
      }
      if (rawItems.length === 0) {
        throw new ArkmePluginError(
          'directory-contact-pagination-invalid', '联系人列表分页响应不完整', true, 502,
        )
      }
      offset += rawItems.length
    }
    if (!baseComplete) {
      throw new ArkmePluginError(
        'directory-contact-pagination-limit', '联系人列表超过安全分页上限', true, 502,
      )
    }

    let pageCursor: Record<string, unknown> | undefined
    let directComplete = false
    const visitedCursorKeys = new Set<string>()
    for (let pageIndex = 0; pageIndex < CONTACT_DIRECTORY_MAX_SOURCE_PAGES; pageIndex += 1) {
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/list',
        {
          limit: CONTACT_DIRECTORY_PAGE_LIMIT,
          session_kind: 1,
          ...(pageCursor === undefined ? {} : { page_cursor: pageCursor }),
        },
        session,
        options.signal,
        {
          lane: 'interactive-read', key: `directory:contacts:direct:${String(pageIndex)}`,
          failureCooldownMs: 2_000, bypassCache: options.refresh === true,
        },
      )
      for (const value of listValue(data.items)) {
        const bundle = objectValue(value)
        const chatSession = objectValue(bundle.session)
        if (numberValue(chatSession.session_kind) !== 1 || listValue(bundle.bot_participants).length > 0) continue
        const counterpart = objectValue(bundle.private_counterpart)
        const targetUserId = numberValue(counterpart.user_id)
        if (targetUserId <= 0 || !Number.isSafeInteger(targetUserId) || targetUserId === session.userId) continue
        const chatSessionUid = stringValue(chatSession.chat_session_uid).trim()
        const existing = descriptorsByUserId.get(targetUserId)
        if (existing !== undefined) {
          if (existing.chatSessionUid === undefined && chatSessionUid !== '') {
            descriptorsByUserId.set(targetUserId, { ...existing, chatSessionUid })
          }
          continue
        }
        const supplement = objectValue(bundle.private_supplement)
        const displayNameSnapshot = stringValue(
          supplement.counterpart_name_snapshot ?? counterpart.display_name_snapshot ?? supplement.pending_name,
        ).trim()
        descriptorsByUserId.set(targetUserId, {
          targetUserId,
          ...(chatSessionUid === '' ? {} : { chatSessionUid }),
          ...(displayNameSnapshot === '' ? {} : { displayNameSnapshot }),
          remark: stringValue(supplement.remark).trim(),
        })
      }
      if (data.has_more !== true) {
        directComplete = true
        break
      }
      const nextCursor = objectValue(data.next_page_cursor)
      const cursorKey = JSON.stringify(nextCursor)
      if (Object.keys(nextCursor).length === 0 || visitedCursorKeys.has(cursorKey)) {
        throw new ArkmePluginError(
          'directory-contact-pagination-invalid', '私聊联系人分页响应不完整', true, 502,
        )
      }
      visitedCursorKeys.add(cursorKey)
      pageCursor = nextCursor
    }
    if (!directComplete) {
      throw new ArkmePluginError(
        'directory-contact-pagination-limit', '私聊联系人超过安全分页上限', true, 502,
      )
    }
    return [...descriptorsByUserId.values()]
  }

  private async contactIdentity(
    targetUserId: number,
    remark: string,
    profile: ArkmePublicProfile | undefined,
    session: ArkmeSessionCredentials,
    displayNameSnapshot?: string,
  ): Promise<Pick<ContactDirectoryRefEntry, 'displayName' | 'nickname' | 'remark' | 'accountName' | 'avatarRef'>> {
    const nickname = profile?.nickname?.trim() ?? ''
    const accountName = profile?.accountName?.trim() ?? ''
    const displayName = remark || nickname || accountName || displayNameSnapshot?.trim() || '联系人'
    const avatarRef = profile?.avatarUrl === undefined
      ? undefined
      : await this.profile.sealProfileImageRef(session.userId, targetUserId)
    return {
      displayName, nickname, remark,
      ...(accountName === '' ? {} : { accountName }),
      ...(avatarRef === undefined ? {} : { avatarRef }),
    }
  }

  private async resolveContactRef(contactRef: string): Promise<{
    session: ArkmeSessionCredentials; entry: ContactDirectoryRefEntry
  }> {
    const session = await this.runtime.requireSession()
    this.pruneContactRefs()
    const normalized = contactRef.trim()
    if (!CONTACT_DIRECTORY_REF_PATTERN.test(normalized)) {
      throw new ArkmePluginError('directory-contact-ref-invalid', '联系人目录引用无效，请刷新后重试', false)
    }
    const entry = this.contactRefs.get(normalized)
    if (entry === undefined) {
      throw new ArkmePluginError('directory-contact-ref-expired', '联系人目录引用已过期，请刷新后重试', false, 410)
    }
    if (entry.viewerUserId !== session.userId) {
      throw new ArkmePluginError('directory-contact-ref-account-mismatch', '联系人目录引用与当前账号不匹配', false, 403)
    }
    return { session, entry }
  }

  private pruneContactRefs(): void {
    const now = Date.now()
    for (const [ref, entry] of this.contactRefs) {
      if (entry.expiresAtMillis <= now) this.contactRefs.delete(ref)
    }
    while (this.contactRefs.size > CONTACT_DIRECTORY_REF_CAP) {
      const oldest = this.contactRefs.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.contactRefs.delete(oldest)
    }
  }

  private async sealOffsetCursor(
    section: 'bots' | 'contacts', offset: number, viewerUserId: number,
  ): Promise<string> {
    const normalizedOffset = Math.max(0, Math.trunc(offset))
    const payload = `${section}:${String(viewerUserId)}:${String(normalizedOffset)}`
    const signature = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(payload).digest('base64url')
    return `arkme-directory-offset-v1.${section}.${String(normalizedOffset)}.${signature}`
  }

  private async openOffsetCursor(
    section: 'bots' | 'contacts', cursor: string | undefined, viewerUserId: number,
  ): Promise<number> {
    const normalized = cursor?.trim() ?? ''
    if (normalized === '') return 0
    const match = OFFSET_CURSOR_PATTERN.exec(normalized)
    if (match === null || match[1] !== section) {
      throw new ArkmePluginError('directory-cursor-invalid', '联系人目录分页游标无效', false)
    }
    const offset = numberValue(match[2])
    if (offset < 0 || !Number.isSafeInteger(offset)) {
      throw new ArkmePluginError('directory-cursor-invalid', '联系人目录分页游标无效', false)
    }
    const payload = `${section}:${String(viewerUserId)}:${String(offset)}`
    const supplied = Buffer.from(match[3] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(payload).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ArkmePluginError('directory-cursor-invalid', '联系人目录分页游标无效或与当前账号不匹配', false, 403)
    }
    return offset
  }
}
