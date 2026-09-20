import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => mocks)
import { recordTopicAssignmentPort as port } from '../src/client/record-topic-assignment-port.js'
afterEach(() => { vi.restoreAllMocks(); mocks.callArkme.mockReset() })
describe('record topic assignment transport adapter', () => {
  it('passes server search and pagination while filtering aggregate entries', async () => {
    mocks.callArkme.mockResolvedValue({ items: [{ kind: 'send_to_self' }, { kind: 'topic', sourceRef: 't', topicHierarchyKey: 'stable-t' }], hasMore: true, nextCursor: 'next' })
    const page = await port.listTopics('工作', 'cursor', new AbortController().signal)
    expect(mocks.callArkme).toHaveBeenCalledWith('topic.candidates', {
      keyword: '工作', cursor: 'cursor',
    }, expect.any(AbortSignal))
    expect(page).toEqual({ items: [{ kind: 'topic', sourceRef: 't', topicHierarchyKey: 'stable-t' }], hasMore: true, nextCursor: 'next' })
  })
  it('rejects selectable topics that lack stable identity rather than treating sourceRef as identity', async () => {
    mocks.callArkme.mockResolvedValue({ items: [{ kind: 'topic', sourceRef: 'capability-only' }], hasMore: false })
    await expect(port.listTopics('', undefined, new AbortController().signal)).rejects.toThrow('身份信息不完整')
  })
  it('binds new-topic creation to its originating account source', async () => {
    mocks.callArkme.mockResolvedValue({ source: { sourceRef: 'created' } })
    await port.createTopic('标题', 'signed-self', new AbortController().signal)
    expect(mocks.callArkme).toHaveBeenCalledWith('topic.create', { title: '标题', contextSourceRef: 'signed-self' }, expect.any(AbortSignal))
  })
  it('bounds transport waits and never retries an unknown write', async () => {
    const deadline = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    mocks.callArkme.mockImplementation((_op, _params, signal: AbortSignal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const pending = port.assign({ sourceRef: 'self', assignmentRefs: ['r'], targetSourceRef: 't' }, new AbortController().signal)
    deadline.abort(new DOMException('Timeout', 'TimeoutError'))
    await expect(pending).rejects.toThrow('请求超时')
    expect(mocks.callArkme).toHaveBeenCalledOnce()
  })
  it('propagates scope cancellation to transport', async () => {
    const scope = new AbortController()
    mocks.callArkme.mockImplementation((_op, _params, signal: AbortSignal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const pending = port.listTopics('', undefined, scope.signal)
    scope.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
