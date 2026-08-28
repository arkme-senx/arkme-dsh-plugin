import { describe, expect, it, vi } from 'vitest'
import type { ArkmeService } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

describe('Bot conversation Host operations', () => {
  it('forwards only owner-neutral Bot references and conversation inputs', async () => {
    const service = {
      listBotPrivateChatDirectory: vi.fn(async () => ({ items: [] })),
      openBotPrivateChat: vi.fn(async () => ({ messages: [] })),
      refreshBotPrivateChat: vi.fn(async () => ({ messages: [] })),
      sendBotPrivateChatMessage: vi.fn(async () => ({ status: 'ok' })),
      markBotPrivateChatRead: vi.fn(async () => ({ effectiveReadSequence: 8, unreadCount: 0 })),
      botNotificationPreference: vi.fn(async () => ({ muted: false })),
      updateBotNotificationPreference: vi.fn(async () => ({ muted: true })),
    } as unknown as ArkmeService
    const signal = new AbortController().signal
    const privateFacts = { botId: 'must-not-cross-host', subject_uid: 'subject-private', chat_session_uid: 'chat-private' }

    await dispatchArkmeHostOperation(service, 'bots.private-chat.directory', privateFacts, undefined, undefined, undefined, undefined, signal)
    await dispatchArkmeHostOperation(service, 'bots.private-chat.open', { botRef: ' bot-ref ', ...privateFacts }, undefined, undefined, undefined, undefined, signal)
    await dispatchArkmeHostOperation(service, 'bots.private-chat.refresh', { botRef: ' bot-ref ', ...privateFacts }, undefined, undefined, undefined, undefined, signal)
    await dispatchArkmeHostOperation(service, 'bots.private-chat.send', { botRef: ' bot-ref ', content: '正文', ...privateFacts }, undefined, undefined, undefined, undefined, signal)
    await dispatchArkmeHostOperation(service, 'bots.private-chat.mark-read', { botRef: ' bot-ref ', sequence: 8, ...privateFacts }, undefined, undefined, undefined, undefined, signal)
    await dispatchArkmeHostOperation(service, 'bots.private-chat.notification.status', { botRef: ' bot-ref ', ...privateFacts }, undefined, undefined, undefined, undefined, signal)
    await dispatchArkmeHostOperation(service, 'bots.private-chat.notification.update', { botRef: ' bot-ref ', muted: true, ...privateFacts }, undefined, undefined, undefined, undefined, signal)

    expect(service.listBotPrivateChatDirectory).toHaveBeenCalledWith({ signal })
    expect(service.openBotPrivateChat).toHaveBeenCalledWith('bot-ref', { signal })
    expect(service.refreshBotPrivateChat).toHaveBeenCalledWith('bot-ref', { signal })
    expect(service.sendBotPrivateChatMessage).toHaveBeenCalledWith('bot-ref', '正文', { signal })
    expect(service.markBotPrivateChatRead).toHaveBeenCalledWith('bot-ref', 8, { signal })
    expect(service.botNotificationPreference).toHaveBeenCalledWith('bot-ref', { signal })
    expect(service.updateBotNotificationPreference).toHaveBeenCalledWith('bot-ref', true, { signal })
  })
})
