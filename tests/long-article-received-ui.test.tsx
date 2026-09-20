// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ArkmeLongArticleDialog } from '../src/client/ArkmeLongArticleDialog.js'

const api = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: api }))
vi.mock('../src/sdk/index.js', async original => ({ ...await original<typeof import('../src/sdk/index.js')>(), createArkmeSdk: () => ({}) }))
let host: HTMLDivElement; let root: Root
const item = {
  itemUid: 'article', senderName: '对方', isMe: false, sendAtMillis: 1, status: 1,
  title: '对方长文', textContent: '# 标题\n\n![图片](arkme-asset:image-1)', textFormat: 'markdown' as const,
  displayKind: 1 as const, messageActionRef: 'signed-reference',
  contentBlocks: [{ kind: 'image' as const, mediaRef: 'controlled', fileAssetUid: 'image-1', fileName: 'image.png', mimeType: 'image/png', size: 10, sortOrder: 0 }],
}
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); vi.unstubAllGlobals(); api.mockReset() })
it.each([false, true])('renders received Markdown and bound images with detail failure=%s', async failed => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  api.mockImplementation(async (operation: string) => {
    if (operation === 'provider.capabilities') return { features: { markdownLongArticles: true } }
    if (operation === 'source.long-article.detail') {
      if (failed) throw new Error('temporarily unavailable')
      return { ...item, editable: false, version: 1, thinkingDurationMillis: 0 }
    }
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<ArkmeLongArticleDialog sourceRef="chat" item={item} onClose={() => {}} />))
  expect(api).toHaveBeenCalledWith('source.long-article.detail', { sourceRef: 'chat', itemUid: 'article', messageActionRef: 'signed-reference' })
  expect(host.querySelector('h1')?.textContent).toBe('标题')
  expect(host.querySelector('img')?.getAttribute('src')).toContain('ref=controlled')
  expect(host.textContent).not.toContain('arkme-asset:')
  expect([...host.querySelectorAll('button')].some(button => button.textContent === '编辑')).toBe(false)
  expect(host.querySelector('[role=alert]') !== null).toBe(failed)
})
