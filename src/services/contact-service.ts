import { randomUUID } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeContactAddResult,
  ArkmeContactIdentifierKind,
  ArkmeContactSearchResult,
} from '../types.js'
import { ProfileService } from './profile-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'
import { SourceService } from './source-service.js'
import { ChatRealtimeService } from './chat-realtime-service.js'

const CONTACT_REF_TTL_MS = 10 * 60_000
const MAX_CONTACT_REFS = 512
const CONTACT_REF_PATTERN = /^arkme-contact-v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface NormalizedIdentifier {
  kind: ArkmeContactIdentifierKind
  identifierType: 1 | 2
  identifier: string
  phonePre: string
}

interface ContactCandidate {
  userId: number
  expiresAtMillis: number
  normalized: NormalizedIdentifier
  result: ArkmeContactSearchResult
  targetUserId?: number
  phone?: string
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}

function booleanValue(value: unknown): boolean { return value === true }

function normalizeIdentifier(value: string): NormalizedIdentifier {
  const trimmed = value.trim().replace(/^@/, '')
  if (trimmed === '' || trimmed.length > 64) {
    throw new ArkmePluginError('contact-identifier-invalid', '请输入手机号或即我号', false)
  }
  const compactPhone = trimmed.replace(/[\s()-]/g, '').replace(/^\+86/, '')
  if (/^\d+$/.test(compactPhone)) {
    if (!/^1[3-9]\d{9}$/.test(compactPhone)) {
      throw new ArkmePluginError('contact-phone-invalid', '请输入有效的中国大陆手机号', false)
    }
    return { kind: 'phone', identifierType: 1, identifier: compactPhone, phonePre: '86' }
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]{1,63}$/.test(trimmed)) {
    throw new ArkmePluginError('contact-arkme-id-invalid', '即我号格式无效', false)
  }
  return { kind: 'arkme_id', identifierType: 2, identifier: trimmed, phonePre: '86' }
}

