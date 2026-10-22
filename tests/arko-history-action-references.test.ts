import { expect, it, vi } from 'vitest'
import { MessageActionService } from '../src/services/message-action-service.js'
import { LocalMessageActionCapabilityCodec } from '../src/services/message-action-infrastructure.js'
import type { ArkmeArkoHistoryItem } from '../src/types.js'

it('uses compact capabilities for 100 long messages, revalidating the selection in one owner read', async () => {
 const text = '原始正文 **Markdown**\n'.repeat(2500)
 const items: ArkmeArkoHistoryItem[] = Array.from({ length: 100 }, (_, index) => ({ messageId: index + 1, sessionId: 88, messageRef: `locator-${index}`, sourceType: 2, messageType: 3,
  role: 'assistant', text, reasoning: '', createdAtMillis: 1700000000000 + index, status: 1, createdRecordUids: [] }))
 const read = vi.fn(async () => items)
 const gateway = { requireSession: vi.fn(async () => ({ userId: 7 })), createCopyLink: vi.fn(async () => ({ url: 'https://share.test/message', sid: 'test' })) }
 const service = new MessageActionService(gateway as never, {} as never, new LocalMessageActionCapabilityCodec(async () => 'synthetic-key'), { read })
 const projected = await Promise.all(items.map(item => service.agentHistoryItem(item, 7)))
 const refs = projected.map(item => item.messageActionRef!)
 expect(refs.every(ref => ref.startsWith('arkme-arko-message-action-v1.') && Buffer.byteLength(ref) < 1024)).toBe(true)
 expect(Buffer.byteLength(JSON.stringify({ actionRefs: refs }))).toBeLessThan(128 * 1024)
 expect(refs[0]).not.toContain('Markdown')
 const conversation = await service.agentConversationRef(7, 88), signal = new AbortController().signal
 await service.copyLink(conversation, refs, signal)
 expect(read).toHaveBeenCalledExactlyOnceWith(items.map(({ sessionId, messageId }) => ({ sessionId, messageId })), 7, signal)
 const delivered = gateway.createCopyLink.mock.calls[0]![0] as unknown as { textContent: string }[]
 expect(delivered).toHaveLength(100); expect(delivered[0]?.textContent).toBe(text)
 // A changed visible body cannot be silently forwarded as the original snapshot.
 items[0] = { ...items[0]!, text: 'changed after display' }
 await expect(service.copyLink(conversation, [refs[0]!], signal)).rejects.toMatchObject({ code: 'message-actions-source-changed' })
 expect(gateway.createCopyLink).toHaveBeenCalledOnce()
})
it('does not permit compact historical QA replies to become Agent share links', async () => {
 const item: ArkmeArkoHistoryItem = { messageId: 1, sessionId: 9, messageRef: 'qa-locator', role: 'assistant', text: 'legacy answer', reasoning: '', createdAtMillis: 1000, sourceType: 1, messageType: 1, status: 1, createdRecordUids: [] }
 const gateway = { requireSession: async () => ({ userId: 7 }), createCopyLink: vi.fn() }
 const service = new MessageActionService(gateway as never, {} as never, new LocalMessageActionCapabilityCodec(async () => 'synthetic-key'), { read: async () => [item] })
 const ref = await service.agentHistoryItem(item, 7)
 expect(ref.messageActionCapabilities).toEqual({ copyLink: false, forward: true })
 await expect(service.copyLink(await service.agentConversationRef(7, 9), [ref.messageActionRef!])).rejects.toMatchObject({ code: 'message-actions-source-unavailable' })
 expect(gateway.createCopyLink).not.toHaveBeenCalled()
})
