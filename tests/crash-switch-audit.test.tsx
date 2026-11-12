// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { it, expect, vi } from 'vitest'
import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { arkmeChatDirectory, arkmeChatTimelineDelta } from '../src/client/chat-directory-store.js'
import { callArkme } from '../src/client/api.js'
import type { ArkmeSourceItem } from '../src/types.js'
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: vi.fn() }))
it('keeps conversation switches stable after a synced body preserves canonical message actions', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  Element.prototype.scrollIntoView = () => {}
  HTMLElement.prototype.scrollTo = () => {}
  HTMLDialogElement.prototype.close = function () { this.open = false }
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  const sources: ArkmeSourceItem[] = ['private_chat', 'group_chat', 'send_to_self'].map((kind, i) => ({
    kind: kind as ArkmeSourceItem['kind'], sourceRef: `audit-${i}`, sourceKey: `chat:audit-${i}`,
    displayName: `审计会话 ${i}`, activeAtMillis: 1, unreadCount: 0, latestSequence: 1,
  }))
  vi.mocked(callArkme).mockImplementation(async (method, params: any) => {
    if (method === 'source.timeline' && params?.cursor?.unified?.cacheOnly) throw new Error('No fixture cache')
    if (method === 'conversation.viewport.read') return [] as never
    if (method === 'source.timeline-cache.read') return undefined as never
    if (method === 'source.timeline') return { source: sources.find(s => s.sourceRef === params.sourceRef),
      items: [{ itemUid: params.sourceRef + '-message', sequence: 1, timelineItemKey: params.sourceRef + '-relation', messageActionsV2: true, senderName: '对方', isMe: false,
        sendAtMillis: 1, title: '', textContent: '会话切换测试', status: 1 }], hasMore: false } as never
    if (method === 'source.members') return { items: [], total: 0, activeCount: 0 } as never
    if (method === 'source.interwoven-moments') return { state: 'disabled', moments: [], preparedAtMillis: 1 } as never
    if (method === 'files.send.tasks') return [] as never
    if (method === 'provider.capabilities') return { features: { markdownQuickNotes: true } } as never
    if (method === 'user.profile' || method === 'user.profile.refresh') return { profile: null, revision: 1 } as never
    return new Promise(() => {}) as never
  })
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  arkmeChatDirectory.activateAccount('test:42'); arkmeChatDirectory.publish(sources)
  arkmeUi.selectSource(sources[0]!)
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<ArkmeSurface productChrome={false} />))
    for (let i = 0; i < 30; i++) {
      if (i === 2) await act(async () => arkmeChatTimelineDelta.applySyncProjections([{
        sourceKey: 'chat:audit-0', changes: [{ itemKey: 'audit-0-relation', revision: 1, version: 2,
          item: { itemUid: 'audit-0-message', timelineItemKey: 'audit-0-relation', sequence: 1,
            senderName: '对方', isMe: false, sendAtMillis: 1, title: '', textContent: '会话切换测试：已同步', status: 1, recordVersion: 2 } }],
      }]))
      await act(async () => arkmeUi.selectSource(sources[i % sources.length]!))
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
      expect(host.querySelector('.arkme-conversation-body')).not.toBeNull()
      expect(host.textContent).toContain('会话切换测试')
      if (i >= 3 && i % 3 === 0) expect(host.textContent).toContain('会话切换测试：已同步')
    }
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() }
}, 20000)
