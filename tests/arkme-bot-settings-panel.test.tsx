import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))

import { ArkmeBotSettingsPanel } from '../src/client/ArkmeBotSettingsPanel.js'

const source = readFileSync(new URL('../src/client/ArkmeBotSettingsPanel.tsx', import.meta.url), 'utf8')
const bot = {
  botRef: 'subject-bot', name: 'Subject Bot', provider: 'webhook', description: '', status: 'online',
  directChatAvailable: true, privateChatOutboundEnabled: false, conversationProjection: 'record',
} as const
const profile = {
  ...bot,
  mentionEntryEnabled: true,
  tokenPreview: '', canRevealToken: false, tokenRevealEnabled: false,
  gatewayUrl: '', webhookUrl: '', recordCount: 0,
  webhookSecurity: { keywordEnabled: false, keyword: '', tokenEnabled: false, ipWhitelistEnabled: false, ipWhitelist: [] },
  joinedGroups: [],
}

describe('ArkmeBotSettingsPanel owner-specific notification operations', () => {
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    mocks.callArkme.mockReset()
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'bots.manage.profile') return profile
      if (operation === 'bots.private-chat.notification.status') return { muted: false }
      if (operation === 'bots.private-chat.notification.update') return { muted: true }
      throw new Error(`unexpected operation: ${operation}`)
    })
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount() })
    renderer = undefined
  })

  it('keeps owner and endpoint facts out of the settings UI', () => {
    expect(source).not.toContain('conversationOwner')
    expect(source).not.toContain('subject_uid')
    expect(source).not.toContain('chat_session_uid')
    expect(source).not.toContain('/api/v1/')
  })

  it('loads and updates mute state through the Subject private conversation contract', async () => {
    await act(async () => {
      renderer = create(<ArkmeBotSettingsPanel bot={bot} onClose={() => undefined} onUpdated={() => undefined} onDeleted={() => undefined} />)
      await Promise.resolve()
    })
    const notificationSwitch = renderer!.root.findAllByProps({ role: 'switch' })[0]!
    await act(async () => { notificationSwitch.props.onClick(); await Promise.resolve() })

    expect(mocks.callArkme).toHaveBeenCalledWith(
      'bots.private-chat.notification.status', { botRef: 'subject-bot' }, expect.any(AbortSignal),
    )
    expect(mocks.callArkme).toHaveBeenCalledWith(
      'bots.private-chat.notification.update', { botRef: 'subject-bot', muted: true },
    )
  })

  it('does not expose the Subject private notification contract for a Chat-owned Bot', async () => {
    const chatBot = {
      ...bot,
      botRef: 'chat-bot',
      conversationProjection: 'chat' as const,
      chatSourceKey: 'opaque-source-key',
    }
    await act(async () => {
      renderer = create(<ArkmeBotSettingsPanel bot={chatBot} onClose={() => undefined} onUpdated={() => undefined} onDeleted={() => undefined} />)
      await Promise.resolve()
    })

    expect(mocks.callArkme.mock.calls.filter(call => String(call[0]).startsWith('bots.private-chat.notification.'))).toEqual([])
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('消息免打扰')
  })

  it('admits only one notification policy write while the owner acknowledgement is pending', async () => {
    let completeUpdate: ((value: unknown) => void) | undefined
    mocks.callArkme.mockImplementation((operation: string) => {
      if (operation === 'bots.manage.profile') return Promise.resolve(profile)
      if (operation === 'bots.private-chat.notification.status') return Promise.resolve({ muted: false })
      if (operation === 'bots.private-chat.notification.update') {
        return new Promise(resolve => { completeUpdate = resolve })
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    await act(async () => {
      renderer = create(<ArkmeBotSettingsPanel bot={bot} onClose={() => undefined} onUpdated={() => undefined} onDeleted={() => undefined} />)
      await Promise.resolve()
    })
    const click = renderer!.root.findAllByProps({ role: 'switch' })[0]!.props.onClick

    await act(async () => {
      click()
      click()
      await Promise.resolve()
    })

    expect(mocks.callArkme.mock.calls.filter(call => call[0] === 'bots.private-chat.notification.update')).toHaveLength(1)
    await act(async () => {
      completeUpdate?.({ muted: true })
      await Promise.resolve()
    })
  })
})
