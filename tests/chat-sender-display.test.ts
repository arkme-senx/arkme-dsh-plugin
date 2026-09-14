import { describe, expect, it } from 'vitest'
import { identifyTimelineSender, supplementBotProfiles, hasMissingBotProfile, botDisplayName } from '../src/chat-sender-display.js'

describe('sender display business rules without runtime', () => {
  it.each([
    ['bot_reply_253_a_source__grp_x', 1, '', { kind: 'bot', botUid: 'a' }],
    ['bot_outbound_253_a_delivery', 1, '', { kind: 'bot', botUid: 'a' }],
    ['bot_reply_a_source', 1, '', { kind: 'bot', botUid: 'a' }],
    ['253_botabc~42_1_2~3', 1, '', { kind: 'bot', botUid: 'botabc' }],
    ['bot_reply_253_a_source', 2, 'explicit', { kind: 'bot', botUid: 'explicit' }],
    ['human-record', 1, 'a', { kind: 'human' }],
    ['253_botabc~invalid', 1, '', { kind: 'human' }],
    ['bot_reply_', 1, '', { kind: 'bot', botUid: '' }],
    ['record', 2, '', { kind: 'bot', botUid: '' }],
  ] as const)('classifies %s using identity evidence', (recordUid, actorKind, botUid, expected) => {
    expect(identifyTimelineSender({ recordUid, actorKind, botUid })).toEqual(expected)
  })
  it('only fills missing names, preserving avatars and the input profiles', () => {
    const profiles = new Map([
      ['a', { displayName: 'Current', avatarUrl: 'a.png' }],
      ['b', { displayName: '', avatarUrl: 'b.png' }],
    ])
    const ids = new Set(['a', 'b', 'c'])
    const result = supplementBotProfiles(profiles, ids, new Map([['a', { displayName: 'Directory', avatarUrl: 'different.png' }], ['b', { displayName: 'Name B' }], ['foreign', { displayName: 'Foreign' }]]))
    expect([...result]).toEqual([['a', { displayName: 'Current', avatarUrl: 'a.png' }], ['b', { displayName: 'Name B', avatarUrl: 'b.png' }]])
    expect(profiles.get('b')?.displayName).toBe('')
    expect(hasMissingBotProfile(ids, result)).toBe(true)
    expect(botDisplayName(result, 'c')).toBe('Bot')
    expect(botDisplayName(result, 'a')).toBe('Current')
    expect(hasMissingBotProfile(new Set(['a', 'b']), result)).toBe(false)
  })
})
