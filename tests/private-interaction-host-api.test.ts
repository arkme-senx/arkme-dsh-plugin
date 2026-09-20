import { describe, expect, it, vi } from 'vitest'
import type { ArkmeService } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

describe('private interaction Host operations', () => {
  it('forwards account-bound summary and paged query inputs without exposing extra fields', async () => {
    const service = {
      privateInteractionSummary: vi.fn(async () => ({ unreadCount: 1 })),
      queryPrivateInteractions: vi.fn(async () => ({ items: [], hasMore: false })),
      privateInteractionDirectory: vi.fn(async () => ({ items: [], hasMore: false })),
    } as unknown as ArkmeService
    const signal = new AbortController().signal
    await dispatchArkmeHostOperation(service, 'private-interaction.summary', {
      sourceRef: ' private-source ', expectedVersion: 'a'.repeat(64), ignored: 'no',
    }, undefined, undefined, undefined, undefined, signal)
    await dispatchArkmeHostOperation(service, 'private-interaction.query', {
      sourceRef: ' private-source ', unreadOnly: true, limit: 99,
      cursor: ' cursor ', expectedVersion: 'b'.repeat(64), ignored: 'no',
    }, undefined, undefined, undefined, undefined, signal)
    expect(service.privateInteractionSummary).toHaveBeenCalledWith('private-source', {
      expectedVersion: 'a'.repeat(64), signal,
    })
    expect(service.queryPrivateInteractions).toHaveBeenCalledWith({
      sourceRef: 'private-source', unreadOnly: true, limit: 50, cursor: 'cursor',
      expectedVersion: 'b'.repeat(64), signal,
    })
    await dispatchArkmeHostOperation(service, 'private-interaction.directory', {
      limit: 199, cursor: ' cursor ', expectedVersion: 'b'.repeat(64), unreadOnly: true, userId: 999,
    }, undefined, undefined, undefined, undefined, signal)
    expect(service.privateInteractionDirectory).toHaveBeenCalledWith({ limit: 100, cursor: 'cursor', expectedVersion: 'b'.repeat(64), signal })
  })
})
