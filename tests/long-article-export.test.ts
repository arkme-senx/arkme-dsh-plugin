import { describe, expect, it, vi } from 'vitest'
import { articleBoundImage, articleExportBlocks, articleExportFileName, articleExportMarkdown, wrapArticleRuns } from '../src/client/long-article-export.js'

describe('portable long article exports', () => {
  it('preserves Markdown source and escapes plain text instead of interpreting it', () => {
    expect(articleExportMarkdown({ title: '题目', textContent: '## 标题\n\n**加粗**', textFormat: 'markdown' })).toBe('# 题目\n\n## 标题\n\n**加粗**\n')
    expect(articleExportMarkdown({ title: 'a\nb', textContent: '*普通*\n# 不是标题', textFormat: 'plain' })).toBe('# a b\n\n\\*普通\\*\n\\# 不是标题\n')
    expect(articleExportFileName('../a/b:*?')).not.toMatch(/[/\\:*?]/)
  })
  it('keeps headings, emphasis, lists, code, and images in mobile reading order', () => {
    const blocks = articleExportBlocks({ title: '测试', textFormat: 'markdown', textContent: '## 标题\n\n正文 **强调**\n\n- 项目\n\n![图片](arkme-asset:one)\n\n```js\nconst x=1\n```' })
    expect(blocks[0]).toMatchObject({ kind: 'text', size: 21, runs: [{ text: '标题', bold: true }] })
    expect(blocks[1]).toMatchObject({ kind: 'text', runs: [{ text: '正文 ' }, { text: '强调', bold: true }] })
    expect(blocks[2]).toMatchObject({ kind: 'text', runs: [{ text: '• ' }, { text: '项目' }] })
    expect(blocks[3]).toEqual({ kind: 'image', ref: 'arkme-asset:one', alt: '图片' })
    expect(blocks[4]).toMatchObject({ kind: 'text', runs: [{ text: 'const x=1', mono: true }] })
  })
  it('reflows wide tables into labeled rows without losing cell contents', () => {
    const blocks = articleExportBlocks({ title: '表', textFormat: 'markdown', textContent: '| 地点 | 内容 |\n| --- | --- |\n| 日本 | 一段很长的内容 |' })
    expect(blocks).toMatchObject([{ runs: [{ text: '地点：', bold: true }, { text: '日本' }] }, { runs: [{ text: '内容：', bold: true }, { text: '一段很长的内容' }] }, { kind: 'text' }])
  })
  it('wraps at grapheme boundaries and never splits an emoji family', () => {
    const lines = wrapArticleRuns([{ text: '甲乙👨‍👩‍👧‍👦丙\n丁', bold: true }], 17, 34, () => 17)
    expect(lines.map(line => line.map(run => run.text).join(''))).toEqual(['甲乙', '👨‍👩‍👧‍👦丙', '丁'])
    expect(lines.every(line => line.every(run => run.bold))).toBe(true)
  })
  it('only resolves images bound to the verified article; arbitrary URLs cannot become fetch targets', () => {
    const image = { kind: 'image' as const, fileAssetUid: 'one', mediaRef: 'signed', fileName: 'one.png', mimeType: 'image/png', size: 1, sortOrder: 0 }
    expect(articleBoundImage('arkme-asset:one', [image])).toBe(image)
    expect(() => articleBoundImage('https://example.com/private', [image])).toThrow('附件')
    expect(() => articleBoundImage('arkme-asset:other', [image])).toThrow('附件')
  })
})
