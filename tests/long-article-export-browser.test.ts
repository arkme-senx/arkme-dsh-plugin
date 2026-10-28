// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { exportArticleImages, exportArticleMarkdown } from '../src/client/long-article-export.js'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function read(blob: Blob) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob) }) }
it('embeds actual image destinations once and preserves code examples byte for byte', async () => {
  const fetcher = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) }))
  vi.stubGlobal('fetch', fetcher)
  const content = await read(await exportArticleMarkdown({ title: '图片长文', textFormat: 'markdown', textContent: '![一](arkme-asset:one)\n\n`arkme-asset:one`\n\n![二](arkme-asset:one)',
    contentBlocks: [{ kind: 'image', fileAssetUid: 'one', mediaRef: 'signed-media', mimeType: 'image/png', fileName: 'one.png', size: 5, sortOrder: 0 }] }, new AbortController().signal))
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(content).toContain('`arkme-asset:one`')
  expect(content.match(/data:image\/png;base64,/g)).toHaveLength(2)
  expect(content).toContain('# 图片长文')
})
it('does not silently produce an incomplete Markdown when an image fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
  await expect(exportArticleMarkdown({ title: '图片', textFormat: 'markdown', textContent: '![一](arkme-asset:one)', contentBlocks: [{ kind: 'image', fileAssetUid: 'one', mediaRef: 'signed', mimeType: 'image/png', fileName: '', size: 1, sortOrder: 0 }] }, new AbortController().signal)).rejects.toThrow('尚未导出')
})
it('splits a long article into bounded 840px images and numbers every page', async () => {
  const dimensions: number[][] = [], labels: string[] = []
  const context = { font: '', fillStyle: '', scale: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(), measureText: (text: string) => ({ width: Array.from(text).length * 17 }), fillText: (text: string) => { labels.push(text) } }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as any)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function(this: HTMLCanvasElement, callback) { dimensions.push([this.width, this.height]); callback(new Blob(['png'], { type: 'image/png' })) })
  const files = await exportArticleImages({ title: '多页', textContent: '每一行都要完整保留\n'.repeat(250), textFormat: 'plain' }, new AbortController().signal, () => {})
  expect(files.length).toBeGreaterThan(2)
  expect(dimensions.every(([width, height]) => width === 840 && height! <= 4800)).toBe(true)
  expect(labels).toContain(`1 / ${files.length}`)
  expect(labels).toContain(`${files.length} / ${files.length}`)
  expect(labels.filter(value => value === '每一行都要完整保留')).toHaveLength(250)
})
it('honors cancellation before allocating images', async () => {
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
  const controller = new AbortController(); controller.abort()
  await expect(exportArticleImages({ title: '取消', textContent: '正文' }, controller.signal, () => {})).rejects.toThrow()
  expect(canvas).not.toHaveBeenCalled()
})
