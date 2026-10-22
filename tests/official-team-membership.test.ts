// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { TeamConversation, TeamOfficialMembership } from '../src/team-app-contract.js'
const call = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
import { readOfficialTeamMembership, refreshOfficialTeamMembership, shouldShowOfficialContact, startOfficialTeamMembership } from '../src/client/official-team-membership.js'
import { invalidateTeamMessages } from '../src/client/team-messaging-events.js'
import { teamConversationEntryKey } from '../src/client/team-directory-preferences.js'

let stops: Array<() => void> = []
afterEach(() => { stops.forEach(stop => stop()); stops = []; call.mockReset(); vi.useRealTimers() })
const value = (isMember: boolean): TeamOfficialMembership => ({ jotmoId: 'official-id-from-server', isMember })

it('starts without flashing the shortcut and follows confirmed join, approval and leave events', async () => {
  call.mockResolvedValue(value(false))
  stops.push(startOfficialTeamMembership('a'))
  expect(shouldShowOfficialContact(readOfficialTeamMembership('a'), [], {})).toBe(false)
  await vi.waitFor(() => expect(readOfficialTeamMembership('a').state).toBe('ready'))
  expect(shouldShowOfficialContact(readOfficialTeamMembership('a'), [], {})).toBe(true)
  // Applying or joining an unrelated team does not establish official membership.
  invalidateTeamMessages('a')
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2))
  expect(shouldShowOfficialContact(readOfficialTeamMembership('a'), [], {})).toBe(true)
  call.mockResolvedValue(value(true)); invalidateTeamMessages('a')
  await vi.waitFor(() => expect(readOfficialTeamMembership('a').value?.isMember).toBe(true))
  expect(shouldShowOfficialContact(readOfficialTeamMembership('a'), [], {})).toBe(false)
  call.mockResolvedValue(value(false)); invalidateTeamMessages('a')
  await vi.waitFor(() => expect(readOfficialTeamMembership('a').value?.isMember).toBe(false))
  expect(shouldShowOfficialContact(readOfficialTeamMembership('a'), [], {})).toBe(true)
})

it.each([true, false])('keeps confirmed membership %s during refresh and temporary errors', async member => {
  call.mockResolvedValue(value(member)); stops.push(startOfficialTeamMembership('a'))
  await vi.waitFor(() => expect(readOfficialTeamMembership('a').state).toBe('ready'))
  const previous = readOfficialTeamMembership('a')
  call.mockRejectedValue(new Error('offline'))
  const refreshing = refreshOfficialTeamMembership('a')
  expect(readOfficialTeamMembership('a')).toBe(previous)
  await refreshing
  expect(readOfficialTeamMembership('a')).toBe(previous)
})

it('keeps a recovery entry after initial failure and refreshes on network recovery', async () => {
  call.mockRejectedValue(new Error('offline')); stops.push(startOfficialTeamMembership('a'))
  await vi.waitFor(() => expect(readOfficialTeamMembership('a').state).toBe('unavailable'))
  expect(shouldShowOfficialContact(readOfficialTeamMembership('a'), [], {})).toBe(true)
  call.mockResolvedValue(value(true)); window.dispatchEvent(new Event('online'))
  await vi.waitFor(() => expect(readOfficialTeamMembership('a').value?.isMember).toBe(true))
})

it('ignores stale results and rechecks once if membership changed during the read', async () => {
  let resolve!: (v: TeamOfficialMembership) => void
  call.mockReturnValueOnce(new Promise(ok => { resolve = ok })).mockResolvedValue(value(true))
  stops.push(startOfficialTeamMembership('a'))
  invalidateTeamMessages('a'); invalidateTeamMessages('a')
  resolve(value(false))
  await vi.waitFor(() => expect(readOfficialTeamMembership('a').value?.isMember).toBe(true))
  expect(call).toHaveBeenCalledTimes(2)
})

it('does not carry membership or late results across accounts', async () => {
  let resolve!: (v: TeamOfficialMembership) => void
  call.mockReturnValueOnce(new Promise(ok => { resolve = ok }))
  const stop = startOfficialTeamMembership('old'); stops.push(stop); stop()
  call.mockResolvedValue(value(false)); stops.push(startOfficialTeamMembership('new'))
  resolve(value(true))
  await vi.waitFor(() => expect(readOfficialTeamMembership('new').state).toBe('ready'))
  expect(readOfficialTeamMembership('new').value?.isMember).toBe(false)
  expect(readOfficialTeamMembership('old').value).toBeUndefined()
  expect(call).toHaveBeenLastCalledWith('team.app.official.membership', { expectedAccountKey: 'new' }, expect.any(AbortSignal))
})

it('reuses only a visible official conversation and restores the shortcut when that row is hidden', () => {
  const conversation = { key: 'c1', side: 'external', lastSeq: 4, channel: { jotmoId: value(false).jotmoId } } as TeamConversation
  const status = { state: 'ready' as const, value: value(false) }
  expect(shouldShowOfficialContact(status, [conversation], {})).toBe(false)
  const key = teamConversationEntryKey(conversation)
  const hidden = { [key]: { pinned: false, removal: { at: 10, sequences: { [key]: 4 } } } }
  expect(shouldShowOfficialContact(status, [conversation], hidden)).toBe(true)
  expect(shouldShowOfficialContact(status, [{ ...conversation, lastSeq: 5 }], hidden)).toBe(false)
  expect(shouldShowOfficialContact(status, [{ ...conversation, channel: { ...conversation.channel, jotmoId: 'another' } }], {})).toBe(true)
  expect(shouldShowOfficialContact({ state: 'ready', value: value(true) }, [conversation], hidden)).toBe(false)
})

it('rechecks visible pages periodically without needing a conversation or user click', async () => {
  vi.useFakeTimers(); call.mockResolvedValue(value(true)); stops.push(startOfficialTeamMembership('a'))
  await vi.advanceTimersByTimeAsync(0)
  call.mockResolvedValue(value(false))
  await vi.advanceTimersByTimeAsync(60_000)
  expect(readOfficialTeamMembership('a').value?.isMember).toBe(false)
  expect(call).toHaveBeenCalledTimes(2)
})

it('receipt-only changes do not reload official membership or disturb its confirmed shortcut', async () => {
  call.mockResolvedValue(value(true));stops.push(startOfficialTeamMembership('a'))
  await vi.waitFor(()=>expect(readOfficialTeamMembership('a').state).toBe('ready'))
  const known=readOfficialTeamMembership('a');call.mockClear()
  invalidateTeamMessages('a',true)
  await Promise.resolve()
  expect(call).not.toHaveBeenCalled()
  expect(readOfficialTeamMembership('a')).toBe(known)
  invalidateTeamMessages('a')
  await vi.waitFor(()=>expect(call).toHaveBeenCalledOnce())
})
