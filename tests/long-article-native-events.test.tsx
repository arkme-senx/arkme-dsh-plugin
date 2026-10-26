import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { ArkmeLongArticleWindow } from '../src/client/ArkmeLongArticleWindow.js'
const native = vi.hoisted(() => ({ connect: vi.fn((_isCurrent: () => boolean) => vi.fn()), target: { accountKey: 'test:42', sourceRef: 'group-a', sourceKey: 'a', displayName: 'A', surface: 'library' } }))
vi.mock('../src/client/long-article-realtime.js', () => ({ connectLongArticleRealtime: native.connect }))
vi.mock('../src/client/auth-store.js', () => ({ arkmeAuthStore: { refresh: async () => {} } }))
vi.mock('../src/client/long-article-window.js', () => ({ longArticleAccountKey: () => 'test:42', longArticleWindowBridge: () => ({ context: async () => native.target, active: async () => true, onInvalidated: () => () => {}, onClose: () => () => {} }) }))
vi.mock('../src/client/ArkmeLongArticleDialog.js', () => ({ ArkmeLongArticleDialog: () => null, ArkmeLongArticleSnapshotDialog: () => null }))
vi.mock('../src/client/ArkmeBrowseWindow.js', () => ({ ArkmeBrowseWindow: () => null }))
it('connects exactly one native article hint stream and disposes it when the window closes', async () => {
  vi.stubGlobal('document', { title: '' })
  let window!: ReturnType<typeof create>
  try {
    await act(async () => { window = create(<ArkmeLongArticleWindow />) })
    expect(native.connect).toHaveBeenCalledOnce()
    expect(native.connect.mock.calls[0]?.[0]()).toBe(true)
    await act(async () => window.update(<ArkmeLongArticleWindow />))
    expect(native.connect).toHaveBeenCalledOnce()
    await act(async () => window.unmount())
    expect(native.connect.mock.results[0]!.value).toHaveBeenCalledOnce()
  } finally { vi.unstubAllGlobals() }
})
