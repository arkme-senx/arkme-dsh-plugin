import { expect, it, vi } from 'vitest'
import { WorldService } from '../src/services/world-service.js'
import { TimelineTokenCodec } from '../src/services/timeline-token.js'

it('opens a durable timeline reference through the public detail owner, rechecks withdrawal and isolates accounts', async () => {
  let userId = 1
  const post = vi.fn(async () => ({ record_uid: 'private-locator', user_id: 2, nick_name: '小明', text_content: '公开正文', published_at: 10 }))
  const runtime = { config: { environment: 'test', worldBaseUrl: 'https://world.test' }, stateStore: { uniqueCode: async () => 'key' }, requireSession: async () => ({ userId }), post }
  const reference = new TimelineTokenCodec('key', JSON.stringify(['test', 1])).seal('private-locator', 'world-record')
  const owner = () => new WorldService(runtime as never, {} as never, {} as never, {} as never)
  const result = await owner().readWorldRecord(reference)
  expect(result).toMatchObject({ authorName: '小明', textContent: '公开正文' })
  expect(JSON.stringify(result)).not.toContain('private-locator')
  expect(post).toHaveBeenCalledWith('https://world.test', '/api/public/v1/public-record/detail', { record_uid: 'private-locator' }, undefined, [200], undefined)
  await expect(owner().readWorldRecord(reference)).resolves.toMatchObject({ textContent: '公开正文' })
  userId = 9
  await expect(owner().readWorldRecord(reference)).rejects.toMatchObject({ code: 'chat-timeline-token-invalid' })
  expect(post).toHaveBeenCalledTimes(2)
  userId = 1
  post.mockRejectedValueOnce(new Error('已取消公开'))
  await expect(owner().readWorldRecord(reference)).rejects.toThrow('已取消公开')
  const controller = new AbortController(); controller.abort()
  await expect(owner().readWorldRecord(reference, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(post).toHaveBeenCalledTimes(3)
})
