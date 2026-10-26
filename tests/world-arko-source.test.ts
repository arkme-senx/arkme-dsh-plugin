import { expect, it, vi } from 'vitest'
import { ArkmeService } from '../src/arkme-service.js'
function setup() {
  const session = { userId: 42, accessToken: 'a', refreshToken: 'r' }
  const runtime = { requireSession: vi.fn(async () => ({ ...session })) }
  const item = { sessionId: 88, messageId: 101, role: 'user', status: 1, text: '已发送的完整内容', createdAtMillis: 123,
    contentBlocks: [{ kind: 'image', fileAssetUid: 'img', fileName: 'a.png', mimeType: 'image/png', size: 20, sortOrder: 0, mediaRef: 'sealed' }] }
  const arko = { actionMessages: vi.fn(async () => [item]) }
  const read = (signal?: AbortSignal) => ArkmeService.prototype.worldArkoPublishSource.call({ runtime, arko } as never, 88, 101, signal)
  return { runtime, arko, item, session, read }
}
it('reads the authenticated owner history, keeping images and unavailable attachments explicit', async () => {
  const x = setup()
  expect(await x.read()).toMatchObject({ textContent: '已发送的完整内容', attachments: [{ asset: { fileAssetUid: 'img' } }] })
  expect(x.arko.actionMessages).toHaveBeenCalledWith([{ sessionId: 88, messageId: 101 }], 42, undefined)
  x.item.contentBlocks[0]!.mediaRef = ''
  expect((await x.read()).attachments[0]).toMatchObject({ unavailable: true })
})
it('rejects assistant, unsent, stale targets, cancellation and switched accounts', async () => {
  const x = setup()
  x.item.role = 'assistant'; await expect(x.read()).rejects.toMatchObject({ code: 'world-source-not-owned' })
  x.item.role = 'user'; x.item.status = 2; await expect(x.read()).rejects.toThrow()
  x.item.status = 1; x.item.messageId = 102; await expect(x.read()).rejects.toThrow()
  x.item.messageId = 101
  const controller = new AbortController(); controller.abort(); await expect(x.read(controller.signal)).rejects.toThrow()
  x.runtime.requireSession.mockResolvedValueOnce(x.session).mockResolvedValueOnce({ ...x.session, userId: 99 })
  await expect(x.read()).rejects.toMatchObject({ code: 'world-source-account-changed' })
})
