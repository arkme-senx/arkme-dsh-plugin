import { describe, expect, it, vi } from 'vitest'
import { readTopicRecordPage } from '../../src/services/topic-record-page.js'
import type { ServiceRuntime } from '../../src/services/service.js'

const session = { userId: 42, accessToken: 'test-access', refreshToken: 'test-refresh' }
const response = { topic_uid: 'topic', privacy_state: 1, records: [{ record_uid: 'r' }], has_more: true, next_cursor_send_at: 10, next_cursor_record_uid: 'r' }

describe('topic record page transport', () => {
  it('uses the independent page API and passes cancellation without statistics', async () => {
    const authenticatedPost = vi.fn().mockResolvedValue(response)
    const signal = new AbortController().signal
    const page = await readTopicRecordPage({ authenticatedPost } as unknown as ServiceRuntime, session, 'topic', { limit: 30, signal })
    expect(authenticatedPost).toHaveBeenCalledExactlyOnceWith('/api/v1/topics/display/records/page', { topic_uid: 'topic', limit: 30 }, session, signal)
    expect(page).toMatchObject({ hasMore: true, nextCursor: { sendAtMillis: 10, itemUid: 'r' } })
  })

  it.each([
    { ...response, topic_uid: 'other' },
    { ...response, privacy_state: undefined },
    { ...response, records: undefined },
    { ...response, records: [{}] },
    { ...response, next_cursor_record_uid: '' },
    { ...response, next_cursor_send_at: 0 },
    { ...response, has_more: undefined },
  ])('fails closed for incomplete pages before dissolution enumeration', async data => {
    const runtime = { authenticatedPost: vi.fn().mockResolvedValue(data) } as unknown as ServiceRuntime
    await expect(readTopicRecordPage(runtime, session, 'topic', { limit: 30 })).rejects.toMatchObject({ code: 'topic-record-page-invalid' })
  })

  it('retains an empty visible window cursor and rejects repeated cursors', async () => {
    const runtime = { authenticatedPost: vi.fn().mockResolvedValue({ ...response, records: [] }) } as unknown as ServiceRuntime
    await expect(readTopicRecordPage(runtime, session, 'topic', { limit: 30 })).resolves.toMatchObject({ records: [], hasMore: true })
    await expect(readTopicRecordPage(runtime, session, 'topic', { limit: 30, cursor: { sendAtMillis: 10, itemUid: 'r' } })).rejects.toMatchObject({ code: 'topic-record-page-invalid' })
  })

  it('propagates failure without falling back to the old combined endpoint', async () => {
    const error = new Error('request canceled')
    const authenticatedPost = vi.fn().mockRejectedValue(error)
    await expect(readTopicRecordPage({ authenticatedPost } as unknown as ServiceRuntime, session, 'topic', { limit: 30 })).rejects.toBe(error)
    expect(authenticatedPost).toHaveBeenCalledTimes(1)
  })
})
