import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeBotConversationSurface } from '../src/client/ArkmeBotConversationSurface.js'
import type { ArkmeBotSummary } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))

vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))

const bot: ArkmeBotSummary = {
  botRef: 'bot-link-test',
  name: '链接 Bot',
  provider: 'openclaw',
  description: '',
  status: 'online',
  directChatAvailable: true,
  privateChatOutboundEnabled: true,
  conversationProjection: 'record',
}

describe('Arkme Bot conversation link presentation', () => {
  beforeEach(() => {
    mocks.callArkme.mockReset()
    mocks.callArkme.mockImplementation(async (operation: string, params: Record<string, unknown>) => {
      if (operation === 'bots.private-chat.open') return {
        bot,
        messages: [
          { role: 'user', content: '查看 https://example.com/user', status: 'ok', createdAtMillis: 1 },
          { role: 'assistant', content: '回复 https://example.com/assistant [jm_emoji:angry_face]', status: 'ok', createdAtMillis: 2 },
        ],
      }
      if (operation === 'link.metadata') {
        const url = String(params.url)
        return { url, title: url.endsWith('/user') ? '用户发送的链接' : 'Bot 回复的链接' }
      }
      throw new Error(`unexpected Arkme call: ${operation}`)
    })
  })

  it('uses the shared link presentation for both user and Bot messages', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeBotConversationSurface bot={bot} />)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const links = renderer.root.findAllByProps({ 'data-arkme-text-link': 'true' })
    expect(links.map(link => link.props.href)).toEqual([
      'https://example.com/user',
      'https://example.com/assistant',
    ])
    expect(renderer.root.findAll(node => node.type === 'svg' && node.props['data-arkme-link-icon'] === 'true')).toHaveLength(2)
    expect(renderer.root.findAllByProps({ 'data-arkme-link-label': 'true' }).map(label => label.children[0])).toEqual([
      '用户发送的链接',
      'Bot 回复的链接',
    ])
    expect(renderer.root.findAllByProps({ 'data-arkme-rich-emoji': 'angry_face' })).toHaveLength(0)
    expect(renderer.root.findAll(node => node.children.some(child => (
      typeof child === 'string' && child.includes('[jm_emoji:angry_face]')
    )))).toHaveLength(1)
  })
})
