import { describe, expect, it, vi } from 'vitest'
import {
  ArkmeConversationalConfirmation,
} from '../../src/tools/shared/conversational-confirmation.js'

function agent(events: Array<Record<string, unknown>>) {
  return { id: 'session-1', session: { events } } as never
}

describe('Arkme conversational confirmation', () => {
  it('accepts any later direct natural-language confirmation without matching fixed text', async () => {
    const events: Array<Record<string, unknown>> = [
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '修改资料' }] } },
    ]
    const current = agent(events)
    const execute = vi.fn(async () => ({ changed: true }))
    const conversation = new ArkmeConversationalConfirmation({ now: () => 1_000 })
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
    const events: Array<Record<string, unknown>> = [
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '关闭 A' }] } },
    ]
    const current = agent(events)
    const executeA = vi.fn()
    const executeB = vi.fn(async () => 'done')
    const conversation = new ArkmeConversationalConfirmation()

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
    const events: Array<Record<string, unknown>> = [
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [] } },
    ]
    const current = agent(events)
    const execute = vi.fn(async () => 'done')
    const conversation = new ArkmeConversationalConfirmation({ now: () => now, confirmationTtlMillis: 10 })
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
    const events: Array<Record<string, unknown>> = [
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [] } },
    ]
    const current = agent(events)
    const execute = vi.fn(async () => 'done')
    const conversation = new ArkmeConversationalConfirmation()

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
})
