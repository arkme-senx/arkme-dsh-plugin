import { PeopleIdentityService } from './people-identity-service.js'
import { createHmac } from 'node:crypto'
import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import { PEOPLE_SOURCES, type PeoplePage, type PeopleSource, type PersonFacet } from '../people-contract.js'
import type { ExploreService } from './explore-service.js'
import type { RecordingService } from './recording-service.js'
import type { ContactDirectoryService } from './contact-directory-service.js'
import type { ChatService } from './chat-service.js'
import { ArkmePluginError, type ServiceRuntime, objectValue } from './service.js'

const unavailable = () => new ArkmePluginError('people-unavailable', '人物资料已变化，请刷新后重试', true, 409)
const id = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0

/** Projects verified owner facts; explicit identity commands remain in the Relation owner domain. */
export class PeopleService {
  private readonly identities: PeopleIdentityService
  private readonly codec: EncryptedReferenceCodec
  constructor(private readonly runtime: ServiceRuntime,
    private readonly explore: Pick<ExploreService, 'personDirectoryItem'>,
    private readonly recording: Pick<RecordingService, 'directorySpeakerRef' | 'directoryUserSpeakerRef'>,
    private readonly contacts: Pick<ContactDirectoryService, 'listRecordingSpeakerUsers' | 'enrichPeoplePage'>,
    private readonly chat: Pick<ChatService, 'openPrivateChatFromUser'>) {
    this.identities = new PeopleIdentityService(runtime, (id, owner) => recording.directorySpeakerRef(id, owner))
    this.codec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), unavailable)
  }
  async list(sourceValue: unknown, signal?: AbortSignal, cursor?: unknown, queryValue?: unknown): Promise<PeoplePage> {
    if (!PEOPLE_SOURCES.includes(sourceValue as PeopleSource)) throw unavailable()
    const source = sourceValue as PeopleSource, session = await this.runtime.requireSession()
    if (cursor !== undefined && (typeof cursor !== 'string' || !cursor || cursor.length > 16384)) throw unavailable()
    if (queryValue !== undefined && (typeof queryValue !== 'string' || [...queryValue].length > 200)) throw unavailable()
    const query = typeof queryValue === 'string' ? queryValue.trim() : ''
    const keySecret = await this.runtime.stateStore.uniqueCode()
    const key = (kind: string, value: string | number) => createHmac('sha256', keySecret).update(JSON.stringify([this.runtime.config.environment, session.userId, 'people-v1', kind, value])).digest('hex')
    let ownerCursor: string | undefined
    if (cursor) {
      const c = await this.codec.open('arkme-people-page-v1', cursor as string)
      if (c.viewer !== session.userId || c.environment !== this.runtime.config.environment || c.source !== source || c.query !== query || typeof c.cursor !== 'string') throw unavailable()
      ownerCursor = c.cursor
    }
    type Row = { identity: { namespace: string; id: string }; link: { identity: { namespace: string; id: string }; state: string; person_id: string; person_revision?: number; excluded_person_ids?: string[] }; display_name: string; aliases?: string[]; ref_user_id?: number; remark?: string; relation?: Record<string, unknown> }
    const page = await this.runtime.authenticatedRelationPost<{ source: string; items: Row[]; next_cursor?: string; search_pending?: boolean }>('/api/v1/entity/identities/directory',
      { source, query, limit: 50, ...(ownerCursor ? { cursor: ownerCursor } : {}) }, session, signal, { bypassCache: true, cacheMs: 0 })
    if (page.source !== source || !Array.isArray(page.items) || page.items.length > 50) throw unavailable()
    const contactRows = source === 'contacts' ? await this.contacts.enrichPeoplePage(page.items.map(r => ({ userId: id(r.ref_user_id), label: r.display_name, ...(r.remark ? { remark: r.remark } : {}) })), session, signal) : []
    const items = await Promise.all(page.items.map(async (row, index): Promise<PersonFacet> => {
      const identity = row.identity, userId = id(row.ref_user_id), kind = source === 'relations' ? 'entity' : source === 'speakers' ? 'speaker' : 'contact'
      if (!identity?.id || identity.namespace !== ({ relations: 'relation_entity', speakers: 'audio_speaker', contacts: 'arkme_user' }[source]) || !row.link || row.link.identity?.id !== identity.id || row.link.identity.namespace !== identity.namespace) throw unavailable()
      const contact = contactRows[index]
      const facet: PersonFacet = { key: key(kind, source === 'contacts' ? userId : identity.id), personKey: key(userId ? 'user' : kind, userId || identity.id), source,
        name: contact?.label || row.remark || row.display_name || '未命名人物', aliases: [...new Set([...(contact?.aliases ?? []), ...(row.aliases ?? []), ...(row.remark && row.remark !== row.display_name ? [row.display_name] : [])])], accountLinked: userId > 0, isSelf: userId === session.userId,
        ...(row.remark ? { hasRemark: true } : {}), ...(contact?.avatarRef ? { avatarRef: contact.avatarRef } : {}) }
      if (source === 'relations') {
        if (!row.relation) throw unavailable()
        facet.relation = await this.explore.personDirectoryItem(row.relation)
      } else if (source === 'speakers') {
        facet.speakerRef = await this.recording.directorySpeakerRef(identity.id, session.userId); facet.assignmentRef = facet.speakerRef
      } else {
        if (!userId) throw unavailable()
        facet.assignmentRef = await this.recording.directoryUserSpeakerRef(userId, session.userId)
        if (userId !== session.userId) facet.chatRef = await this.codec.seal('arkme-person-chat-v1', { viewer: session.userId, environment: this.runtime.config.environment, userId, label: facet.name, expires: Date.now() + 30 * 60_000 })
      }
      return this.identities.decorate(facet, identity, value => key('person', value), signal, row.link)
    }))
    const nextCursor = page.next_cursor ? await this.codec.seal('arkme-people-page-v1', { viewer: session.userId, environment: this.runtime.config.environment, source, query, cursor: page.next_cursor }) : undefined
    signal?.throwIfAborted()
    const current = await this.runtime.requireSession()
    if (current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw unavailable()
    return { source, items, ...(nextCursor ? { nextCursor } : {}), ...(page.search_pending ? { searchPending: true } : {}) }
  }
  async identityAction(action: unknown, params: Record<string, unknown>, signal?: AbortSignal) { return this.identities.execute(action, params, signal) }
  async openChat(value: string, signal?: AbortSignal) {
    const session = await this.runtime.requireSession()
    const ref = await this.codec.open('arkme-person-chat-v1', value)
    if (ref.viewer !== session.userId || ref.environment !== this.runtime.config.environment || Number(ref.expires) < Date.now() || !id(ref.userId)) throw unavailable()
    await this.runtime.authenticatedRelationPost('/api/v1/entity/identities/resolve', { identity: { namespace: 'arkme_user', id: String(ref.userId) } }, session, signal, { bypassCache: true, cacheMs: 0 })
    signal?.throwIfAborted()
    const current = await this.runtime.requireSession()
    if (typeof ref.label !== 'string' || current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw unavailable()
    return this.chat.openPrivateChatFromUser(Number(ref.userId), { presentationDisplayName: ref.label as string, ...(signal ? { signal } : {}) })
  }
}
