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

/** Joins verified owner facts for display only. Never creates or merges domain identities. */
export class PeopleService {
  private readonly codec: EncryptedReferenceCodec
  constructor(private readonly runtime: ServiceRuntime,
    private readonly explore: Pick<ExploreService, 'personPage'>,
    private readonly recording: Pick<RecordingService, 'directorySpeakerRef' | 'directoryUserSpeakerRef'>,
    private readonly contacts: Pick<ContactDirectoryService, 'listRecordingSpeakerUsers'>,
    private readonly chat: Pick<ChatService, 'openPrivateChatFromUser'>) {
    this.codec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), unavailable)
  }
  async list(sourceValue: unknown, signal?: AbortSignal, cursor?: unknown): Promise<PeoplePage> {
    if (!PEOPLE_SOURCES.includes(sourceValue as PeopleSource)) throw unavailable()
    const source = sourceValue as PeopleSource, session = await this.runtime.requireSession()
    if (cursor !== undefined && (source !== 'relations' || typeof cursor !== 'string' || !cursor || cursor.length > 16384)) throw unavailable()
    const keySecret = await this.runtime.stateStore.uniqueCode()
    const key = (kind: string, value: string | number) => createHmac('sha256', keySecret).update(JSON.stringify([this.runtime.config.environment, session.userId, 'people-v1', kind, value])).digest('hex')
    let items: PersonFacet[]
    let nextCursor: string | undefined
    if (source === 'relations') {
      const page = await this.explore.personPage(cursor as string | undefined, signal)
      nextCursor = page.nextCursor
      items = page.items.map(row => ({
        key: key('entity', row.entityId), personKey: key(id(row.linkedUserId) ? 'user' : 'entity', id(row.linkedUserId) || row.entityId),
        source, name: row.item.title, aliases: row.aliases, relation: row.item,
        accountLinked: row.linkedUserId > 0, isSelf: row.linkedUserId === session.userId,
      }))
    } else if (source === 'contacts') {
      items = await Promise.all((await this.contacts.listRecordingSpeakerUsers(session, signal)).map(async row => ({
        key: key('contact', row.userId), personKey: key('user', row.userId), source, name: row.label, aliases: row.aliases ?? [], hasRemark: !!row.remark,
        accountLinked: true, isSelf: row.userId === session.userId, ...(row.avatarRef ? { avatarRef: row.avatarRef } : {}),
        assignmentRef: await this.recording.directoryUserSpeakerRef(row.userId, session.userId),
        ...(row.userId === session.userId ? {} : { chatRef: await this.codec.seal('arkme-person-chat-v1', {
          viewer: session.userId, environment: this.runtime.config.environment, userId: row.userId, expires: Date.now() + 30 * 60_000,
        }) }),
      })))
    } else {
      const raw = await this.runtime.authenticatedAudioPost<Record<string, unknown>>('/api/v1/audio/get-speaker-ls', {}, session, signal)
      if (!Array.isArray(raw.spk_ls)) throw unavailable()
      items = await Promise.all(raw.spk_ls.map(async value => {
        const row = objectValue(value), speakerId = String(row.speaker_id ?? row.id ?? row.spk_id ?? '').trim(), userId = id(row.ref_usr_id ?? row.ref_user_id)
        if (!speakerId) throw unavailable()
        const speakerRef = await this.recording.directorySpeakerRef(speakerId, session.userId)
        return { key: key('speaker', speakerId), personKey: key(userId ? 'user' : 'speaker', userId || speakerId), source,
          name: String(row.nick_name ?? row.nickname ?? '').trim() || '未命名说话人', aliases: [],
          accountLinked: userId > 0, isSelf: userId === session.userId, speakerRef, assignmentRef: speakerRef }
      }))
    }
    signal?.throwIfAborted()
    const current = await this.runtime.requireSession()
    if (current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw unavailable()
    return { source, items, ...(nextCursor ? { nextCursor } : {}) }
  }
  async openChat(value: string, signal?: AbortSignal) {
    const session = await this.runtime.requireSession()
    const ref = await this.codec.open('arkme-person-chat-v1', value)
    if (ref.viewer !== session.userId || ref.environment !== this.runtime.config.environment || Number(ref.expires) < Date.now() || !id(ref.userId)) throw unavailable()
    const candidate = (await this.contacts.listRecordingSpeakerUsers(session, signal)).find(x => x.userId === ref.userId)
    signal?.throwIfAborted()
    const current = await this.runtime.requireSession()
    if (!candidate || current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw unavailable()
    return this.chat.openPrivateChatFromUser(candidate.userId, { presentationDisplayName: candidate.label, ...(signal ? { signal } : {}) })
  }
}