export class ContactService {
  private readonly candidates = new Map<string, ContactCandidate>()

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: SourceService,
    private readonly profile: ProfileService,
    private readonly realtime: ChatRealtimeService,
  ) {}

  dispose(): void { this.candidates.clear() }

  async search(identifier: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeContactSearchResult> {
    const session = await this.runtime.requireSession()
    const normalized = normalizeIdentifier(identifier)
    const candidate = await this.lookup(normalized, session, options.signal)
    this.prune()
    this.candidates.set(candidate.result.contactRef, candidate)
    this.prune()
    return candidate.result
  }

  async add(
    contactRef: string,
    options: { remark?: string; requestUid?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeContactAddResult> {
    const session = await this.runtime.requireSession()
    this.prune()
    const normalizedContactRef = contactRef.trim()
    if (!CONTACT_REF_PATTERN.test(normalizedContactRef)) {
      throw new ArkmePluginError('contact-ref-invalid', '联系人搜索引用无效，请重新搜索', false)
    }
    const cached = this.candidates.get(normalizedContactRef)
    if (cached === undefined || cached.userId !== session.userId || cached.expiresAtMillis <= Date.now()) {
      throw new ArkmePluginError('contact-ref-expired', '联系人搜索结果已过期，请重新搜索', false, 410)
    }

    // Revalidate immediately before the write so registration/self/addability changes cannot race the search result.
    const candidate = await this.lookup(cached.normalized, session, options.signal, normalizedContactRef)
    if (candidate.targetUserId !== cached.targetUserId || candidate.result.registered !== cached.result.registered) {
      this.candidates.delete(normalizedContactRef)
      throw new ArkmePluginError('contact-candidate-changed', '联系人身份已发生变化，请重新搜索后确认', false, 409)
    }
    if (candidate.result.isSelf) throw new ArkmePluginError('contact-self-invalid', '不能添加自己为联系人', false)
    if (!candidate.result.canAdd) throw new ArkmePluginError('contact-add-unavailable', '该账号当前无法添加', false, 409)

    const remark = options.remark?.trim() ?? ''
    if (Array.from(remark).length > 100) throw new ArkmePluginError('contact-remark-invalid', '备注不能超过 100 个字符', false)
    const requestUid = options.requestUid?.trim() || randomUUID()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestUid)) {
      throw new ArkmePluginError('contact-request-uid-invalid', '联系人添加请求标识无效', false)
    }
    const chatSessionUid = `chat_session_${requestUid}`
    const displayName = candidate.result.displayName
    const common = { chat_session_uid: chatSessionUid, create_at: Date.now(), ...(remark === '' ? {} : { remark }) }
    const registered = candidate.result.registered && candidate.targetUserId !== undefined
    const bundle = registered
      ? await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/contacts/add-and-open-private',
        { ...common, target_user_id: candidate.targetUserId, target_display_name_snapshot: displayName },
        session,
        options.signal,
        { key: `contact:add:${requestUid}` },
      )
      : await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/contacts/add-and-open-pending-phone',
        { ...common, phone_pre: candidate.normalized.phonePre, phone: candidate.phone ?? candidate.normalized.identifier, display_name_snapshot: displayName },
        session,
        options.signal,
        { key: `contact:add:${requestUid}` },
      )
    let source = await this.source.chatSourceFromBundle(bundle, session, undefined, [])
    if (registered && candidate.targetUserId !== undefined) {
      source = { ...source, avatarRef: await this.profile.sealProfileImageRef(session.userId, candidate.targetUserId) }
    }
    const returnedUid = stringValue(objectValue(bundle.session).chat_session_uid).trim()
    if (returnedUid === '') throw new ArkmePluginError('contact-add-contract-invalid', '联系人添加响应不完整', true, 502)
    this.source.setChatSource(session.userId, returnedUid, source)
    this.source.invalidateSourceListCache(session.userId, 'root')
    this.realtime.emitChatClientEvent({
      type: 'sessions-delta',
      revision: this.realtime.nextChatClientRevision(),
      updates: [{ sourceKey: source.sourceKey ?? await this.source.chatDirectorySourceKey(session.userId, returnedUid), source, timelineItems: [] }],
    })
    this.candidates.delete(normalizedContactRef)
    return { state: registered ? 'ready' : 'pending', source }
  }

  private async lookup(
    normalized: NormalizedIdentifier,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
    contactRef = `arkme-contact-v1.${randomUUID()}`,
  ): Promise<ContactCandidate> {
    const data = await this.runtime.authenticatedAuthPost<Record<string, unknown>>(
      '/api/v1/auth/search-contact-account',
      { identifier_type: normalized.identifierType, identifier: normalized.identifier, phone_pre: normalized.phonePre },
      session,
      signal,
      { key: `contact:search:${normalized.identifierType}:${normalized.identifier}`, bypassCache: true },
    )
    const targetUserId = Math.trunc(numberValue(data.user_id))
    const registered = booleanValue(data.is_registered) && targetUserId > 0
    const isSelf = booleanValue(data.is_self)
    // The pending-contact endpoint is phone-only. Match the mobile client by
    // never presenting an unregistered Arkme ID as addable, even if an
    // inconsistent upstream payload happens to set can_add.
    const canAdd = booleanValue(data.can_add) && !isSelf && (normalized.kind === 'phone' || registered)
    const displayName = stringValue(data.nick_name).trim()
      || stringValue(data.jotmo_id).trim()
      || (normalized.kind === 'phone' ? `+${normalized.phonePre} ${normalized.identifier}` : normalized.identifier)
    const result: ArkmeContactSearchResult = {
      contactRef,
      identifierKind: normalized.kind,
      displayName,
      ...(stringValue(data.jotmo_id).trim() === '' ? {} : { arkmeId: stringValue(data.jotmo_id).trim() }),
      ...(registered ? { avatarRef: await this.profile.sealProfileImageRef(session.userId, targetUserId) } : {}),
      registered,
      inviteBySms: booleanValue(data.invite_by_sms),
      canAdd,
      isSelf,
    }
    return {
      userId: session.userId,
      expiresAtMillis: Date.now() + CONTACT_REF_TTL_MS,
      normalized,
      result,
      ...(targetUserId > 0 ? { targetUserId } : {}),
      ...(normalized.kind === 'phone' ? { phone: stringValue(data.phone).trim() || normalized.identifier } : {}),
    }
  }

  private prune(): void {
    const now = Date.now()
    for (const [ref, candidate] of this.candidates) {
      if (candidate.expiresAtMillis <= now) this.candidates.delete(ref)
    }
    while (this.candidates.size >= MAX_CONTACT_REFS) {
      const oldest = this.candidates.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.candidates.delete(oldest)
    }
  }
}
