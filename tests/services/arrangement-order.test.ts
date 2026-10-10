import { expect, it, vi } from 'vitest'
import { ArrangementService } from '../../src/services/arrangement-service.js'
import { ServiceRuntime, ArkmePluginError } from '../../src/services/service.js'

function setup() {
  let user = 42
  const post = vi.fn(async (_path: string, _body: unknown) => ({ list: [{ uid: 'a', title: 'A', status: 1 }, { uid: 'b', title: 'B', status: 1 }], total: 2, board: { supported: true, version: 'v1' } }))
  const runtime = { requireSession: async () => ({ userId: user }), stateStore: { uniqueCode: async () => 'device' }, authenticatedIntelligentPost: post } as unknown as ServiceRuntime
  return { service: new ArrangementService(runtime), post, switchUser: () => { user = 43 } }
}
it('projects versioned board pages and resolves opaque reorder anchors', async () => {
  const { service, post } = setup()
  const page = await service.listArrangements({ status: 'identified', order: 'board', boardVersion: 'v1' })
  expect(page.board).toEqual({ supported: true, version: 'v1' })
  expect(post.mock.calls[0]?.[1]).toMatchObject({ order: 'board', board_version: 'v1' })
  await service.reorderArrangement({ arrangementRef: page.items[1]!.arrangementRef, status: 'identified', beforeRef: page.items[0]!.arrangementRef, boardVersion: 'v1', requestId: 'move-1' })
  expect(post.mock.calls[1]).toEqual(expect.arrayContaining(['/api/v1/arrangements/reorder', { uid: 'b', status: 1, before_uid: 'a', board_version: 'v1', request_id: 'move-1' }]))
})
it('does not infer support on an old backend and fails closed on malformed versions', async () => {
  const { service, post } = setup()
  post.mockResolvedValueOnce({ list: [], total: 0 } as never)
  expect((await service.listArrangements({ status: 'identified', order: 'board' })).board).toEqual({ supported: false, version: '' })
  post.mockResolvedValueOnce({ list: [], total: 0, board: { supported: true, version: '' } })
  await expect(service.listArrangements({ status: 'identified', order: 'board' })).rejects.toThrow()
})
it('rejects reorder anchors from a different account before writing', async () => {
  const { service, post, switchUser } = setup()
  const page = await service.listArrangements()
  switchUser()
  await expect(service.reorderArrangement({ arrangementRef: page.items[0]!.arrangementRef, status: 'identified', boardVersion: 'v1', requestId: 'move-1' })).rejects.toThrow()
  expect(post).toHaveBeenCalledTimes(1)
})
it('requires a board version and request id and does not retry ambiguous writes', async () => {
  const { service, post } = setup()
  const page = await service.listArrangements()
  const input = { arrangementRef: page.items[0]!.arrangementRef, status: 'identified' as const, boardVersion: 'v1', requestId: 'move-1' }
  await expect(service.reorderArrangement({ ...input, boardVersion: '' })).rejects.toThrow()
  post.mockRejectedValueOnce(new Error('connection closed'))
  await expect(service.reorderArrangement(input)).rejects.toThrow('connection closed')
  expect(post).toHaveBeenCalledTimes(2)
})

it('normalizes board conflicts and falls back to readable legacy pages on capacity limits', async () => {
  const { service, post } = setup()
  post.mockRejectedValueOnce(new ArkmePluginError('arkme-http-error', 'HTTP409', false, 502, { upstreamStatus: 409 }))
  await expect(service.listArrangements({ status: 'identified', order: 'board' })).rejects.toMatchObject({ code: 'arrangement-board-conflict', httpStatus: 409 })
  post.mockRejectedValueOnce(new ArkmePluginError('arkme-http-error', 'HTTP422', false, 502, { upstreamStatus: 422 }))
  const page = await service.listArrangements({ status: 'identified', order: 'board' })
  expect(page.items).toHaveLength(2)
  expect(page.board).toEqual({ supported: false, version: '' })
  expect(post.mock.calls.at(-1)?.[1]).not.toHaveProperty('order')
})
