import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeSearchSurface } from '../src/client/ArkmeSearchSurface.js'

describe('Arkme search surface', () => {
  it('starts with quick-note search and only exposes the supported AI video quick entry', () => {
    const markup = renderToStaticMarkup(<ArkmeSearchSurface />)

    expect(markup).toContain('placeholder="搜索"')
    expect(markup).toContain('/arkme-self/api/call/image_search_grey.svg')
    expect(markup).not.toContain('>搜索</button>')
    expect(markup).toContain('AI 视频')
    for (const label of ['图片/视频', '录音', '外部链接', '文件', '长文']) expect(markup).not.toContain(label)
  })

  it('keeps the search results and AI video entry in the desktop document flow', async () => {
    const source = await readFile(new URL('../src/client/ArkmeSearchSurface.tsx', import.meta.url), 'utf8')

    expect(source).not.toContain("height: 'min(600px, calc(100vh - 96px))'")
    expect(source).not.toContain("width: 'min(470px, 100%)'")
    expect(source).toContain("src={`${assetRoot}/arrow_left.svg`}")
  })
})
