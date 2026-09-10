import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { arkmeMarkdownHashTagRanges } from '../src/markdown.js'
import { arkmeRichContentPayload } from '../src/services/chat-service.js'

describe('Markdown tag metadata', () => {
  it.each([
    'https://example.com/#fragment',
    '<https://example.com/#fragment>',
    'www.example.com/#fragment',
    '[#label](https://example.com/#fragment)',
    '[#label][ref]\n\n[ref]: https://example.com/#fragment',
  ])('excludes URL and link text from tags: %s', source => {
    expect(arkmeMarkdownHashTagRanges(source)).toEqual([])
    expect(arkmeRichContentPayload({ textFormat: 'markdown' }, source)).not.toHaveProperty('hash_tags')
  })

  it.each([
    [String.raw`#a\*b`, 'a*b'],
    [String.raw`#a\_b`, 'a_b'],
    [String.raw`#a\\b`, 'a\\b'],
    ['#a&amp;b', 'a&b'],
    ['#版本&#x1F680;', '版本🚀'],
    [String.raw`＃a\~b`, 'a~b'],
  ])('separates the decoded tag name from its UTF-16 source range: %s', (raw, tag) => {
    const source = `😀 **${raw}**`
    const tags = [{ tag, startIndex: 5, length: raw.length }]
    expect(arkmeMarkdownHashTagRanges(source)).toEqual(tags)
    expect(arkmeRichContentPayload({ textFormat: 'markdown' }, source)?.hash_tags)
      .toEqual([{ tag, start_index: 5, length: raw.length }])
  })

  it('recognizes a hash after an escaped backslash but excludes escaped hashes and code', () => {
    const source = String.raw`\#literal &#35;entity \\#real ` + '`#code`\n\n    #indented'
    expect(arkmeMarkdownHashTagRanges(source)).toEqual([
      { tag: 'real', startIndex: source.indexOf('#real'), length: 5 },
    ])
  })
})

const corpus = JSON.parse(readFileSync(new URL('./fixtures/quick-note-markdown.json', import.meta.url), 'utf8')) as {
  cases: { id: string; source: string; tags?: string[] }[]
}
for (const fixture of corpus.cases) if (fixture.tags) it(`shared tag corpus: ${fixture.id}`, () => {
  expect(arkmeMarkdownHashTagRanges(fixture.source).map(tag => tag.tag)).toEqual(fixture.tags)
})
