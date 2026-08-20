import { describe, expect, it, vi } from 'vitest'
import { ArkmeExtensionPublishConversation } from '../../src/tools/extensions/publish-conversation.js'
import type { ArkmeMyExtensionPublishInput } from '../../src/extensions/owned-types.js'

function draft(ownedRef: string, name: string): Omit<ArkmeMyExtensionPublishInput, 'clientMutationId'> {
  return {
    ownedRef,
    name,
    description: `${name}说明`,
    version: '1.0.0',
    visibility: 'private',
  }
}

describe('extension publish conversation confirmation', () => {
  it('publishes one prepared batch only after a later direct user confirmation', async () => {
    const events: Array<Record<string, unknown>> = [
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '发布这两个扩展' }], source: { kind: 'user' } } },
      { seq: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'prepare-1', name: 'arkme_extension_publish', arguments: '{}' } },
    ]
    const agent = { id: 'session-1', session: { get events() { return events } } }
    const publish = vi.fn(async (input: ArkmeMyExtensionPublishInput) => ({
      extension_id: `ext-${input.ownedRef}`,
      version: input.version,
      status: 'published' as const,
    }))
    let mutation = 0
    const conversation = new ArkmeExtensionPublishConversation({
      preflight: async input => ({ input, sourceFingerprint: `fingerprint:${input.ownedRef}` }),
      publish,
      now: () => 1_000,
      createMutationId: () => `00000000-0000-4000-8000-${String(++mutation).padStart(12, '0')}`,
    })

    const prepared = await conversation.prepare(agent as never, [
      draft('owned-weather', '天气助手'),
      draft('owned-calendar', '日程助手'),
    ])

    expect(prepared).toEqual({
      status: 'confirmation_required',
      count: 2,
      question: '是否确认一次发布以下 2 个扩展？\n- 天气助手 1.0.0，仅自己\n- 日程助手 1.0.0，仅自己',
      expectedReply: '确认发布全部 2 个扩展',
      items: [
        { ownedRef: 'owned-weather', name: '天气助手', version: '1.0.0', visibility: 'private' },
        { ownedRef: 'owned-calendar', name: '日程助手', version: '1.0.0', visibility: 'private' },
      ],
      expiresAtMillis: 601_000,
    })
    expect(publish).not.toHaveBeenCalled()
    await expect(conversation.confirm(agent as never)).rejects.toThrow('需要在准备发布后的新消息中确认')
    expect(publish).not.toHaveBeenCalled()

    events.push(
      { seq: 3, type: 'tool/result', data: { turn: 1, step: 1, callId: 'prepare-1', content: [], isError: false } },
      { seq: 4, type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: prepared.question }] } } },
      { seq: 5, type: 'turn/end', data: { turn: 1, reason: 'completed' } },
      { seq: 6, type: 'turn/start', data: { turn: 2 } },
      { seq: 7, type: 'user/message', data: { content: [{ type: 'text', text: '确认发布全部 2 个扩展' }], source: { kind: 'user' } } },
      { seq: 8, type: 'user/message', data: { content: [{ type: 'text', text: '插件上下文' }], source: { kind: 'plugin', plugin: 'test' } } },
    )

    await expect(conversation.confirm(agent as never)).resolves.toEqual({
      status: 'published',
      published: 2,
      failed: 0,
      items: [
        { ownedRef: 'owned-weather', name: '天气助手', version: '1.0.0', status: 'published', extensionId: 'ext-owned-weather' },
        { ownedRef: 'owned-calendar', name: '日程助手', version: '1.0.0', status: 'published', extensionId: 'ext-owned-calendar' },
      ],
    })
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it('invalidates the whole batch before cloud writes when a prepared source changes', async () => {
    const events: Array<Record<string, unknown>> = [
      { seq: 0, type: 'user/message', data: { content: [{ type: 'text', text: '发布' }], source: { kind: 'user' } } },
    ]
    const agent = { id: 'session-source-change', session: { get events() { return events } } }
    let fingerprint = 'fingerprint-before'
    const publish = vi.fn(async () => ({ extension_id: 'ext-1', version: '1.0.0', status: 'published' as const }))
    const conversation = new ArkmeExtensionPublishConversation({
      preflight: async input => ({ input, sourceFingerprint: fingerprint }),
      publish,
      now: () => 1_000,
      createMutationId: () => '00000000-0000-4000-8000-000000000001',
    })
    const prepared = await conversation.prepare(agent as never, [draft('owned-1', '扩展一')])
    events.push({
      seq: 1, type: 'user/message',
      data: { content: [{ type: 'text', text: prepared.expectedReply }], source: { kind: 'user' } },
    })
    fingerprint = 'fingerprint-after'

    await expect(conversation.confirm(agent as never)).rejects.toThrow('源码或 Bundle 已变化')
    expect(publish).not.toHaveBeenCalled()
    await expect(conversation.confirm(agent as never)).rejects.toThrow('当前没有等待确认')
  })

  it('returns per-item outcomes when one confirmed publish fails', async () => {
    const events: Array<Record<string, unknown>> = [
      { seq: 0, type: 'user/message', data: { content: [{ type: 'text', text: '发布' }], source: { kind: 'user' } } },
    ]
    const agent = { id: 'session-partial', session: { get events() { return events } } }
    let mutation = 0
    const conversation = new ArkmeExtensionPublishConversation({
      preflight: async input => ({ input, sourceFingerprint: `fingerprint:${input.ownedRef}` }),
      publish: async input => {
        if (input.ownedRef === 'owned-failed') throw new Error('Bundle 校验失败')
        return { extension_id: 'ext-success', version: input.version, status: 'published' }
      },
      now: () => 1_000,
      createMutationId: () => `00000000-0000-4000-8000-${String(++mutation).padStart(12, '0')}`,
    })
    const prepared = await conversation.prepare(agent as never, [
      draft('owned-success', '成功扩展'),
      draft('owned-failed', '失败扩展'),
    ])
    events.push({
      seq: 1, type: 'user/message',
      data: { content: [{ type: 'text', text: prepared.expectedReply }], source: { kind: 'user' } },
    })

    await expect(conversation.confirm(agent as never)).resolves.toEqual({
      status: 'completed_with_failures', published: 1, failed: 1,
      items: [
        { ownedRef: 'owned-success', name: '成功扩展', version: '1.0.0', status: 'published', extensionId: 'ext-success' },
        { ownedRef: 'owned-failed', name: '失败扩展', version: '1.0.0', status: 'failed', message: 'Bundle 校验失败' },
      ],
    })
  })

  it('does not report a non-terminal registry status as published', async () => {
    const events: Array<Record<string, unknown>> = [
      { seq: 0, type: 'user/message', data: { content: [{ type: 'text', text: '发布' }], source: { kind: 'user' } } },
    ]
    const agent = { id: 'session-validating', session: { get events() { return events } } }
    const conversation = new ArkmeExtensionPublishConversation({
      preflight: async input => ({ input, sourceFingerprint: 'fingerprint' }),
      publish: async input => ({ extension_id: 'ext-validating', version: input.version, status: 'validating' }),
      now: () => 1_000,
      createMutationId: () => '00000000-0000-4000-8000-000000000001',
    })
    const prepared = await conversation.prepare(agent as never, [draft('owned-validating', '校验中扩展')])
    events.push({
      seq: 1, type: 'user/message',
      data: { content: [{ type: 'text', text: prepared.expectedReply }], source: { kind: 'user' } },
    })

    await expect(conversation.confirm(agent as never)).resolves.toEqual({
      status: 'completed_with_failures', published: 0, failed: 1,
      items: [{
        ownedRef: 'owned-validating', name: '校验中扩展', version: '1.0.0', status: 'failed',
        message: '扩展发布尚未完成，当前状态：validating',
      }],
    })
  })
})
