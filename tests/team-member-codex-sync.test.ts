import { describe, expect, it } from 'vitest'
import { readTeamMemberCodexSync } from '../src/team-member-codex-sync.js'

describe('team member Codex sync contract', () => {
  it.each([undefined, null])('does not turn absent data into an unconnected member: %s', value => {
    expect(readTeamMemberCodexSync(value)).toEqual({ state: 'unavailable', reason: 'unsupported' })
  })
  it.each([
    {}, [], false, { version: 2, state: 'not_connected' },
    { version: 1, state: 'enabled', has_conversations: 0, can_view_conversations: 'true' },
    { version: 1, state: 'not_connected', has_conversations: true, can_view_conversations: false },
    { version: 1, state: 'not_connected', has_conversations: false, can_view_conversations: true },
    { version: 1, state: 'other', has_conversations: false, can_view_conversations: false },
  ])('isolates malformed optional state without breaking the member directory: %j', value => {
    expect(readTeamMemberCodexSync(value)).toEqual({ state: 'unavailable', reason: 'invalid' })
  })
  it('requires explicit negative evidence and keeps connection separate from read permission', () => {
    expect(readTeamMemberCodexSync({ version: 1, state: 'not_connected', has_conversations: false, can_view_conversations: false }))
      .toEqual({ state: 'not_connected', hasConversations: false, canViewConversations: false })
    expect(readTeamMemberCodexSync({ version: 1, state: 'enabled', has_conversations: false, can_view_conversations: true, secret: 'discard' }))
      .toEqual({ state: 'enabled', hasConversations: false, canViewConversations: true })
    expect(readTeamMemberCodexSync({ version: 1, state: 'paused', has_conversations: true, can_view_conversations: true }))
      .toEqual({ state: 'paused', hasConversations: true, canViewConversations: true })
    expect(readTeamMemberCodexSync({ version: 1, state: 'unavailable' })).toEqual({ state: 'unavailable', reason: 'failed' })
  })
})
