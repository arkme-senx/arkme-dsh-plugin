import { describe, expect, it } from 'vitest'
import { textLinkRuns } from '../src/client/text-link-parser.js'

function links(text: string) {
  return textLinkRuns(text).filter(run => run.kind === 'link')
}

describe('textLinkRuns', () => {
  it('keeps display text and normalized navigation targets separate', () => {
    expect(textLinkRuns('访问 www.example.com/path')).toEqual([
      { kind: 'text', text: '访问 ' },
      { kind: 'link', text: 'www.example.com/path', href: 'https://www.example.com/path' },
    ])
  })

  it('preserves the complete source text across mixed runs', () => {
    const text = '前 https://example.com/a?q=1，中 baidu.com。后'
    const runs = textLinkRuns(text)
    expect(runs.map(run => run.text).join('')).toBe(text)
    expect(runs.filter(run => run.kind === 'link')).toHaveLength(2)
  })

  it('accepts valid IPv4 web URLs and rejects invalid IPv4 candidates', () => {
    expect(textLinkRuns('http://127.0.0.1:3080/path')).toEqual([
      { kind: 'link', text: 'http://127.0.0.1:3080/path', href: 'http://127.0.0.1:3080/path' },
    ])
    expect(textLinkRuns('999.999.999.999')).toEqual([
      { kind: 'text', text: '999.999.999.999' },
    ])
  })

  it.each([
    ['HTTPS URL with query and fragment', 'https://example.com/path?q=1#section', 'https://example.com/path?q=1#section'],
    ['Unicode path and query', 'https://example.com/中文路径?name=测试', 'https://example.com/中文路径?name=测试'],
    ['HTTP URL', 'http://example.com', 'http://example.com'],
    ['www host', 'www.example.com/docs', 'https://www.example.com/docs'],
    ['bare host', 'example.com', 'https://example.com'],
    ['numeric brand host', '58.com', 'https://58.com'],
    ['bare host with port', 'example.com:3080/path', 'https://example.com:3080/path'],
    ['explicit file-like host', 'https://summary.md', 'https://summary.md'],
    ['www file-like host', 'www.example.zip', 'https://www.example.zip'],
    ['IPv4 host', 'http://127.0.0.1:3080/path', 'http://127.0.0.1:3080/path'],
    ['explicit localhost', 'http://localhost:3080/path', 'http://localhost:3080/path'],
  ])('accepts %s', (_name, text, href) => {
    expect(links(text)).toEqual([{ kind: 'link', text, href }])
  })

  it.each([
    ['email', 'foo@bar.com'],
    ['AI-domain email', 'test@example.ai'],
    ['short numeric noise', '版本1.ai'],
    ['bare Markdown file', 'summary.md'],
    ['bare docs file', 'proposal.docs'],
    ['bare archive file', 'backup.zip'],
    ['nested file-like text', 'summary.md.backup'],
    ['unknown TLD', 'example.invalid'],
    ['bare localhost with port', 'localhost:3080/path'],
    ['version number', '1.2.3'],
    ['invalid IPv4', '999.999.999.999'],
    ['unspecified IPv4', '0.0.0.0'],
    ['unsupported FTP scheme', 'ftp://example.com'],
    ['unsupported custom scheme', 'arkme://example.com'],
    ['scheme-like JavaScript prefix', 'javascript:example.com'],
    ['scheme-like data prefix', 'data:text/plain,example.com'],
    ['credentials', 'https://user:pass@example.com/path'],
    ['invalid port', 'https://example.com:99999'],
    ['overlong port', 'https://example.com:123456'],
    ['non-numeric port', 'https://example.com:abc'],
    ['unsafe query text', 'https://example.com/?next=javascript:alert(1)'],
    ['ambiguous fragment', 'https://example.com/#a##b'],
    ['backslash host continuation', String.raw`https://example.com\evil.com`],
    ['invalid leading label punctuation', '-example.com'],
    ['invalid trailing label punctuation', 'example-.com'],
  ])('keeps %s as one plain-text run', (_name, text) => {
    expect(textLinkRuns(text)).toEqual([{ kind: 'text', text }])
  })

  it('keeps surrounding ASCII parentheses outside the navigation target', () => {
    expect(textLinkRuns('(https://example.com/path)')).toEqual([
      { kind: 'text', text: '(' },
      { kind: 'link', text: 'https://example.com/path', href: 'https://example.com/path' },
      { kind: 'text', text: ')' },
    ])
  })

  it('preserves URL-owned square brackets without consuming prose wrappers', () => {
    expect(textLinkRuns('筛选 https://example.com/search?ids[]=1&ids[]=2。')).toEqual([
      { kind: 'text', text: '筛选 ' },
      {
        kind: 'link',
        text: 'https://example.com/search?ids[]=1&ids[]=2',
        href: 'https://example.com/search?ids[]=1&ids[]=2',
      },
      { kind: 'text', text: '。' },
    ])
    expect(textLinkRuns('[https://example.com/path]')).toEqual([
      { kind: 'text', text: '[' },
      { kind: 'link', text: 'https://example.com/path', href: 'https://example.com/path' },
      { kind: 'text', text: ']' },
    ])
  })

  it.each([
    ['Chinese suffix', 'jotmo.ai功能', 'jotmo.ai', 'https://jotmo.ai'],
    ['Chinese suffix after explicit URL', 'https://jotmo.ai功能', 'https://jotmo.ai', 'https://jotmo.ai'],
    ['ASCII punctuation', 'baidu.com...', 'baidu.com', 'https://baidu.com'],
    ['Chinese punctuation', 'baidu.com，继续', 'baidu.com', 'https://baidu.com'],
    ['Markdown destination', '[官网](https://example.com/path)', 'https://example.com/path', 'https://example.com/path'],
    ['angle-bracket destination', '<https://example.com/path>', 'https://example.com/path', 'https://example.com/path'],
  ])('preserves %s outside the link', (_name, source, text, href) => {
    const runs = textLinkRuns(source)
    expect(runs.map(run => run.text).join('')).toBe(source)
    expect(links(source)).toEqual([{ kind: 'link', text, href }])
  })

  it('keeps invalid candidates in place while recognizing later valid links', () => {
    const text = 'foo@bar.com 与 https://example.com，再看 report.pdf'
    expect(textLinkRuns(text)).toEqual([
      { kind: 'text', text: 'foo@bar.com 与 ' },
      { kind: 'link', text: 'https://example.com', href: 'https://example.com' },
      { kind: 'text', text: '，再看 report.pdf' },
    ])
  })

  it('has no cross-message parser state', () => {
    const expected = [{ kind: 'link', text: 'example.com', href: 'https://example.com' }]
    expect(textLinkRuns('example.com')).toEqual(expected)
    expect(textLinkRuns('plain text')).toEqual([{ kind: 'text', text: 'plain text' }])
    expect(textLinkRuns('example.com')).toEqual(expected)
    expect(textLinkRuns('')).toEqual([])
  })

  it('keeps a link-dense message within the render budget', () => {
    const text = Array.from({ length: 1_000 }, (_, index) => `example${String(index)}.com`).join(' ')
    const startedAt = performance.now()
    expect(links(text)).toHaveLength(1_000)
    expect(performance.now() - startedAt).toBeLessThan(250)
  })

  it.each([
    ['plain ASCII', 'a'.repeat(100_000)],
    ['dot-heavy malformed host', 'a.'.repeat(50_000)],
    ['malformed explicit URL', `https://${'a'.repeat(100_000)}`],
    ['malformed backslash URL', ['https://example.com', 'a'.repeat(100_000)].join(String.fromCharCode(92))],
    ['scheme-like token with repeated domains', `data:${'example.com,'.repeat(5_000)}`],
  ])('keeps %s parsing within the render budget', (_name, text) => {
    const startedAt = performance.now()
    expect(textLinkRuns(text)).toEqual([{ kind: 'text', text }])
    expect(performance.now() - startedAt).toBeLessThan(250)
  })
})
