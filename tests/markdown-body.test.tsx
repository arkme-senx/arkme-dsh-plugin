import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'
import { ArkmeMarkdownBody } from '../src/client/ArkmeMarkdownBody.js'
import { arkmeRecordTextFormat, arkmeMarkdownPlainText } from '../src/markdown.js'
import { arkmeRichContentPayload } from '../src/services/chat-service.js'

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/quick-note-markdown.json', import.meta.url), 'utf8')) as {
  cases: { id: string; format: 'plain' | 'markdown'; source: string; visible: string[]; tags?: string[] }[]
}

describe('shared quick-note Markdown corpus', () => {
  it('renders emoji in prose while keeping code and URL tokens literal', () => {
    const token = '[jm_emoji:angry_face]'
    const href = `https://example.com/?value=${token}`
    const html = renderToStaticMarkup(<ArkmeMarkdownBody text={`正文 ${token}\n\n\`${token}\`\n\n\`\`\`text\n${token}\n\`\`\`\n\n[链接](${href})`} />)
    expect(html.match(/data-arkme-rich-emoji="angry_face"/g)).toHaveLength(1)
    expect(html).toContain(`<code>${token}</code>`)
    expect(html).toContain(`<code class="language-text">${token}\n</code>`)
    const renderedHref = /<a href="([^"]+)"/.exec(html)![1]!
    expect(new URL(renderedHref).searchParams.get('value')).toBe(token)
  })

  for (const fixture of fixtures.cases) if (fixture.tags) it(`renders corpus tags: ${fixture.id}`, () => {
    const html = renderToStaticMarkup(<ArkmeMarkdownBody text={fixture.source} />)
    expect(html.match(/role="link"/gu) ?? []).toHaveLength(fixture.tags!.length)
  })

  for (const fixture of fixtures.cases) it(fixture.id, () => {
    const format = arkmeRecordTextFormat({ content_payload: { text_format: fixture.format } })
    const visible = format === 'markdown' ? arkmeMarkdownPlainText(fixture.source) : fixture.source
    for (const text of fixture.visible) expect(visible).toContain(text)
  })
  it('does not infer Markdown from old content', () => {
    expect(arkmeRecordTextFormat({ text_content: '# Heading' })).toBe('plain')
  })
  it('renders GFM, line breaks and read-only tasks without active HTML/images', () => {
    const html = renderToStaticMarkup(<ArkmeMarkdownBody text={'# 标题\n\n- [x] 完成\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n第一行\n第二行\n\n<script>alert(1)</script>\n\n![图](https://example.com/a.png)'} />)
    expect(html).toContain('<h1>')
    expect(html).toContain('<table>')
    expect(html).toContain('<br/>')
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
  })
  it('emits Markdown payload even without media and excludes code/URL tags', () => {
    const source = '# 标题\n\n#工作 `#代码` [链接](https://example.com/#hash)'
    expect(arkmeRichContentPayload({ textFormat: 'markdown' }, source)).toEqual({
      payload_kind: 1, schema_version: 1, text_state: 1, text_format: 'markdown',
      hash_tags: [{ tag: '工作', start_index: source.indexOf('#工作'), length: 3 }],
    })
    expect(arkmeRichContentPayload({}, 'plain')).toBeUndefined()
  })
  it('activates only real tags and retains custom Markdown link actions', () => {
    const html = renderToStaticMarkup(<ArkmeMarkdownBody text={'**#工作** \\#普通 `#代码` [快记](https://example.com/share)'}
      renderLink={link => <button data-share-link={link.href}>{link.text}</button>} />)
    expect(html.match(/role="link"/gu)).toHaveLength(1)
    expect(html).toContain('data-share-link="https://example.com/share"')
    expect(html).toContain('#普通')
  })
})

describe('formatted share link labels', () => {
  it.each(['**重点链接**', '*重点链接*', '`重点链接`', '**重点*链接***'])('retains the full label for %s in real message details', label => {
    const html = renderToStaticMarkup(<ArkmeMessageContent presentation="detail" item={{
      itemUid: 'test', senderName: 'me', isMe: true, sendAtMillis: 1, title: '',
      textContent: `[${label}](https://jiwo.cc/s/0123456789abcdef)`, textFormat: 'markdown', status: 1,
    }} />)
    expect(html).toContain('data-arkme-inline-link="message-copy-link"')
    expect(html).toContain('data-arkme-link-label="true">重点链接</span>')
  })
})
