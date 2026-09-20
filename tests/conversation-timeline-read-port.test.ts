import { beforeEach, expect, it, vi } from 'vitest'
import { conversationTimelineReadPort } from '../src/client/conversation-timeline-read-port.js'
import { callArkme } from '../src/client/api.js'

vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

it('reads through the existing timeline operation without selecting or acknowledging a conversation', async () => {
  const page = { items: [], hasMore: false }
  vi.mocked(callArkme).mockResolvedValue(page)
  const signal = new AbortController().signal
  expect(await conversationTimelineReadPort.readPage('signed-access-ref', undefined, signal)).toBe(page)
  await conversationTimelineReadPort.readPage('signed-access-ref', { beforeSequence: 40 }, signal)
  expect(vi.mocked(callArkme).mock.calls).toEqual([
    ['source.timeline', { sourceRef: 'signed-access-ref', limit: 40 }, signal],
    ['source.timeline', { sourceRef: 'signed-access-ref', limit: 40, cursor: { beforeSequence: 40 } }, signal],
  ])
})
