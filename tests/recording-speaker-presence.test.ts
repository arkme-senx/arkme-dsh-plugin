import { describe, expect, it } from 'vitest'
import { projectRecentSpeakerDetails, projectRecentSpeakerPresence } from '../src/recording-speaker-presence.js'

describe('recent speaker presence fallback', () => {
  it('lists only source identities verified on spoken segments and unions same-person tracks', () => {
    const firstDay = new Date(2026, 8, 20).getTime()
    const secondDay = new Date(2026, 8, 21).getTime()
    const details = projectRecentSpeakerDetails([
      { id: 'formal-a', ref_usr_id: 77 }, { id: 'formal-b', ref_usr_id: 77 },
    ], [
      { dateStamp: firstDay, response: {
        session_ls: [{ id: 'first', user_id: 42, start_at: firstDay, spk_ls: [
          { num: 1, spk_id: 'formal-a', inner_spk_id: 'inner-1', speaker_display_number: 12 },
          { num: 2, spk_id: 'formal-b', inner_spk_id: 'inner-2', speaker_display_number: 14 },
          { num: 3, spk_id: 'formal-a', inner_spk_id: 'inner-silent', speaker_display_number: 15 },
        ] }],
        child_ls: [{ session_id: 'first', start_at: 0, asr: [
          { n: 1, s: 100, e: 200 }, { n: 2, s: 300, e: 400 },
        ] }],
      } },
      { dateStamp: secondDay, response: {
        session_ls: [{ id: 'second', user_id: 42, start_at: secondDay, spk_ls: [
          { num: 1, spk_id: 'formal-b', inner_spk_id: 'inner-1', speaker_display_number: 12 },
        ] }],
        child_ls: [{ session_id: 'second', start_at: 0, asr: [{ n: 1, s: 100, e: 300 }] }],
      } },
    ], 42)
    expect(details).toHaveLength(2)
    expect(details[0]).toEqual({ speakerId: 'formal-a', dayCount: 2, lastSeenAt: secondDay + 300, members: [
      { identityKey: 'number:12', token: '12', dayCount: 2, lastSeenAt: secondDay + 300 },
      { identityKey: 'number:14', token: '14', dayCount: 1, lastSeenAt: firstDay + 400 },
    ] })
    expect(details[1]?.members).toEqual(details[0]?.members)
  })

  it('keeps distinct legacy letter identities separate and does not invent a source for manual-only speech', () => {
    const day = new Date(2026, 8, 20).getTime()
    const [detail] = projectRecentSpeakerDetails([{ id: 'formal' }], [{ dateStamp: day, response: {
      session_ls: [{ id: 's', user_id: 42, start_at: day, spk_ls: [
        { num: 1, spk_id: 'formal', inner_spk_id: 'inner-a', label: 'A' },
        { num: 2, spk_id: 'formal', inner_spk_id: 'inner-b', label: 'A' },
      ] }],
      child_ls: [{ session_id: 's', start_at: 0, asr: [
        { n: 1, s: 100, e: 200 }, { n: 2, s: 300, e: 400 },
        { n: -1, q: 'formal', s: 500, e: 600 },
      ] }],
    } }], 42)
    expect(detail?.members).toEqual([
      { identityKey: 'inner:inner-b', token: 'A', dayCount: 1, lastSeenAt: day + 400 },
      { identityKey: 'inner:inner-a', token: 'A', dayCount: 1, lastSeenAt: day + 200 },
    ])
  })

  it('unions multiple tracks of one person by day and keeps same-name strangers separate', () => {
    const firstDay = new Date(2026, 8, 20).getTime()
    const secondDay = new Date(2026, 8, 21).getTime()
    const speakers = [
      { id: 'a', nick_name: '周鹏', ref_usr_id: 77 },
      { id: 'b', nick_name: '周鹏', ref_usr_id: 77 },
      { id: 'other', nick_name: '周鹏', ref_usr_id: 0 },
    ]
    const stats = projectRecentSpeakerPresence(speakers, [
      { dateStamp: firstDay, response: {
        session_ls: [
          { id: 'own', user_id: 42, start_at: firstDay, spk_ls: [{ num: 1, spk_id: 'a' }, { num: 2, spk_id: 'b' }, { num: 3, spk_id: 'other' }] },
          { id: 'foreign', user_id: 43, start_at: firstDay, spk_ls: [{ num: 1, spk_id: 'a' }] },
        ],
        child_ls: [
          { session_id: 'own', start_at: 0, asr: [
            { n: 1, s: 100, e: 200, t: '' },
            { n: 2, s: 300, e: 500 },
            { n: 3, s: 600, e: 700 },
            { n: 1, s: 800, e: 900, q_unassigned_spk_id: 'a' },
            { n: 1, s: 1000, e: 1100, speaker_identity_source: 'system' },
          ] },
          { session_id: 'foreign', start_at: 0, asr: [{ n: 1, s: 1200, e: 1300 }] },
        ],
      } },
      { dateStamp: secondDay, response: {
        session_ls: [{ id: 'next', user_id: 42, start_at: secondDay, spk_ls: [{ num: 1, spk_id: 'b' }] }],
        child_ls: [{ session_id: 'next', start_at: 0, asr: [{ n: 1, s: 100, e: 400, effective_spk_id: 'b', speaker_identity_source: 'session' }] }],
      } },
    ], 42)
    expect(stats).toEqual([
      { speakerId: 'a', dayCount: 2, lastSeenAt: secondDay + 400 },
      { speakerId: 'b', dayCount: 2, lastSeenAt: secondDay + 400 },
      { speakerId: 'other', dayCount: 1, lastSeenAt: firstDay + 700 },
    ])
  })

  it('ignores a segment outside the requested day and an identity removed by the server', () => {
    const day = new Date(2026, 8, 20).getTime()
    expect(projectRecentSpeakerPresence([{ id: 'a' }], [{ dateStamp: day, response: {
      session_ls: [{ id: 's', user_id: 42, start_at: day, spk_ls: [{ num: 1, spk_id: 'a' }] }],
      child_ls: [{ session_id: 's', start_at: 0, asr: [
        { n: 1, s: -100, e: 100 },
        { n: 1, s: 100, e: 200, speaker_identity_source: 'system' },
      ] }],
    } }], 42)).toEqual([])
  })
})
