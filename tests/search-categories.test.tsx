import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchFileRow, SearchLinkRows, SearchMediaTile, searchDuration, searchLinkUrls } from '../src/client/ArkmeSearchCategories.js'
import type { ArkmeSearchRecordItem } from '../src/types.js'
const resolve = vi.hoisted(() => vi.fn())
vi.mock('../src/client/link-metadata-client.js', () => ({ arkmeLinkMetadataResolver: { resolve }, arkmeShouldResolveLinkMetadata: () => true }))
const item: ArkmeSearchRecordItem = { recordUid: 'one', sourceKind: 3, sendAtMillis: 1, title: '', textContent: '', media: [], files: [] }
let root: ReactTestRenderer
async function render(element: React.ReactElement) { await act(async () => { root = create(element) }) }
afterEach(async () => { if (root) await act(async () => root.unmount()); vi.unstubAllGlobals(); resolve.mockReset() })
describe('Flutter search category presentation', () => {
  it('deduplicates normalized links and caps each message at five without accepting unsafe schemes', () => {
    expect(searchLinkUrls({ ...item, linkUrl: 'https://a.com', textContent: 'https://a.com https://b.com https://c.com https://d.com https://e.com https://f.com javascript:alert(1)' })).toEqual(['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com', 'https://e.com'])
  })
  it('keeps links usable on metadata failure, with one independent locate action and copy feedback', async () => {
    resolve.mockRejectedValue(new Error('offline'))
    const locate = vi.fn(), writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await render(<SearchLinkRows item={{ ...item, textContent: 'https://a.com https://b.com' }} onLocate={locate} />)
    expect(root.root.findAllByType('a').map(node => node.props.href)).toEqual(['https://a.com', 'https://b.com'])
    expect(root.root.findAllByProps({ 'aria-label': '定位链接消息' })).toHaveLength(1)
    await act(async () => root.root.findByProps({ 'aria-label': '复制链接 https://b.com' }).props.onClick())
    expect(writeText).toHaveBeenCalledWith('https://b.com')
    expect(locate).not.toHaveBeenCalled()
    expect(JSON.stringify(root.toJSON())).toContain('已复制')
    writeText.mockRejectedValueOnce(new Error('denied'))
    await act(async () => root.root.findByProps({ 'aria-label': '复制链接 https://b.com' }).props.onClick())
    expect(JSON.stringify(root.toJSON())).toContain('复制失败，请重试')
  })
  it('uses metadata title and a removable thumbnail without losing the link', async () => {
    resolve.mockResolvedValue({ title: '标题', description: '描述', imageUrl: 'https://a.com/image.png' })
    await render(<SearchLinkRows item={{ ...item, linkUrl: 'https://a.com' }} onLocate={() => {}} />)
    const thumbnail = root.root.findAllByType('img').find(node => node.props.src === 'https://a.com/image.png')!
    expect(thumbnail.props.style.width).toBe(30)
    await act(async () => thumbnail.props.onError())
    expect(root.root.findAllByType('a')).toHaveLength(1)
    expect(root.root.findAllByType('img').some(node => node.props.src === 'https://a.com/image.png')).toBe(false)
  })
  it('uses MIME-first Flutter icons at 22 pixels and opens the exact file', async () => {
    const open = vi.fn()
    await render(<SearchFileRow item={item} file={{ fileAssetUid: 'file', fileName: 'name.txt', mimeType: 'application/pdf' }} onOpen={open} />)
    expect(root.root.findByType('img').props).toMatchObject({ width: 22, height: 22, 'data-search-file-icon': 'pdf' })
    await act(async () => root.root.findByType('button').props.onClick())
    expect(open).toHaveBeenCalledOnce()
  })
  it('preserves media activation after thumbnail failure and displays measured video duration', async () => {
    const open = vi.fn()
    await render(<SearchMediaTile video url="/video" name="演示" onOpen={open} />)
    await act(async () => root.root.findByType('video').props.onLoadedMetadata({ currentTarget: { duration: 3661 } }))
    expect(JSON.stringify(root.toJSON())).toContain('01:01:01')
    await act(async () => root.root.findByType('video').props.onError())
    await act(async () => root.root.findByType('button').props.onClick())
    expect(open).toHaveBeenCalledOnce()
    expect(searchDuration(61.9)).toBe('01:01')
  })
})
