import { describe, expect, it, vi } from 'vitest'
import { PeopleService } from '../src/services/people-service.js'
import { combinePeople, personMatches, type PersonFacet } from '../src/people-contract.js'
import type { ServiceRuntime } from '../src/services/service.js'

function fixture() {
  let userId = 11
  const session = () => ({ userId, refreshToken: 'test' })
  const contacts = { listRecordingSpeakerUsers: vi.fn(async () => [{ userId: 27, label: '我的备注', remark: '我的备注', avatarRef: 'avatar' }]) }
  const explore = { personEntries: vi.fn(async () => [{ entityId: 'entity-a', linkedUserId: 27, aliases: ['宏顺'], item: { key: 'entity-a-key', ref: 'entity-ref', title: '何宏顺', category: '人物', date: 1, summary: '', status: '' } },
    { entityId: 'entity-b', linkedUserId: 0, aliases: [], item: { key: 'entity-b-key', ref: 'entity-b-ref', title: '我的备注', category: '人物', date: 0, summary: '', status: '' } }]) }
  const audio = vi.fn(async () => ({ spk_ls: [{ id: 'speaker-a', ref_usr_id: 27, nick_name: '以前的昵称' }, { id: 'speaker-b', ref_usr_id: 0, user_id: 11, nick_name: '我的备注' }] }))
  const runtime = { config: { environment: 'prod' }, stateStore: { uniqueCode: async () => 'test-people-key' }, requireSession: async () => session(), authenticatedAudioPost: audio } as unknown as ServiceRuntime
  const recording = { directorySpeakerRef: vi.fn(async () => 'speaker-ref'), directoryUserSpeakerRef: vi.fn(async () => 'user-ref') }
  const chat = { openPrivateChatFromUser: vi.fn(async () => ({ source: { sourceRef: 'chat' } })) }
  const service = new PeopleService(runtime, explore, recording, contacts, chat as never)
  return { service, contacts, explore, audio, chat, switchAccount: () => { userId = 22 } }
}

describe('unified people identity projection', () => {
  it('joins only matching stable account facts and preserves unrelated same-name people', async () => {
    const f = fixture()
    const pages = await Promise.all(['relations', 'contacts', 'speakers'].map(source => f.service.list(source)))
    const people = combinePeople(pages.flatMap(x => x.items))
    expect(people).toHaveLength(3)
    const linked = people.find(x => x.facets.length === 3)!
    expect(linked.name).toBe('我的备注'); expect(linked.aliases).toContain('宏顺')
    expect(personMatches(linked, '以前的昵称')).toBe(true)
    expect(linked.sources).toEqual(['relations', 'contacts', 'speakers'])
    expect(people.filter(x => x.name === '我的备注')).toHaveLength(3)
    expect(pages[2]!.items[1]!.isSelf).toBe(false) // owner user_id is not the speaker's identity
    expect(JSON.stringify(pages)).not.toContain('speaker-a')
    expect(JSON.stringify(pages)).not.toContain('ref_usr_id')
    expect(f.chat.openPrivateChatFromUser).not.toHaveBeenCalled()
  })
  it('uses the same group key regardless of source arrival order and deduplicates repeated facets', async () => {
    const f = fixture(), a = await f.service.list('relations'), b = await f.service.list('contacts')
    expect(combinePeople([...a.items, ...b.items, ...a.items])).toEqual(combinePeople([...b.items, ...a.items]))
  })
  it('revalidates contact membership and rejects tampered and cross-account chat references', async () => {
    const f = fixture(), page = await f.service.list('contacts'), ref = page.items[0]!.chatRef!
    await expect(f.service.openChat(ref + 'tamper')).rejects.toThrow()
    await f.service.openChat(ref)
    expect(f.chat.openPrivateChatFromUser).toHaveBeenCalledWith(27, { presentationDisplayName: '我的备注' })
    f.contacts.listRecordingSpeakerUsers.mockResolvedValueOnce([])
    await expect(f.service.openChat(ref)).rejects.toThrow()
    f.switchAccount()
    await expect(f.service.openChat(ref)).rejects.toThrow()
    expect(f.chat.openPrivateChatFromUser).toHaveBeenCalledTimes(1)
  })
  it('rejects a response after account switch and rejects unknown source kinds', async () => {
    const f = fixture()
    f.audio.mockImplementationOnce(async () => { f.switchAccount(); return { spk_ls: [] } })
    await expect(f.service.list('speakers')).rejects.toThrow()
    await expect(f.service.list('all')).rejects.toThrow()
  })
})
