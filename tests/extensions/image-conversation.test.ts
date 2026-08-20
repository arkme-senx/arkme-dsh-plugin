import { describe, expect, it, vi } from 'vitest'
import { ArkmeImageMutationConversation } from '../../src/tools/extensions/image-conversation.js'

function agent(events: Array<Record<string, unknown>>) {
  return { id: 'session-1', session: { events } } as never
}

describe('extension image conversational confirmation', () => {
  it('requires a later direct human reply and applies the exact prepared fingerprint', async () => {
    let fingerprint = 'digest-a'
    const apply = vi.fn(async (_draft: { extensionId: string }, prepared: { fingerprint: string }) => prepared.fingerprint)
    const conversation = new ArkmeImageMutationConversation({
      question: () => '是否确认添加这些预览图？',
      preflight: vi.fn(async () => ({ fingerprint, prepared: { fingerprint } })),
      apply,
    })
    const current = agent([
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '增加预览图' }] } },
    ])

    await expect(conversation.prepare(current, { extensionId: 'ext-1' })).resolves.toMatchObject({
      status: 'confirmation_required', question: '是否确认添加这些预览图？',
    })
    await expect(conversation.confirm(current)).rejects.toThrow('需要用户在准备操作后的新消息中明确确认')

    current.session.events.push({
      seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '可以，把它们加进去吧' }] },
    } as never)
    await expect(conversation.confirm(current)).resolves.toBe('digest-a')
    expect(apply).toHaveBeenCalledTimes(1)
    await expect(conversation.confirm(current)).rejects.toThrow('当前没有等待确认的图片操作')
  })

  it('rejects changed image content before the mutation', async () => {
    let fingerprint = 'digest-a'
    const apply = vi.fn()
    const conversation = new ArkmeImageMutationConversation({
      question: () => '是否确认替换头像？',
      preflight: vi.fn(async () => ({ fingerprint, prepared: { fingerprint } })),
      apply,
    })
    const current = agent([
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '换头像' }] } },
    ])
    await conversation.prepare(current, { extensionId: 'ext-1' })
    fingerprint = 'digest-b'
    current.session.events.push({
      seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '确认' }] },
    } as never)

    await expect(conversation.confirm(current)).rejects.toThrow('图片内容或目标扩展已变化')
    expect(apply).not.toHaveBeenCalled()
  })

  it('re-prepares a changed image target after a later user correction', async () => {
    const apply = vi.fn(async (draft: { extensionId: string }) => draft.extensionId)
    const conversation = new ArkmeImageMutationConversation({
      question: draft => `确认 ${draft.extensionId}`,
      preflight: vi.fn(async (_agent, draft: { extensionId: string }) => ({
        fingerprint: draft.extensionId,
        prepared: draft,
      })),
      apply,
    })
    const current = agent([
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '准备 A' }] } },
    ])
    await conversation.prepare(current, { extensionId: 'ext-a' })
    await expect(conversation.prepare(current, { extensionId: 'ext-b' }))
      .rejects.toThrow('已有等待确认')
    current.session.events.push({
      seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '准备 B' }] },
    } as never)
    await expect(conversation.prepare(current, { extensionId: 'ext-b' }))
      .resolves.toMatchObject({ status: 'confirmation_required', question: '确认 ext-b' })
    expect(apply).not.toHaveBeenCalled()
    current.session.events.push({
      seq: 3, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'B 可以，就用它' }] },
    } as never)
    await expect(conversation.confirm(current)).resolves.toBe('ext-b')
  })

  it('rejects invalid Agent identities and expired confirmations', async () => {
    let now = 100
    const conversation = new ArkmeImageMutationConversation({
      question: () => '确认？',
      preflight: vi.fn(async () => ({ fingerprint: 'digest', prepared: {} })),
      apply: vi.fn(),
      confirmationTtlMillis: 10,
      now: () => now,
    })
    await expect(conversation.prepare({ id: undefined, session: { events: [] } } as never, {}))
      .rejects.toThrow('会话身份无效')
    const current = agent([{ seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [] } }])
    await conversation.prepare(current, {})
    now = 111
    current.session.events.push({
      seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '确认' }] },
    } as never)
    await expect(conversation.confirm(current)).rejects.toThrow('确认已过期')
  })

  it('does not let a concurrent prepare replace a pending mutation being confirmed', async () => {
    let releaseConfirm!: () => void
    let markConfirmStarted!: () => void
    const confirmGate = new Promise<void>(resolve => { releaseConfirm = resolve })
    const confirmStarted = new Promise<void>(resolve => { markConfirmStarted = resolve })
    let preflightCalls = 0
    const conversation = new ArkmeImageMutationConversation({
      question: draft => `确认 ${draft.extensionId}`,
      async preflight(_agent, draft: { extensionId: string }) {
        preflightCalls += 1
        if (preflightCalls === 2) {
          markConfirmStarted()
          await confirmGate
        }
        return { fingerprint: draft.extensionId, prepared: draft }
      },
      apply: vi.fn(async draft => draft.extensionId),
    })
    const current = agent([
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '准备 A' }] } },
    ])
    await conversation.prepare(current, { extensionId: 'ext-a' })
    current.session.events.push({
      seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '行，就这么做' }] },
    } as never)
    const confirming = conversation.confirm(current)
    await confirmStarted

    await expect(conversation.prepare(current, { extensionId: 'ext-b' }))
      .rejects.toThrow('正在处理')
    releaseConfirm()
    await expect(confirming).resolves.toBe('ext-a')
  })
})
