import { describe, expect, it } from 'vitest'

import {
  contactDirectoryLetter,
  groupContactDirectoryItems,
  sortContactDirectoryItems,
  unmarkedSpeakerDisplayName,
} from '../src/contact-directory-presentation.js'
import type { ArkmeDirectoryItem, ArkmeDirectoryPage } from '../src/types.js'

type ContactDirectoryItem = Extract<ArkmeDirectoryItem, { kind: 'contact' }>

function contact(input: Partial<ContactDirectoryItem> = {}): ContactDirectoryItem {
  return {
    kind: 'contact',
    contactRef: 'arkme-directory-contact-v1.safe-ref',
    displayName: '安全联系人',
    nickname: '',
    remark: '',
    letter: '#',
    ...input,
  }
}

describe('contact directory presentation', () => {
  it('derives letters from the safe display-name priority and folds Latin letters', () => {
    expect(contactDirectoryLetter(contact({ remark: '张三', nickname: 'alice' }))).toBe('Z')
    expect(contactDirectoryLetter(contact({ nickname: 'alice' }))).toBe('A')
    expect(contactDirectoryLetter(contact({ accountName: 'bravo' }))).toBe('B')
  })

  it.each(['7号', '！你好', '😀', '   ', ''])('places non-letter contact names in #', value => {
    expect(contactDirectoryLetter(contact({ displayName: value }))).toBe('#')
  })

  it('sorts Chinese names by locale and contact refs as the final stable tie-breaker', () => {
    const items = sortContactDirectoryItems([
      contact({ contactRef: 'ref-2', remark: '张三' }),
      contact({ contactRef: 'ref-3', remark: '王五' }),
      contact({ contactRef: 'ref-1', remark: '张三' }),
    ])

    expect(items.map(item => item.contactRef)).toEqual(['ref-3', 'ref-1', 'ref-2'])
  })

  it('strictly orders opaque refs that the display collator considers equivalent', () => {
    const items = sortContactDirectoryItems([
      contact({ contactRef: 'opaque-a', remark: '同名' }),
      contact({ contactRef: 'opaque-A', remark: '同名' }),
      contact({ contactRef: 'ref-2', remark: '同名' }),
      contact({ contactRef: 'ref-02', remark: '同名' }),
    ])

    expect(items.map(item => item.contactRef)).toEqual(['opaque-A', 'opaque-a', 'ref-02', 'ref-2'])
  })

  it('groups contacts alphabetically with # after Z', () => {
    const groups = groupContactDirectoryItems([
      contact({ contactRef: 'hash', displayName: '😀' }),
      contact({ contactRef: 'z', remark: '张三' }),
      contact({ contactRef: 'a', nickname: 'alice' }),
    ])

    expect(groups.map(group => group.letter)).toEqual(['A', 'Z', '#'])
    expect(groups.map(group => group.items.map(item => item.contactRef))).toEqual([['a'], ['z'], ['hash']])
  })

  it('uses the established cross-day and single-day unmarked-speaker labels', () => {
    expect(unmarkedSpeakerDisplayName({ speakerToken: '12', firstSeenDate: '2026-08-20', lastSeenDate: '2026-08-21' }))
      .toBe('说话人 12')
    expect(unmarkedSpeakerDisplayName({ speakerToken: '12', firstSeenDate: '2026-08-20', lastSeenDate: '2026-08-20' }))
      .toBe('2026-08-20 · 当天说话人 12')
  })

  it('serializes directory projections without provider-private fields', () => {
    const fixture: ArkmeDirectoryPage = {
      section: 'contacts',
      items: [contact({ contactRef: 'arkme-directory-contact-v1.safe-ref', nickname: 'Alice' })],
      total: 1,
      hasMore: false,
    }
    const serialized = JSON.stringify(fixture)

    for (const privateField of ['user_id', 'candidate_id', 'speaker_id', 'audio_file_name', 'object_key']) {
      expect(serialized).not.toContain(privateField)
    }
  })
})
