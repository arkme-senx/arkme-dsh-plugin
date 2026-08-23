import { describe, expect, it, vi } from 'vitest'
import { worldOpenPrivateChatToolModule } from '../src/tools/business/world/open-private-chat.js'
import type { ArkmeCoreToolPorts } from '../src/tools/ports/index.js'

describe('World private-chat Tool', () => {
  it('uses only an unchanged opaque author reference', async () => {
    const openPrivateChatFromWorldAuthor = vi.fn(async () => ({
      source: { sourceRef: 'source-ref', kind: 'private_chat' as const, displayName: '小林', activeAtMillis: 0, unreadCount: 0 },
    }))
    const tool = worldOpenPrivateChatToolModule.create({ openPrivateChatFromWorldAuthor } as unknown as ArkmeCoreToolPorts)
    const signal = new AbortController().signal

    await expect(tool.execute({ author_ref: 'arkme-world-record-v1.opaque' }, { signal } as never)).resolves.toContain('source-ref')
    expect(openPrivateChatFromWorldAuthor).toHaveBeenCalledWith('arkme-world-record-v1.opaque', signal)
  })
})
