import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeSearchSurface } from '../src/client/ArkmeSearchSurface.js'

describe('Arkme search surface', () => {
  it('starts with quick-note search and exposes desktop image and AI video quick entries', () => {
    const markup = renderToStaticMarkup(<ArkmeSearchSurface />)

    expect(markup).toContain('placeholder="搜索"')
    expect(markup).toContain('/arkme-self/api/call/image_search_grey.svg')
    expect(markup).not.toContain('>搜索</button>')
    expect(markup).toContain('>图片</button>')
    expect(markup).toContain('AI 视频')
    for (const label of ['图片/视频', '录音', '外部链接', '文件', '长文']) expect(markup).not.toContain(label)
  })

  it('keeps the search results and AI video entry in the desktop document flow', async () => {
    const source = await readFile(new URL('../src/client/ArkmeSearchSurface.tsx', import.meta.url), 'utf8')
    const mediaRouteSource = await readFile(new URL('../src/rich-media-routes.ts', import.meta.url), 'utf8')

    expect(source).not.toContain("height: 'min(600px, calc(100vh - 96px))'")
    expect(source).not.toContain("width: 'min(470px, 100%)'")
    expect(source).toContain("gridTemplateColumns: 'repeat(5, minmax(0, 1fr))'")
    expect(source).toContain("{ key: 'image', label: '图片', tabLabel: '图片库' }")
    expect(source).toContain("{ key: 'ai_video', label: 'AI 视频', tabLabel: 'AI 视频' }")
    expect(source).toContain('if (!active) void loadQuick(entry.key)')
    expect(source).toContain("controller.signal.aborted ? '加载超时，请重试'")
    expect(source).toContain('if (items.length === 0) return <><Status')
    expect(source).toContain("new IntersectionObserver(entries =>")
    expect(source).toContain("rootMargin: '240px 0px'")
    expect(source).toContain('{loadMoreSentinel}</>')
    expect(source).not.toContain("'加载更多'")
    expect(source).toContain('hasCachedPage')
    expect(source).toContain("src={`${assetRoot}/arrow_left.svg`}")
    expect(mediaRouteSource).toContain("'private, max-age=86400, immutable'")
    expect(mediaRouteSource).toContain("contentType.toLowerCase().startsWith('image/')")
  })
})
