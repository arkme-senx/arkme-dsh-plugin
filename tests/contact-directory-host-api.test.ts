import { describe, expect, it, vi } from 'vitest'
import type { ArkmeService } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

describe('contact directory UI-only Host operations', () => {
  it('forwards count-only directory requests as limit zero without a cursor', async () => {
    const listDirectory = vi.fn(async (section: string, options: unknown) => ({ section, options }))
    const service = { listDirectory } as unknown as ArkmeService

    await expect(dispatchArkmeHostOperation(service, 'directory.list', {
      section: 'groups', limit: 50, countOnly: true, cursor: 'must-not-be-used',
    })).resolves.toEqual({ section: 'groups', options: { limit: 0, countOnly: true } })

    expect(listDirectory).toHaveBeenCalledWith('groups', { limit: 0, countOnly: true })
  })

  it('opens a Bot chat through its existing owner with only a trimmed opaque Bot ref and request signal', async () => {
    const openBotChat = vi.fn(async (botRef: string) => ({ sourceRef: `source:${botRef}` }))
    const service = { openBotChat } as unknown as ArkmeService
    const signal = new AbortController().signal

    await expect(dispatchArkmeHostOperation(service, 'directory.bot.open-chat', {
      botRef: ' bot-ref ', botId: 'must-not-cross-host', userId: 91,
    }, undefined, undefined, undefined, undefined, signal)).resolves.toEqual({ sourceRef: 'source:bot-ref' })

    expect(openBotChat).toHaveBeenCalledWith('bot-ref', { signal })
  })

  it('opens a group only through the directory owner and forwards its opaque source ref', async () => {
    const openDirectoryGroupChat = vi.fn(async (sourceRef: string) => ({ sourceRef }))
    const service = { openDirectoryGroupChat } as unknown as ArkmeService
    const signal = new AbortController().signal
    await expect(dispatchArkmeHostOperation(service, 'directory.group.open-chat', {
      sourceRef: ' group-ref ', userId: 91,
    }, undefined, undefined, undefined, undefined, signal)).resolves.toEqual({ sourceRef: 'group-ref' })
    expect(openDirectoryGroupChat).toHaveBeenCalledWith('group-ref', signal)
  })

  it('dispatches validated sections with bounded limits and trimmed opaque cursors', async () => {
    const listDirectory = vi.fn(async (section: string, options: unknown) => ({ section, options }))
    const service = { listDirectory } as unknown as ArkmeService

    await expect(dispatchArkmeHostOperation(service, 'directory.list', {
      section: 'contacts', limit: 999, cursor: ' contact-cursor ',
      userId: 91, candidateId: 'must-not-cross-host',
    })).resolves.toEqual({
      section: 'contacts', options: { limit: 50, cursor: 'contact-cursor' },
    })
    await expect(dispatchArkmeHostOperation(service, 'directory.list', {
      section: 'groups', limit: -9, cursor: '   ',
    })).resolves.toEqual({ section: 'groups', options: { limit: 1 } })

    expect(listDirectory).toHaveBeenNthCalledWith(1, 'contacts', { limit: 50, cursor: 'contact-cursor' })
    expect(listDirectory).toHaveBeenNthCalledWith(2, 'groups', { limit: 1 })
  })

  it('rejects unknown directory sections before reaching the service', async () => {
    const listDirectory = vi.fn()
    const service = { listDirectory } as unknown as ArkmeService

    await expect(dispatchArkmeHostOperation(service, 'directory.list', {
      section: 'archived-contacts', limit: 20,
    })).rejects.toMatchObject({ code: 'directory-section-invalid', httpStatus: 400 })
    expect(listDirectory).not.toHaveBeenCalled()
  })

  it('dispatches contact detail operations using only a trimmed opaque contact ref', async () => {
    const service = {
      directoryContactProfile: vi.fn(async (contactRef: string) => ({ contactRef })),
      directoryContactWorld: vi.fn(async (contactRef: string, options: unknown) => ({ contactRef, options })),
      openDirectoryContactChat: vi.fn(async (contactRef: string) => ({ contactRef })),
    }
    const injected = { userId: 91, candidateId: 'candidate-private', speakerId: 'speaker-private' }

    await expect(dispatchArkmeHostOperation(service as never, 'directory.contact.profile', {
      contactRef: ' contact-ref ', ...injected,
    })).resolves.toEqual({ contactRef: 'contact-ref' })
    await expect(dispatchArkmeHostOperation(service as never, 'directory.contact.world', {
      contactRef: ' contact-ref ', limit: 999, offset: -12, ...injected,
    })).resolves.toEqual({ contactRef: 'contact-ref', options: { limit: 20, offset: 0 } })
    await expect(dispatchArkmeHostOperation(service as never, 'directory.contact.open-chat', {
      contactRef: ' contact-ref ', ...injected,
    })).resolves.toEqual({ contactRef: 'contact-ref' })

    expect(service.directoryContactProfile).toHaveBeenCalledWith('contact-ref')
    expect(service.directoryContactWorld).toHaveBeenCalledWith('contact-ref', { limit: 20, offset: 0 })
    expect(service.openDirectoryContactChat).toHaveBeenCalledWith('contact-ref')
  })
})
