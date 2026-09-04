import { CallId } from '@deepseek-ai/dsh-llm'
import { appendToolResult, sessionEvents } from '../helpers/tool-session.js'
import { describe, expect, it, vi } from 'vitest'
import {
  ArkmeConversationalConfirmation,
} from '../../src/tools/shared/conversational-confirmation.js'

function conversationFixture(options: ConstructorParameters<typeof ArkmeConversationalConfirmation>[0] = {}) {
  const conversation = new ArkmeConversationalConfirmation(options)
  let count = 0
  return {
    async prepareOrExecute<Result, PreparedContext = undefined>(
      input: Omit<Parameters<typeof conversation.prepareOrExecute<Result, PreparedContext>>[0], 'callId' | 'rootCallId'>,
    ) {
      const rootCallId = CallId(`confirmation-${++count}`)
      const result = await conversation.prepareOrExecute({ ...input, callId: rootCallId, rootCallId })
      appendToolResult(input.agent.session.events as unknown as Array<Record<string, unknown>>, rootCallId, result)
      return result
    },
  }
}

function agent(events: Array<Record<string, unknown>>) {
  return { id: 'session-1', session: { events } } as never
}

describe('Arkme conversational confirmation', () => {
  it.each(['pending', 'completed', 'no-question'] as const)('preserves a newer operation when a delayed preparation returns (%s)', async scenario => {
    const events = sessionEvents()
    const current = agent(events)
    const conversation = conversationFixture()
    let release!: () => void
    const ready = new Promise<void>(resolve => { release = resolve })
    const staleExecute = vi.fn()
    const delayed = conversation.prepareOrExecute({
      agent: current, operationKey: 'folder', arguments: {}, prepare: async () => { await ready },
      question: () => scenario === 'no-question' ? undefined : '上传？', execute: staleExecute,
    }).then(value => ({ value }), error => ({ error }))
    const execute = vi.fn(async () => 'saved')
    const other = { agent: current, operationKey: 'record', arguments: {}, question: '保存？', execute }
    try {
      await expect(conversation.prepareOrExecute(other)).resolves.toMatchObject({ question: '保存？' })
      if (scenario === 'completed') {
        events.push({ seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [] } })
        await expect(conversation.prepareOrExecute(other)).resolves.toBe('saved')
      }
    } finally { release() }
    expect(await delayed).toMatchObject({ error: expect.objectContaining({ message: expect.stringMatching(/已变化/) }) })
    expect(staleExecute).not.toHaveBeenCalled()
    if (scenario !== 'completed') {
      events.push({ seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [] } })
      await expect(conversation.prepareOrExecute(other)).resolves.toBe('saved')
    }
    expect(execute).toHaveBeenCalledOnce()
  })

  it('does not publish a preparation after the user cancels or changes the request', async () => {
    const events = sessionEvents()
    const conversation = conversationFixture()
    let release!: () => void
    const ready = new Promise<void>(resolve => { release = resolve })
    const delayed = conversation.prepareOrExecute({
      agent: agent(events), operationKey: 'folder', arguments: {}, question: '上传？',
      prepare: async () => { await ready }, execute: vi.fn(),
    })
    events.push({ seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '取消上传' }] } })
    const rejected = expect(delayed).rejects.toThrow(/已变化/)
    release()
    await rejected
  })

  it('does not let concurrent preparation replace the scope awaiting confirmation', async () => {
    const conversation = conversationFixture()
    let release!: () => void
    const ready = new Promise<void>(resolve => { release = resolve })
    const first = conversation.prepareOrExecute({
      agent: agent([]), operationKey: 'folder', arguments: { path: 'a' },
      prepare: async () => { await ready; return { count: 1 } },
      question: prepared => `上传 ${prepared!.count} 个？`, execute: vi.fn(),
    })
    try {
      await expect(conversation.prepareOrExecute({
        agent: agent([]), operationKey: 'folder', arguments: { path: 'b' }, question: '上传 B？', execute: vi.fn(),
      })).rejects.toThrow(/正在/)
    } finally { release(); await first }
  })

  it('accepts any later direct natural-language confirmation without matching fixed text', async () => {
    const events = sessionEvents([
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '修改资料' }] } },
    ])
    const current = agent(events)
    const execute = vi.fn(async () => ({ changed: true }))
    const conversation = conversationFixture({ now: () => 1_000 })
    const input = {
      agent: current,
      operationKey: 'arkme_extension_edit',
      arguments: { extension_id: 'ext-1', name: '新名称' },
      question: '是否确认修改？',
      execute,
    }

    await expect(conversation.prepareOrExecute(input)).resolves.toEqual({
      status: 'confirmation_required', question: '是否确认修改？', expiresAtMillis: 601_000,
    })
    await expect(conversation.prepareOrExecute(input)).resolves.toMatchObject({ status: 'confirmation_required' })
    expect(execute).not.toHaveBeenCalled()

    events.push({
      seq: 2, type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '可以，就按这个来吧' }] },
    })
    await expect(conversation.prepareOrExecute(input)).resolves.toEqual({ changed: true })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('ignores plugin messages and re-prepares changed arguments after a later user correction', async () => {
    const events = sessionEvents([
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '关闭 A' }] } },
    ])
    const current = agent(events)
    const executeA = vi.fn()
    const executeB = vi.fn(async () => 'done')
    const conversation = conversationFixture()

    await conversation.prepareOrExecute({
      agent: current, operationKey: 'set-enabled', arguments: { id: 'a' }, question: '关闭 A？', execute: executeA,
    })
    events.push({
      seq: 2, type: 'user/message',
      data: { source: { kind: 'plugin', plugin: 'test' }, content: [{ type: 'text', text: '确认' }] },
    })
    await expect(conversation.prepareOrExecute({
      agent: current, operationKey: 'set-enabled', arguments: { id: 'a' }, question: '关闭 A？', execute: executeA,
    })).resolves.toMatchObject({ status: 'confirmation_required' })

    events.push({
      seq: 3, type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '改成关闭 B' }] },
    })
    await expect(conversation.prepareOrExecute({
      agent: current, operationKey: 'set-enabled', arguments: { id: 'b' }, question: '关闭 B？', execute: executeB,
    })).resolves.toMatchObject({ status: 'confirmation_required', question: '关闭 B？' })
    expect(executeA).not.toHaveBeenCalled()
    expect(executeB).not.toHaveBeenCalled()

    events.push({
      seq: 4, type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '好' }] },
    })
    await expect(conversation.prepareOrExecute({
      agent: current, operationKey: 'set-enabled', arguments: { id: 'b' }, question: '关闭 B？', execute: executeB,
    })).resolves.toBe('done')
  })

  it('requires a fresh later message after an expired confirmation', async () => {
    let now = 100
    const events = sessionEvents([
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [] } },
    ])
    const current = agent(events)
    const execute = vi.fn(async () => 'done')
    const conversation = conversationFixture({ now: () => now, confirmationTtlMillis: 10 })
    const input = { agent: current, operationKey: 'delete', arguments: { id: 'a' }, question: '删除？', execute }

    await conversation.prepareOrExecute(input)
    now = 111
    events.push({
      seq: 2, type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '没问题' }] },
    })
    await expect(conversation.prepareOrExecute(input)).resolves.toEqual({
      status: 'confirmation_required', question: '删除？', expiresAtMillis: 121,
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('treats omitted and undefined optional Tool arguments as the same JSON action', async () => {
    const events = sessionEvents([
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [] } },
    ])
    const current = agent(events)
    const execute = vi.fn(async () => 'done')
    const conversation = conversationFixture()

    await conversation.prepareOrExecute({
      agent: current,
      operationKey: 'arkme_extension_apply',
      arguments: { extension_id: 'ext-1' },
      question: '安装？',
      execute,
    })
    events.push({
      seq: 2, type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '安装吧' }] },
    })
    await expect(conversation.prepareOrExecute({
      agent: current,
      operationKey: 'arkme_extension_apply',
      arguments: { extension_id: 'ext-1', version: undefined },
      question: '安装？',
      execute,
    })).resolves.toBe('done')
  })

  it('commits with the Host context captured once during preparation', async () => {
    const events = sessionEvents([
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [] } },
    ])
    const current = agent(events)
    let liveUserId = 42
    const prepare = vi.fn(async () => ({ expectedUserId: liveUserId }))
    const execute = vi.fn(async (context: { expectedUserId: number } | undefined) => context)
    const conversation = conversationFixture()
    const input = {
      agent: current, operationKey: 'account-write', arguments: {}, question: '确认写入？', prepare, execute,
    }

    await expect(conversation.prepareOrExecute(input)).resolves.toMatchObject({ status: 'confirmation_required' })
    await expect(conversation.prepareOrExecute(input)).resolves.toMatchObject({ status: 'confirmation_required' })
    expect(prepare).toHaveBeenCalledTimes(1)
    liveUserId = 43
    events.push({
      seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '确认' }] },
    })

    await expect(conversation.prepareOrExecute(input)).resolves.toEqual({ expectedUserId: 42 })
    expect(execute).toHaveBeenCalledWith({ expectedUserId: 42 })
  })

  it('blocks a concurrent second execution after one confirmed write starts', async () => {
    const events = sessionEvents([
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [] } },
    ])
    const current = agent(events)
    let finish!: () => void
    const execute = vi.fn(async () => await new Promise<string>(resolve => { finish = () => resolve('done') }))
    const conversation = conversationFixture()
    const input = { agent: current, operationKey: 'record-reedit', arguments: { id: 'a' }, question: '确认编辑？', execute }
    await conversation.prepareOrExecute(input)
    events.push({ seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [] } })

    const first = conversation.prepareOrExecute(input)
    await expect(conversation.prepareOrExecute(input)).rejects.toThrow('正在执行')
    finish()
    await expect(first).resolves.toBe('done')
    expect(execute).toHaveBeenCalledOnce()
  })
})
