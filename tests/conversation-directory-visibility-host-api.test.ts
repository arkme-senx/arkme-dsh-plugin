import { describe, expect, it, vi } from 'vitest'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

describe('conversation directory visibility Host API', () => {
  it('keeps Browser refs opaque and delegates typed resolution to the Host service', async () => {
    const signal = new AbortController().signal
    const service = {
      conversationDirectoryVisibilitySnapshot: vi.fn(async () => ({ items: [] })),
      setConversationDirectoryVisibility: vi.fn(async () => undefined),
      setChatDirectoryPin: vi.fn(async () => ({ sourceRef: 'source-ref', pinned: true })),
    }

    await expect(dispatchArkmeHostOperation(
      service as never,
      'conversation.directory.visibility.query',
      { sourceRefs: [' source-ref '], botRefs: [' bot-ref '] },
      undefined, undefined, undefined, undefined, signal,
    )).resolves.toEqual({ items: [] })
    await dispatchArkmeHostOperation(
      service as never,
      'conversation.directory.visibility.set',
      { entryKind: 'bot', entryRef: ' bot-ref ', hidden: true },
      undefined, undefined, undefined, undefined, signal,
    )
    await dispatchArkmeHostOperation(
      service as never,
      'source.directory.policy.set',
      { sourceRef: ' source-ref ', pinned: true },
      undefined, undefined, undefined, undefined, signal,
    )

    expect(service.conversationDirectoryVisibilitySnapshot)
      .toHaveBeenCalledWith(['source-ref'], ['bot-ref'], signal)
    expect(service.setConversationDirectoryVisibility)
      .toHaveBeenCalledWith('bot', 'bot-ref', true, signal)
    expect(service.setChatDirectoryPin).toHaveBeenCalledWith(' source-ref ', true, signal)
  })

  it('rejects an ambiguous visibility entry kind before service I/O', async () => {
    const service = { setConversationDirectoryVisibility: vi.fn() }
    await expect(dispatchArkmeHostOperation(
      service as never,
      'conversation.directory.visibility.set',
      { entryKind: 'chat', entryRef: 'ref', hidden: true },
    )).rejects.toMatchObject({ code: 'conversation-directory-entry-kind-invalid' })
    expect(service.setConversationDirectoryVisibility).not.toHaveBeenCalled()
  })

  it('rejects a legacy mixed pin and visibility command before either owner is mutated', async () => {
    const service = { setChatDirectoryPin: vi.fn() }
    await expect(dispatchArkmeHostOperation(
      service as never,
      'source.directory.policy.set',
      { sourceRef: 'source-ref', pinned: true, hidden: true },
    )).rejects.toMatchObject({ code: 'conversation-directory-command-ambiguous' })
    expect(service.setChatDirectoryPin).not.toHaveBeenCalled()
  })
})
