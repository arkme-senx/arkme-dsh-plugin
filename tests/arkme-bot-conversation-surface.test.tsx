import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))

vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))

import { ArkmeBotConversationSurface } from '../src/client/ArkmeBotConversationSurface.js'
import { arkmeUi } from '../src/client/ui-controller.js'

const surfaceSource = readFileSync(new URL('../src/client/ArkmeBotConversationSurface.tsx', import.meta.url), 'utf8')
const subjectOpenClaw = {
  botRef: 'openclaw', name: 'OpenClaw', provider: 'openclaw', description: '', status: 'online',
  directChatAvailable: true, privateChatOutboundEnabled: true, conversationProjection: 'record',
} as const

describe('ArkmeBotConversationSurface business gates', () => {
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    mocks.callArkme.mockReset()
    mocks.callArkme.mockResolvedValue({ bot: subjectOpenClaw, messages: [] })
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount() })
    renderer = undefined
  })

  it('consumes stable conversation capabilities without reading owner labels', () => {
    expect(surfaceSource).not.toContain('conversationOwner')
    expect(surfaceSource).not.toContain('ARKME_BOT_CONVERSATION_OWNER')
  })

  it('keeps the existing composer for a Subject OpenClaw Bot', () => {
    const markup = renderToStaticMarkup(<ArkmeBotConversationSurface bot={subjectOpenClaw} />)

    expect(markup).toContain('<textarea')
    expect(markup).toContain('placeholder="发消息给 OpenClaw"')
  })

  it('preserves the master composer when an external summary has no new capability fields', () => {
    const markup = renderToStaticMarkup(<ArkmeBotConversationSurface bot={{
      botRef: 'external-summary', name: '外部摘要', provider: 'webhook', description: '', status: 'online',
      directChatAvailable: true,
    }} />)

    expect(markup).toContain('<textarea')
    expect(markup).not.toContain('Webhook Bot 仅接收外部系统推送')
  })

  it('uses an inbound-only notice instead of a composer for a Subject Webhook Bot', () => {
    const markup = renderToStaticMarkup(<ArkmeBotConversationSurface bot={{
      botRef: 'webhook', name: 'Webhook', provider: 'webhook', description: '', status: 'online',
      directChatAvailable: true, privateChatOutboundEnabled: false, conversationProjection: 'record',
    }} />)

    expect(markup).not.toContain('<textarea')
    expect(markup).toContain('Webhook Bot 仅接收外部系统推送')
  })

  it('does not offer a write control when canonical owner evidence is unavailable', () => {
    const markup = renderToStaticMarkup(<ArkmeBotConversationSurface bot={{
      botRef: 'unavailable', name: '归属异常 Bot', provider: 'openclaw', description: '', status: 'online',
      directChatAvailable: false, privateChatOutboundEnabled: false, conversationProjection: 'none',
    }} />)

    expect(markup).not.toContain('<textarea')
    expect(markup).toContain('当前 Bot 会话暂不可用')
    expect(markup).not.toContain('Webhook Bot 仅接收外部系统推送')
  })

  it('keeps the current Chat-owned Webhook surface out of the Subject-only UI gate', () => {
    const markup = renderToStaticMarkup(<ArkmeBotConversationSurface bot={{
      botRef: 'chat-webhook', name: 'Chat Webhook', provider: 'webhook', description: '', status: 'online',
      directChatAvailable: true, privateChatOutboundEnabled: true, conversationProjection: 'chat',
    }} />)

    expect(markup).toContain('<textarea')
    expect(markup).not.toContain('Webhook Bot 仅接收外部系统推送')
  })

  it('renders Subject-owned and Chat-owned Bots with the same existing DOM and styles', () => {
    const subjectMarkup = renderToStaticMarkup(<ArkmeBotConversationSurface bot={subjectOpenClaw} />)
    const chatMarkup = renderToStaticMarkup(<ArkmeBotConversationSurface bot={{
      ...subjectOpenClaw,
      conversationProjection: 'chat',
      chatSourceKey: 'opaque-chat-source-key',
    }} />)

    expect(chatMarkup).toBe(subjectMarkup)
  })

  it('reloads the existing Bot surface when the shared Record projection changes', async () => {
    await act(async () => {
      renderer = create(<ArkmeBotConversationSurface bot={subjectOpenClaw} />)
    })
    expect(mocks.callArkme).toHaveBeenCalledTimes(1)

    await act(async () => { arkmeUi.recordChanged() })

    expect(mocks.callArkme).toHaveBeenCalledTimes(2)
    expect(mocks.callArkme).toHaveBeenLastCalledWith(
      'bots.private-chat.refresh', { botRef: 'openclaw' }, expect.any(AbortSignal),
    )
  })

  it('does not apply Subject Record refreshes to a Chat-owned Bot surface', async () => {
    const chatBot = { ...subjectOpenClaw, botRef: 'chat-bot', conversationProjection: 'chat' as const }
    mocks.callArkme.mockResolvedValue({ bot: chatBot, messages: [] })
    await act(async () => {
      renderer = create(<ArkmeBotConversationSurface bot={chatBot} />)
    })
    expect(mocks.callArkme).toHaveBeenCalledTimes(1)

    await act(async () => { arkmeUi.recordChanged() })

    expect(mocks.callArkme).toHaveBeenCalledTimes(1)
  })

  it('acknowledges a Chat-owned Bot timeline sequence once without blocking the rendered conversation', async () => {
    const chatBot = { ...subjectOpenClaw, botRef: 'chat-bot', conversationProjection: 'chat' as const }
    mocks.callArkme
      .mockResolvedValueOnce({ messages: [{
        messageId: 'chat-record-1', recordUid: 'chat-record-1', role: 'assistant', content: 'Chat 回复',
        status: 'sent', createdAtMillis: 1, attachments: [],
      }], latestSequence: 9 })
      .mockResolvedValueOnce({ effectiveReadSequence: 9, unreadCount: 0 })
    await act(async () => {
      renderer = create(<ArkmeBotConversationSurface bot={chatBot} />)
    })

    expect(JSON.stringify(renderer!.toJSON())).toContain('Chat 回复')
    expect(mocks.callArkme).toHaveBeenCalledWith(
      'bots.private-chat.mark-read', { botRef: 'chat-bot', sequence: 9 },
    )

    await act(async () => { arkmeUi.chatChanged() })
    expect(mocks.callArkme.mock.calls.filter(call => call[0] === 'bots.private-chat.mark-read')).toHaveLength(1)
  })

  it('advances a newer Chat read sequence while an older acknowledgement is still in flight', async () => {
    const chatBot = { ...subjectOpenClaw, botRef: 'chat-read-advance', conversationProjection: 'chat' as const }
    let resolveSeven: ((value: unknown) => void) | undefined
    let resolveNine: ((value: unknown) => void) | undefined
    mocks.callArkme.mockImplementation((operation: string, params: { sequence?: number }) => {
      if (operation === 'bots.private-chat.open') return Promise.resolve({ messages: [], latestSequence: 7 })
      if (operation === 'bots.private-chat.refresh') return Promise.resolve({ messages: [], latestSequence: 9 })
      if (operation === 'bots.private-chat.mark-read' && params.sequence === 7) {
        return new Promise(resolve => { resolveSeven = resolve })
      }
      if (operation === 'bots.private-chat.mark-read' && params.sequence === 9) {
        return new Promise(resolve => { resolveNine = resolve })
      }
      throw new Error(`unexpected operation ${operation}`)
    })
    await act(async () => {
      renderer = create(<ArkmeBotConversationSurface bot={chatBot} />)
    })

    await act(async () => { arkmeUi.chatChanged() })

    expect(mocks.callArkme.mock.calls
      .filter(call => call[0] === 'bots.private-chat.mark-read')
      .map(call => call[1].sequence)).toEqual([7, 9])

    await act(async () => {
      resolveNine?.({ effectiveReadSequence: 9, unreadCount: 0 })
      await Promise.resolve()
      resolveSeven?.({ effectiveReadSequence: 7, unreadCount: 0 })
      await Promise.resolve()
    })
    await act(async () => { arkmeUi.chatChanged() })

    expect(mocks.callArkme.mock.calls.filter(call => call[0] === 'bots.private-chat.mark-read')).toHaveLength(2)
  })

  it('retries a failed Chat read acknowledgement on the next owner refresh without surfacing a conversation error', async () => {
    const chatBot = { ...subjectOpenClaw, botRef: 'chat-read-retry', conversationProjection: 'chat' as const }
    mocks.callArkme
      .mockResolvedValueOnce({ messages: [], latestSequence: 7 })
      .mockRejectedValueOnce(new Error('read unavailable'))
      .mockResolvedValueOnce({ messages: [], latestSequence: 7 })
      .mockResolvedValueOnce({ effectiveReadSequence: 7, unreadCount: 0 })
    await act(async () => {
      renderer = create(<ArkmeBotConversationSurface bot={chatBot} />)
    })
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0)

    await act(async () => { arkmeUi.chatChanged() })

    expect(mocks.callArkme.mock.calls.filter(call => call[0] === 'bots.private-chat.mark-read')).toHaveLength(2)
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  })

  it('keeps confirmed messages visible when an owner refresh fails', async () => {
    const chatBot = { ...subjectOpenClaw, botRef: 'chat-refresh-failure', conversationProjection: 'chat' as const }
    mocks.callArkme
      .mockResolvedValueOnce({ messages: [{
        messageId: 'confirmed-message', role: 'assistant', content: '已经确认的消息', status: 'sent',
        createdAtMillis: 1, attachments: [],
      }] })
      .mockRejectedValueOnce(new Error('刷新失败'))
    await act(async () => {
      renderer = create(<ArkmeBotConversationSurface bot={chatBot} />)
    })

    await act(async () => { arkmeUi.chatChanged() })

    expect(JSON.stringify(renderer!.toJSON())).toContain('已经确认的消息')
    expect(renderer!.root.findByProps({ role: 'alert' }).children).toContain('刷新失败')
  })

  it('keeps the draft and releases the send lock when sending fails', async () => {
    mocks.callArkme
      .mockResolvedValueOnce({ bot: subjectOpenClaw, messages: [] })
      .mockRejectedValueOnce(new Error('发送结果未知，请刷新会话确认'))
    await act(async () => {
      renderer = create(<ArkmeBotConversationSurface bot={subjectOpenClaw} />)
    })

    await act(async () => {
      renderer!.root.findByType('textarea').props.onChange({ target: { value: '保留这条草稿' } })
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick()
    })

    expect(renderer!.root.findByType('textarea').props).toMatchObject({
      value: '保留这条草稿', disabled: false,
    })
    expect(renderer!.root.findByProps({ role: 'alert' }).children).toContain('发送结果未知，请刷新会话确认')
    expect(mocks.callArkme).toHaveBeenCalledTimes(2)
  })

  it('admits only one send while the confirmed write is still in flight', async () => {
    let completeSend: ((value: unknown) => void) | undefined
    mocks.callArkme
      .mockResolvedValueOnce({ bot: subjectOpenClaw, messages: [] })
      .mockImplementationOnce(async () => await new Promise(resolve => { completeSend = resolve }))
    await act(async () => {
      renderer = create(<ArkmeBotConversationSurface bot={subjectOpenClaw} />)
    })
    await act(async () => {
      renderer!.root.findByType('textarea').props.onChange({ target: { value: '只发送一次' } })
    })

    const click = renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick
    await act(async () => {
      click()
      click()
      await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledTimes(2)
    await act(async () => {
      completeSend?.({
        status: 'ok',
        userMessage: {
          messageId: 'user-message-1', role: 'user', content: '只发送一次', status: 'sent',
          createdAtMillis: 1, attachments: [],
        },
        botMessages: [],
      })
      await Promise.resolve()
    })
  })

  it('does not project a completed send into another Bot after navigation', async () => {
    const nextBot = { ...subjectOpenClaw, botRef: 'next-bot', name: '下一个 Bot' }
    const onConversationActivity = vi.fn()
    let completeSend: ((value: unknown) => void) | undefined
    mocks.callArkme
      .mockResolvedValueOnce({ bot: subjectOpenClaw, messages: [] })
      .mockImplementationOnce(async () => await new Promise(resolve => { completeSend = resolve }))
      .mockResolvedValueOnce({ bot: nextBot, messages: [] })
    await act(async () => {
      renderer = create(<ArkmeBotConversationSurface
        key={subjectOpenClaw.botRef} bot={subjectOpenClaw} onConversationActivity={onConversationActivity}
      />)
    })
    await act(async () => {
      renderer!.root.findByType('textarea').props.onChange({ target: { value: '旧 Bot 消息' } })
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick()
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.update(<ArkmeBotConversationSurface
        key={nextBot.botRef} bot={nextBot} onConversationActivity={onConversationActivity}
      />)
    })
    onConversationActivity.mockClear()

    await act(async () => {
      completeSend?.({
        status: 'ok',
        userMessage: {
          messageId: 'old-bot-message', role: 'user', content: '旧 Bot 消息', status: 'sent',
          createdAtMillis: 1, attachments: [],
        },
        botMessages: [],
      })
      await Promise.resolve()
    })

    expect(onConversationActivity).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('旧 Bot 消息')
    expect(JSON.stringify(renderer!.toJSON())).toContain('下一个 Bot')
  })

  it('renders only server-confirmed messages after a successful send', async () => {
    mocks.callArkme
      .mockResolvedValueOnce({ bot: subjectOpenClaw, messages: [] })
      .mockResolvedValueOnce({
        status: 'ok',
        userMessage: {
          messageId: 'user-message-1', role: 'user', content: '服务端确认内容', status: 'sent',
          createdAtMillis: 1, attachments: [],
        },
        botMessages: [{
          messageId: 'bot-message-1', role: 'assistant', content: '服务端回复', status: 'sent',
          createdAtMillis: 2, attachments: [],
        }],
      })
    await act(async () => {
      renderer = create(<ArkmeBotConversationSurface bot={subjectOpenClaw} />)
    })

    await act(async () => {
      renderer!.root.findByType('textarea').props.onChange({ target: { value: '本地输入' } })
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick()
    })

    const markup = renderer!.toJSON()
    expect(JSON.stringify(markup)).toContain('服务端确认内容')
    expect(JSON.stringify(markup)).toContain('服务端回复')
    expect(JSON.stringify(markup)).not.toContain('本地输入')
    expect(renderer!.root.findByType('textarea').props.value).toBe('')
  })

  it('keeps an acknowledged write visible until the owner timeline contains the same message identity', async () => {
    mocks.callArkme
      .mockResolvedValueOnce({ messages: [] })
      .mockResolvedValueOnce({
        status: 'ok',
        userMessage: {
          messageId: 'confirmed-write', role: 'user', content: '已确认写入', status: 'sent',
          createdAtMillis: 1, attachments: [],
        },
        botMessages: [],
      })
      .mockResolvedValueOnce({ messages: [{
        messageId: 'later-reply', role: 'assistant', content: '稍后的回复', status: 'sent',
        createdAtMillis: 2, attachments: [],
      }] })
      .mockResolvedValueOnce({ messages: [{
        messageId: 'confirmed-write', role: 'user', content: '已确认写入', status: 'sent',
        createdAtMillis: 1, attachments: [],
      }, {
        messageId: 'later-reply', role: 'assistant', content: '稍后的回复', status: 'sent',
        createdAtMillis: 2, attachments: [],
      }] })
    await act(async () => {
      renderer = create(<ArkmeBotConversationSurface bot={subjectOpenClaw} />)
    })
    await act(async () => {
      renderer!.root.findByType('textarea').props.onChange({ target: { value: '已确认写入' } })
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick()
      await Promise.resolve()
    })

    await act(async () => { arkmeUi.recordChanged(); await Promise.resolve() })
    const pendingMarkup = JSON.stringify(renderer!.toJSON())
    expect(pendingMarkup.indexOf('已确认写入')).toBeLessThan(pendingMarkup.indexOf('稍后的回复'))

    await act(async () => { arkmeUi.recordChanged(); await Promise.resolve() })
    const finalMarkup = JSON.stringify(renderer!.toJSON())
    expect(finalMarkup.match(/已确认写入/g)).toHaveLength(1)
  })

  it('keeps distinct server messages that share content and timestamp', async () => {
    mocks.callArkme
      .mockResolvedValueOnce({ bot: subjectOpenClaw, messages: [] })
      .mockResolvedValueOnce({
        status: 'ok',
        userMessage: {
          messageId: 'user-message-1', role: 'user', content: '重复内容', status: 'sent',
          createdAtMillis: 1, attachments: [],
        },
        botMessages: [{
          messageId: 'bot-message-1', role: 'assistant', content: '重复内容', status: 'sent',
          createdAtMillis: 1, attachments: [],
        }],
      })
    await act(async () => {
      renderer = create(<ArkmeBotConversationSurface bot={subjectOpenClaw} />)
    })

    await act(async () => {
      renderer!.root.findByType('textarea').props.onChange({ target: { value: '发送内容' } })
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick()
    })

    expect(JSON.stringify(renderer!.toJSON()).match(/重复内容/gu)).toHaveLength(2)
  })

  it('does not infer duplicate identity for messages whose IDs are missing', async () => {
    mocks.callArkme
      .mockResolvedValueOnce({ bot: subjectOpenClaw, messages: [] })
      .mockResolvedValueOnce({
        status: 'ok',
        userMessage: {
          messageId: 'user-message-1', role: 'user', content: '发送内容', status: 'sent',
          createdAtMillis: 1, attachments: [],
        },
        botMessages: [{
          messageId: '', role: 'assistant', content: '无法判定身份', status: 'sent',
          createdAtMillis: 2, attachments: [],
        }, {
          messageId: '', role: 'assistant', content: '无法判定身份', status: 'sent',
          createdAtMillis: 2, attachments: [],
        }],
      })
    await act(async () => {
      renderer = create(<ArkmeBotConversationSurface bot={subjectOpenClaw} />)
    })

    await act(async () => {
      renderer!.root.findByType('textarea').props.onChange({ target: { value: '发送内容' } })
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick()
    })

    expect(JSON.stringify(renderer!.toJSON()).match(/无法判定身份/gu)).toHaveLength(2)
  })
})
