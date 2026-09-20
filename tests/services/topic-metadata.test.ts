import { describe, expect, it, vi } from 'vitest'
import { readTopicMetadata } from '../../src/services/topic-metadata.js'
import type { ServiceRuntime } from '../../src/services/service.js'

const session = { userId: 42, accessToken: 'test-access', refreshToken: 'test-refresh' }

describe('topic metadata transport', () => {
  it('reads identity and settings without records or statistics', async () => {
    const authenticatedPost = vi.fn().mockResolvedValue({ topic_core: {
      topic_uid: 'topic', kind: 3, privacy_state: 1, show_in_home: false,
    } })
    const signal = new AbortController().signal
    await expect(readTopicMetadata(
      { authenticatedPost } as unknown as ServiceRuntime, session, 'topic', signal,
    )).resolves.toEqual({ topicKind: 3, privacyState: 1, showInHome: false })
    expect(authenticatedPost).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/topics/display/metadata', { topic_uid: 'topic' }, session, signal,
    )
  })

  it.each([
    {},
    { topic_core: { topic_uid: 'other', kind: 1, privacy_state: 1, show_in_home: true } },
    { topic_core: { topic_uid: 'topic', kind: 0, privacy_state: 1, show_in_home: true } },
    { topic_core: { topic_uid: 'topic', kind: 1, privacy_state: 9, show_in_home: true } },
    { topic_core: { topic_uid: 'topic', kind: 1, privacy_state: 1 } },
  ])('fails closed for malformed metadata %#', async response => {
    const runtime = { authenticatedPost: vi.fn().mockResolvedValue(response) } as unknown as ServiceRuntime
    await expect(readTopicMetadata(runtime, session, 'topic')).rejects.toMatchObject({ code: 'topic-metadata-invalid' })
  })
})
