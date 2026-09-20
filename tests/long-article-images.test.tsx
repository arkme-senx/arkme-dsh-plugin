// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { arkmeMarkdownEditorSource } from '../src/markdown.js'
import { arkmeMarkdownExtensions, arkmeSerializeMarkdownEditor } from '../src/client/markdown-editor.js'
import { ArkmeLongArticleBody } from '../src/client/ArkmeLongArticleBody.js'
import { ArkmeMarkdownBody } from '../src/client/ArkmeMarkdownBody.js'
import { checkLongArticleImages } from '../src/client/long-article-images.js'
import { LONG_ARTICLE_IMAGE_MAX_BYTES } from '../src/long-article-image-policy.js'

const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()))
describe('long article local images', () => {
  it('checks each file against the fixed 50 MiB limit and accepts the exact limit', () => {
    expect(LONG_ARTICLE_IMAGE_MAX_BYTES).toBe(50 * 1024 * 1024)
    const files = [
      { name: 'small.png', type: 'image/png', size: LONG_ARTICLE_IMAGE_MAX_BYTES - 1 },
      { name: 'exact.png', type: 'image/png', size: LONG_ARTICLE_IMAGE_MAX_BYTES },
      { name: 'large.png', type: 'image/png', size: LONG_ARTICLE_IMAGE_MAX_BYTES + 1 },
      { name: 'empty.png', type: 'image/png', size: 0 },
      { name: 'unsafe.svg', type: 'image/svg+xml', size: 1 },
    ] as File[]
    const result = checkLongArticleImages(files)
    expect(result.accepted.map(file => file.name)).toEqual(['small.png', 'exact.png'])
    expect(result.errors).toHaveLength(3)
    expect(result.errors[0]).toContain('large.png')
    expect(result.errors[0]).toContain('50.00 MiB')
    expect(result.errors[0]).toContain(String(LONG_ARTICLE_IMAGE_MAX_BYTES + 1))
  })
  it.each([10, 21, 100])('accepts %i images without an attachment-count ceiling', count => {
    const files = Array.from({ length: count }, (_, i) => ({ name: `${i}.png`, type: 'image/png', size: 1 })) as File[]
    expect(checkLongArticleImages(files)).toEqual({ accepted: files, errors: [] })
  })
  it('round-trips owned images in the article editor while retaining external images literally', () => {
    const source = '# 标题\n\n前文\n\n![图片](arkme-asset:asset-image-1)\n\n后文\n\n![外链](https://example.com/a.png)'
    const editor = new Editor({ element: document.createElement('div'), extensions: arkmeMarkdownExtensions({ articleImages: true }), content: arkmeMarkdownEditorSource(source, true), contentType: 'markdown' })
    editors.push(editor)
    const saved = arkmeSerializeMarkdownEditor(editor).source
    expect(saved).toContain('![图片](arkme-asset:asset-image-1)')
    expect(saved).toContain('外链')
    let images = 0
    editor.state.doc.descendants(node => { if (node.type.name === 'image') images++ })
    expect(images).toBe(1)
  })
  it('only enables image rendering when the caller resolves a bound asset', () => {
    const source = '![绑定](arkme-asset:asset-image-1)\n\n![陌生](arkme-asset:other)\n\n![网络](https://example.com/a.png)'
    const renderImage = (ref: string, alt: string) => ref === 'arkme-asset:asset-image-1' ? <img src="/owned-image" alt={alt} /> : undefined
    const html = renderToStaticMarkup(<ArkmeMarkdownBody text={source} renderImage={renderImage} />)
    expect(html.match(/<img /g)).toHaveLength(1)
    expect(html).toContain('/owned-image')
    expect(html).toContain('陌生')
    expect(renderToStaticMarkup(<ArkmeMarkdownBody text={source} />)).not.toContain('<img ')
  })
})

it('preserves adjacent article images and text in one Markdown paragraph', () => {
  const source = '前文![一](arkme-asset:image-1)![二](arkme-asset:image-2)后文'
  const editor = new Editor({ element: document.createElement('div'), extensions: arkmeMarkdownExtensions({ articleImages: true }), content: source, contentType: 'markdown' })
  editors.push(editor)
  const saved = arkmeSerializeMarkdownEditor(editor).source
  expect(saved).toBe(source)
  const restored = new Editor({ element: document.createElement('div'), extensions: arkmeMarkdownExtensions({ articleImages: true }), content: saved, contentType: 'markdown' })
  editors.push(restored)
  expect(restored.state.doc.childCount).toBe(1)
  expect(restored.state.doc.firstChild!.content.content.map(node => node.type.name)).toEqual(['text', 'image', 'image', 'text'])
})

it('renders adjacent article images inline while retaining paragraph boundaries', () => {
  const markup = renderToStaticMarkup(<ArkmeLongArticleBody text={'前文![一](arkme-asset:image-1)![二](arkme-asset:image-2)后文\n\n下一段'} blocks={[
    { kind: 'image', mediaRef: 'one', fileAssetUid: 'image-1' },
    { kind: 'image', mediaRef: 'two', fileAssetUid: 'image-2' },
  ]} />)
  const host = document.createElement('div'); host.innerHTML = markup
  const paragraphs = host.querySelectorAll('p')
  expect(paragraphs).toHaveLength(2)
  const images = paragraphs[0]!.querySelectorAll('img')
  expect(images).toHaveLength(2)
  for (const image of images) expect((image.parentElement!.parentElement as HTMLElement).style.display).toBe('inline-block')
  expect(paragraphs[1]!.textContent).toBe('下一段')
})
