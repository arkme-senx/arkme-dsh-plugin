import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ receive: vi.fn(), local: vi.fn(() => '/authorized/local') }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => ({ receiveFile: mocks.receive, localFileUrl: mocks.local }) }))
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
import { readAskDshOriginal } from '../src/client/use-ask-dsh.js'
import type { ArkmeContentBlock } from '../src/types.js'
const block: ArkmeContentBlock = { kind: 'image', fileName: '原图.png', originalRef: 'original', mediaRef: 'thumbnail', size: 4, mimeType: 'image/png', sortOrder: 0 }
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
it('uses the authorized original reception, never the thumbnail', async () => {
  mocks.receive.mockResolvedValue({ state: 'ready', file: { fileRef: 'local-ref' } })
  const fetch = vi.fn(async () => new Response(new Blob(['full'], { type: 'image/png' })))
  vi.stubGlobal('fetch', fetch)
  expect((await readAskDshOriginal(block, new AbortController().signal)).size).toBe(4)
  expect(mocks.receive.mock.calls[0]![0]).toBe('original')
  expect(mocks.local).toHaveBeenCalledWith('local-ref')
  expect(fetch.mock.calls[0]![0]).toBe('/authorized/local')
})
it('rejects truncated bytes and unavailable originals', async () => {
  mocks.receive.mockResolvedValue({ state: 'ready', file: { fileRef: 'local-ref' } })
  vi.stubGlobal('fetch', async () => new Response('x'))
  await expect(readAskDshOriginal(block, new AbortController().signal)).rejects.toThrow('大小不匹配')
  const { originalRef: _, ...previewOnly } = block
  await expect(readAskDshOriginal(previewOnly, new AbortController().signal)).rejects.toThrow('原文件不可用')
})
