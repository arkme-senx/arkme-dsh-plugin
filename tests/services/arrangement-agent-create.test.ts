import { expect, it, vi } from 'vitest'
import { ArrangementService } from '../../src/services/arrangement-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../../src/services/service.js'

const due = Date.parse('2026-11-20T07:32:00Z')
const receipt = { uid: 'req-1', title: '喝水', description: '', due_at: due, remind_at: due, reminder_enabled: true, reminder_state: 'pending' }

function setup() {
  const post = vi.fn(async (..._args: unknown[]): Promise<unknown> => receipt)
  const service = new ArrangementService({ requireSession: async () => ({ userId: 42 }), stateStore: { uniqueCode: async () => 'device' }, authenticatedIntelligentPost: post } as unknown as ServiceRuntime)
  return { service, post }
}

it('creates the exact Agent arrangement with the owner\'s Agent source and a stable UID', async () => {
  const { service, post } = setup()
  const result = await service.createAgentArrangement({ requestId: 'req-1', title: ' 喝水 ', dueAtMillis: due })
  expect(post).toHaveBeenCalledTimes(1)
  expect(post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/v1/arrangements/create', {
    uid: 'req-1', title: '喝水', description: '', topic_uid: '', source_type: 4, record_uids: [], due_at: due,
  }])
  expect(post.mock.calls[0]?.[1]).not.toHaveProperty('source')
  expect(result).toEqual({ arrangementRef: expect.stringMatching(/^arkme-arrangement-v1\./), title: '喝水', description: '', dueAtMillis: due, remindAtMillis: due, reminderEnabled: true, reminderState: 'pending' })
})

it('sends an explicit empty time for an undated arrangement', async () => {
  const { service, post } = setup()
  post.mockResolvedValueOnce({ uid: 'req-2', title: '整理书架', description: '周末', due_at: 0, reminder_enabled: false, reminder_state: 'disabled' })
  const result = await service.createAgentArrangement({ requestId: 'req-2', title: '整理书架', description: '周末' })
  expect(post.mock.calls[0]?.[1]).toMatchObject({ due_at: 0, description: '周末' })
  expect(result).not.toHaveProperty('dueAtMillis')
  expect(result).toMatchObject({ reminderEnabled: false, reminderState: 'disabled' })
})

it.each([
  { requestId: 'bad id', title: '喝水' },
  { requestId: 'req-1', title: '  ' },
  { requestId: 'req-1', title: 'a'.repeat(201) },
  { requestId: 'req-1', title: '喝水', description: 'a'.repeat(2001) },
  { requestId: 'req-1', title: '喝水', dueAtMillis: -1 },
  { requestId: 'req-1', title: '喝水', dueAtMillis: 1.5 },
])('rejects invalid input before any write: %j', async input => {
  const { service, post } = setup()
  await expect(service.createAgentArrangement(input)).rejects.toMatchObject({ code: 'arrangement-create-invalid' })
  expect(post).not.toHaveBeenCalled()
})

it('does not report a replayed owner row with different content as this command', async () => {
  const { service, post } = setup()
  post.mockResolvedValueOnce({ ...receipt, title: '喝茶' })
  await expect(service.createAgentArrangement({ requestId: 'req-1', title: '喝水', dueAtMillis: due })).rejects.toMatchObject({ code: 'arrangement-create-uncertain' })
})

it('reconciles an uncertain create through the stable UID instead of replaying it', async () => {
  const { service, post } = setup()
  post.mockRejectedValueOnce(new ArkmePluginError('arkme-network', 'timeout', true, 504))
  post.mockResolvedValueOnce({ list: [receipt], total: 1 })
  const result = await service.createAgentArrangement({ requestId: 'req-1', title: '喝水', dueAtMillis: due })
  expect(post).toHaveBeenCalledTimes(2)
  expect(post.mock.calls[1]?.slice(0, 2)).toEqual(['/api/v1/arrangements/list', { status: -1, uids: ['req-1'], limit: 1, offset: 0 }])
  expect(result.reminderState).toBe('pending')
})

it('keeps the original failure when the uncertain create did not land', async () => {
  const { service, post } = setup()
  const failure = new ArkmePluginError('arkme-network', 'timeout', true, 504)
  post.mockRejectedValueOnce(failure)
  post.mockResolvedValueOnce({ list: [], total: 0 })
  await expect(service.createAgentArrangement({ requestId: 'req-1', title: '喝水', dueAtMillis: due })).rejects.toBe(failure)
  expect(post.mock.calls.filter(call => call[0] === '/api/v1/arrangements/create')).toHaveLength(1)
})

it('does not reconcile a definite rejection', async () => {
  const { service, post } = setup()
  post.mockRejectedValueOnce(new ArkmePluginError('arkme-invalid', 'invalid', false, 400))
  await expect(service.createAgentArrangement({ requestId: 'req-1', title: '喝水', dueAtMillis: due })).rejects.toMatchObject({ code: 'arkme-invalid' })
  expect(post).toHaveBeenCalledTimes(1)
})
