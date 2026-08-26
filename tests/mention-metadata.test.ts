import { describe, expect, it } from 'vitest'
import { arkmeMentionMetadataMentionsViewer } from '../src/mention-metadata.js'

describe('mention metadata projection', () => {
  it('recognizes only explicit all or viewer mention targets', () => {
    const payload = (humanMentions: unknown[]) => ({ mention_metadata: { human_mentions: humanMentions } })

    expect(arkmeMentionMetadataMentionsViewer({}, payload([{ user_id: 0 }]), 10001)).toBe(true)
    expect(arkmeMentionMetadataMentionsViewer({}, payload([{ user_id: 10001 }]), 10001)).toBe(true)
    expect(arkmeMentionMetadataMentionsViewer({}, payload([{ user_id: 20002 }]), 10001)).toBe(false)
  })

  it('does not turn missing or malformed user ids into an all mention', () => {
    const payload = {
      mention_metadata: {
        human_mentions: [{ display_name_snapshot: '所有人' }, { user_id: 'invalid' }],
      },
    }

    expect(arkmeMentionMetadataMentionsViewer({}, payload, 10001)).toBe(false)
  })
})
