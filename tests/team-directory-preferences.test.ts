// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import type { TeamConversation } from '../src/team-app-contract.js'
import { TeamDirectoryPreferenceStore, teamConversationEntryKey, teamEntryHidden, teamEntryPinned, type TeamEntryTarget } from '../src/client/team-directory-preferences.js'
import { groupTeamConversations, mergeTeamDirectoryRows } from '../src/client/team-conversation-directory.js'

const channel = { teamRef: 'signed', name: '团队', jotmoId: 'team', publicRef: '', link: '', enabled: true, revision: 1, canManage: false }
const conversation: TeamConversation = { ref: 'signed-message-ref', key: 'a', channel, side: 'team', lastSeq: 4, latestTeamReplySeq: 0, myReadSeq: 0, unread: 4, needsReply: true, blocked: false, revision: 1, updatedAt: 10 }
const direct = (c = conversation): TeamEntryTarget => ({ kind: 'conversation', conversation: c })
const folder = (items = [conversation]): TeamEntryTarget => ({ kind: 'folder', group: groupTeamConversations(items)[0]! })
let store: TeamDirectoryPreferenceStore
const signal = () => new AbortController().signal
beforeEach(() => { localStorage.clear(); store = new TeamDirectoryPreferenceStore(() => localStorage) })

it('persists pin and removal across restarts with account isolation, without retaining content or signed refs', () => {
  store.pin('a', folder(), true)
  store.remove('b', direct(), 100)
  const restarted = new TeamDirectoryPreferenceStore(() => localStorage)
  expect(teamEntryPinned(restarted.read('a'), folder())).toBe(true)
  expect(teamEntryHidden(restarted.read('a'), direct())).toBe(false)
  expect(teamEntryHidden(restarted.read('b'), direct())).toBe(true)
  expect(teamEntryPinned(restarted.read('b'), folder())).toBe(false)
  expect(JSON.stringify(localStorage)).not.toMatch(/signed|团队/)
})

it('pins a team above unpinned ordinary rows and removes only its presentation entry', () => {
  const ordinary = { activeAtMillis: 100, pinned: false }, pinned = { activeAtMillis: 1, pinned: true }
  store.pin('a', folder(), true)
  expect(mergeTeamDirectoryRows([pinned, ordinary], [conversation], true, store.read('a')).map(row => row.activeAtMillis)).toEqual([10, 1, 100])
  store.remove('a', folder(), 100)
  expect(mergeTeamDirectoryRows([ordinary], [conversation], true, store.read('a'))).toEqual([ordinary])
  expect(conversation.lastSeq).toBe(4)
  store.pin('a', folder(), true)
  expect(mergeTeamDirectoryRows([ordinary], [conversation], true, store.read('a'))).toHaveLength(2)
})

it('does not restore entries on receipt/metadata changes, but does on a newer message sequence', async () => {
  store.remove('a', direct(), 100); store.remove('a', folder(), 100)
  const latest = vi.fn()
  await store.reconcile('a', [{ ...conversation, revision: 2, updatedAt: 200, myReadSeq: 4, unread: 0 }], latest, signal())
  expect(teamEntryHidden(store.read('a'), direct())).toBe(true)
  expect(teamEntryHidden(store.read('a'), folder())).toBe(true)
  expect(latest).not.toHaveBeenCalled()
  await store.reconcile('a', [{ ...conversation, lastSeq: 5 }], latest, signal())
  expect(teamEntryHidden(store.read('a'), direct())).toBe(false)
  expect(teamEntryHidden(store.read('a'), folder())).toBe(false)
})

it('does not treat a newly loaded old directory page as a new message, even with newer metadata', async () => {
  store.remove('a', folder(), 100)
  const older = { ...conversation, key: 'older', updatedAt: 200 }
  const latest = vi.fn().mockResolvedValue(90)
  await store.reconcile('a', [older], latest, signal())
  expect(teamEntryHidden(store.read('a'), folder([conversation, older]))).toBe(true)
  await store.reconcile('a', [older], latest, signal())
  expect(latest).toHaveBeenCalledOnce()
  await store.reconcile('a', [{ ...older, lastSeq: 5 }], latest, signal())
  expect(teamEntryHidden(store.read('a'), folder([conversation, older]))).toBe(false)
})

it('restores a folder for an unknown visitor only after checking actual new message time', async () => {
  store.remove('a', folder(), 100)
  const visitor = { ...conversation, key: 'new', updatedAt: 200 }
  expect(teamEntryHidden(store.read('a'), folder([visitor]))).toBe(true)
  await store.reconcile('a', [visitor], async () => 150, signal())
  expect(teamEntryHidden(store.read('a'), folder([visitor]))).toBe(false)
})

it('late verification cannot undo a newer removal', async () => {
  store.remove('a', folder(), 100)
  let finish!: (time: number) => void
  const pending = store.reconcile('a', [{ ...conversation, key: 'new', updatedAt: 200 }], () => new Promise(resolve => { finish = resolve }), signal())
  store.remove('a', folder(), 300)
  finish(200); await pending
  expect(teamEntryHidden(store.read('a'), folder())).toBe(true)
})

it('keeps a hidden entry on verification failure and does not report failed persistence as success', async () => {
  store.remove('a', folder(), 100)
  await expect(store.reconcile('a', [{ ...conversation, key: 'new', updatedAt: 200 }], async () => { throw new Error('offline') }, signal())).rejects.toThrow('offline')
  expect(teamEntryHidden(store.read('a'), folder())).toBe(true)
  const broken = new TeamDirectoryPreferenceStore(() => ({ getItem: () => null, setItem: () => { throw new Error('quota') } }))
  expect(() => broken.pin('a', direct(), true)).toThrow('保存失败')
  expect(teamEntryPinned(broken.read('a'), direct())).toBe(false)
})

it('restores a removed conversation independently of other accounts and folders', () => {
  store.remove('a', direct(), 100); store.remove('a', folder(), 100); store.remove('b', direct(), 100)
  store.restore('a', teamConversationEntryKey(conversation))
  expect(teamEntryHidden(store.read('a'), direct())).toBe(false)
  expect(teamEntryHidden(store.read('a'), folder())).toBe(true)
  expect(teamEntryHidden(store.read('b'), direct())).toBe(true)
})
