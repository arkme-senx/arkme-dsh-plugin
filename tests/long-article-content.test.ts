import { describe, expect, it } from 'vitest'
import { resolveLongArticleContent } from '../src/long-article-content.js'
describe('long article image references', () => {
  it('replaces local image refs and preserves markdown whitespace', () => {
    expect(resolveLongArticleContent('  ![x](arkme-local:arkme-file-v1.a)\n', [{fileRef:'arkme-file-v1.a', fileAssetUid:'asset-123'}])).toBe('  ![x](arkme-asset:asset-123)\n')
  })
  it('rejects unresolved local images', () => { expect(() => resolveLongArticleContent('![x](arkme-local:missing)', [])).toThrow() })
  it('does not limit image counts', () => {
    const images = Array.from({length:100}, (_, i) => ({fileRef:`file-${i}`,fileAssetUid:`asset-${i}`}))
    const text = images.map(x => `![x](arkme-local:${x.fileRef})`).join('\n')
    expect(resolveLongArticleContent(text, images)).not.toContain('arkme-local:')
  })
})
it('leaves image-looking examples in fenced and inline code untouched', () => {
  const text = '`![x](arkme-local:missing)`\n\n```md\n![x](arkme-local:missing)\n```'
  expect(resolveLongArticleContent(text, [])).toBe(text)
})

it('preserves image alt text, titles and angle-wrapped destinations', () => {
  const text = '![diagram](<arkme-local:file-a> "caption")'
  expect(resolveLongArticleContent(text,[{fileRef:'file-a',fileAssetUid:'asset-a'}])).toBe('![diagram](<arkme-asset:asset-a> "caption")')
})
