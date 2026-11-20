import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { arkmeToolCatalog, createArkmeCoreToolDefinitions, promptForArkmeToolProfile, stableUidForToolCall } from '../../src/tools/index.js'

const now = Date.parse('2026-11-20T07:30:15Z')

function setup() {
  const createAgentArrangement = vi.fn(async (input: { requestId: string; title: string; description?: string; dueAtMillis?: number }) => ({
    arrangementRef: 'arkme-arrangement-v1.ref', title: input.title.trim(), description: input.description?.trim() ?? '',
    ...(input.dueAtMillis === undefined ? { reminderEnabled: false, reminderState: 'disabled' } : { dueAtMillis: input.dueAtMillis, remindAtMillis: input.dueAtMillis, reminderEnabled: true, reminderState: 'pending' }),
  }))
  const tool = createArkmeCoreToolDefinitions({ createAgentArrangement } as never).find(definition => definition.name === 'arkme_arrangement_create')!
  return { tool, createAgentArrangement }
}

const originalTimeZone = process.env.TZ
beforeEach(() => {
  process.env.TZ = 'Asia/Shanghai'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})
afterEach(() => {
  vi.useRealTimers()
  if (originalTimeZone === undefined) delete process.env.TZ
  else process.env.TZ = originalTimeZone
})

it('is a business write tool with explicit-user-write ownership', () => {
  expect(arkmeToolCatalog.modules.find(module => module.meta.toolName === 'arkme_arrangement_create')?.meta)
    .toMatchObject({ kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] })
  expect(arkmeToolCatalog.toolNamesFor('atomic')).not.toContain('arkme_arrangement_create')
})

it('turns "in 2 minutes" into one timed arrangement keyed by the tool call', async () => {
  const { tool, createAgentArrangement } = setup()
  const signal = new AbortController().signal
  const output = String(await tool.execute({ title: '喝水', after_seconds: 120 }, { callId: 'call-1', signal } as never))
  expect(createAgentArrangement).toHaveBeenCalledWith({ requestId: stableUidForToolCall('arrangement', 'call-1'), title: '喝水', dueAtMillis: now + 120_000 }, signal)
  const result = JSON.parse(output.split('<data_from_arkme>')[1]!.split('</data_from_arkme>')[0]!)
  expect(result).toEqual({ arrangement_created: true, title: '喝水', due_time: '2026-11-20 15:32', time_zone: 'Asia/Shanghai', phone_reminder: 'scheduled', reminder_time: '2026-11-20 15:32' })
})

it('resolves an absolute local time in the computer zone by default', async () => {
  const { tool, createAgentArrangement } = setup()
  await tool.execute({ title: '开会', description: '带电脑', at: { date: '2026-11-21', time: '09:00' } }, { callId: 'call-2' } as never)
  expect(createAgentArrangement.mock.calls[0]?.[0]).toMatchObject({ title: '开会', description: '带电脑', dueAtMillis: Date.parse('2026-11-21T01:00:00Z') })
})

it('saves an undated arrangement without claiming a reminder', async () => {
  const { tool } = setup()
  const output = String(await tool.execute({ title: '整理书架' }, { callId: 'call-3' } as never))
  expect(output).toContain('"phone_reminder": "none"')
  expect(output).toContain('"due_time": null')
})

it('reports an owner that did not arm the push', async () => {
  const { tool, createAgentArrangement } = setup()
  createAgentArrangement.mockResolvedValueOnce({ arrangementRef: 'r', title: '喝水', description: '', dueAtMillis: now + 120_000, reminderEnabled: false, reminderState: 'disabled' } as never)
  const output = String(await tool.execute({ title: '喝水', after_seconds: 120 }, { callId: 'call-4' } as never))
  expect(output).toContain('"phone_reminder": "not_scheduled"')
  expect(output).toContain('"reminder_state": "disabled"')
})

it.each([
  [{ title: '喝水', at: { date: '2026-11-20', time: '09:00' } }, 'due_time_past'],
  [{ title: '喝水', after_seconds: 60, at: '2026-11-20T16:00:00+08:00' }, 'invalid_due_time'],
  [{ title: '喝水', at: '2026-11-20 16:00' }, 'invalid_due_time'],
])('rejects %j before any write', async (args, code) => {
  const { tool, createAgentArrangement } = setup()
  await expect(tool.execute(args as never, { callId: 'call-5' } as never)).rejects.toThrow(code)
  expect(createAgentArrangement).not.toHaveBeenCalled()
})

it('tells the model to prefer the arrangement over session-local schedule_create and not to fake recurrence', () => {
  const prompt = promptForArkmeToolProfile('business')
  expect(prompt).toContain('use arkme_arrangement_create instead of schedule_create')
  expect(prompt).toContain('Recurring reminders are not supported')
  const { tool } = setup()
  expect(tool.description).toContain('even when this computer is off')
  expect(tool.description).toContain('Recurring reminders are not supported')
})
