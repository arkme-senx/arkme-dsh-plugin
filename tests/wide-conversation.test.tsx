import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRef } from 'react'
import { ArkmeWideConversation, conversationRailActive, conversationRailPreviewItems, ConversationRailPreview, preserveConversationReading, readConversationRail } from '../src/client/ArkmeWideConversation.js'
import { ARKME_WIDE_CONVERSATION_MIN } from '../src/harness-conversation-layout-contract.js'
import { arkmeAvatarImages } from '../src/client/avatar-image-runtime.js'
const doms: JSDOM[] = []
afterEach(() => { doms.splice(0).forEach(dom => dom.window.close()); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function viewport(rows: Array<[string, string, string]>) {
  const dom = new JSDOM('<div id="viewport"></div>')
  doms.push(dom)
  const root = dom.window.document.getElementById('viewport')!
  rows.forEach(([key, role, text]) => {
    const node = dom.window.document.createElement('div')
    node.dataset.arkmeWidthAnchor = key
    node.dataset.arkmeWidthRole = role
    node.dataset.arkmeWidthPreview = text
    root.append(node)
  })
  return root
}

describe('shared wide conversation integration', () => {
  it('keeps narrow/SSR content mounted without native controls or hidden content', () => {
    expect(ARKME_WIDE_CONVERSATION_MIN).toBe(900)
    const html = renderToStaticMarkup(<ArkmeWideConversation enabled scopeKey="private:1" viewportRef={createRef()}>
      <textarea defaultValue="draft" /><p>message</p>
    </ArkmeWideConversation>)
    expect(html).toContain('data-arkme-wide-conversation="false"')
    expect(html).toContain('draft')
    expect(html).not.toContain('data-width-handle=')
    expect(html).not.toContain('data-arkme-native-turn-rail=')
  })
  it('preserves out-of-scope surfaces with display:contents', () => {
    expect(renderToStaticMarkup(<ArkmeWideConversation enabled={false} scopeKey="self" viewportRef={createRef()}>
      <p>self</p>
    </ArkmeWideConversation>)).toContain('display:contents')
  })
  it('uses one marker per private/group message and bounds previews', () => {
    const root = viewport([['a', 'message', 'a'], ['b', 'message', 'b'.repeat(1000)]])
    const items = readConversationRail(root, false)
    expect(items.map(item => item.anchor.key)).toEqual(['a', 'b'])
    expect(items[1]?.prompt.length).toBe(320)
    expect(items.every(item => item.anchor.kind === 'loaded')).toBe(true)
  })
  it('groups Arko answers with the question, preserving history dividers/orphan answers', () => {
    const root = viewport([['a', 'assistant', 'orphan'], ['b', 'user', 'question'], ['c', 'assistant', 'answer'], ['d', 'divider', 'new context'], ['e', 'assistant', 'new answer']])
    const items = readConversationRail(root, true)
    expect(items.map(({ prompt, response }) => [prompt, response])).toEqual([
      ['orphan', ''], ['question', 'answer'], ['new answer', ''],
    ])
    expect(items.map(item => item.anchor.key)).toEqual(['a', 'b', 'e'])
  })
  it('keeps each private/group sender paired with their own message, including missing avatars', () => {
    const root = viewport([['a', '', 'my text'], ['b', '', 'their text'], ['c', '', 'bot text']])
    const [a, b, c] = [...root.children] as HTMLElement[]
    Object.assign(a!.dataset, { arkmeWidthSender: '我', arkmeWidthAvatar: 'self-ref', arkmeWidthSenderKind: 'human' })
    Object.assign(b!.dataset, { arkmeWidthSender: '群成员', arkmeWidthAvatar: 'member-ref' })
    Object.assign(c!.dataset, { arkmeWidthSender: '机器人', arkmeWidthSenderKind: 'bot' })
    const items = readConversationRail(root, false)
    expect(items.map(item => item.speaker)).toEqual([
      { name: '我', avatarRef: 'self-ref', kind: 'human' },
      { name: '群成员', avatarRef: 'member-ref', kind: 'human' },
      { name: '机器人', avatarRef: '', kind: 'bot' },
    ])
    const rendered = conversationRailPreviewItems(items)
    expect(rendered.map(item => item.anchor.key)).toEqual(['a', 'b', 'c'])
    expect(rendered.every(item => item.response === '')).toBe(true)
    const html = renderToStaticMarkup(<>{rendered.map(item => <div key={item.turn}>{item.prompt}</div>)}</>)
    expect(html).toContain('群成员的头像')
    expect(html).toContain('data-arkme-bot-avatar="true"')
    expect(html).toContain('width:28px;height:28px')
    expect(html).not.toContain('<button')
  })
  it('uses distinct question and Arko answer avatars, including orphan replies', () => {
    const root = viewport([['a', 'assistant', 'orphan'], ['b', 'user', 'question'], ['c', 'assistant', 'answer']])
    for (const node of Array.from(root.children) as HTMLElement[]) {
      const arko = node.dataset.arkmeWidthRole === 'assistant'
      Object.assign(node.dataset, { arkmeWidthSender: arko ? 'Arko' : '我', arkmeWidthSenderKind: arko ? 'arko' : 'human', arkmeWidthAvatar: arko ? '' : 'self-ref' })
    }
    const items = readConversationRail(root, true)
    expect(items[0]?.speaker.kind).toBe('arko')
    expect(items[1]?.speaker.avatarRef).toBe('self-ref')
    expect(items[1]?.responseSpeaker?.kind).toBe('arko')
    const pair = conversationRailPreviewItems(items)[1]!
    expect(renderToStaticMarkup(<>{pair.prompt}{pair.response}</>)).toContain('Arko的头像')
    expect(renderToStaticMarkup(<>{pair.prompt}{pair.response}</>)).toContain('我的头像')
    expect(renderToStaticMarkup(<>{pair.response}</>)).toContain('-webkit-line-clamp:2')
  })
  it('uses the existing shared avatar cache and safely renders preview text', () => {
    vi.spyOn(arkmeAvatarImages, 'current').mockImplementation(ref => ref === 'cached-ref' ? 'data:image/png;base64,AA==' : undefined)
    const html = renderToStaticMarkup(<ConversationRailPreview speaker={{ name: '甲', kind: 'human', avatarRef: 'cached-ref' }} text={'<script>test</script>'} />)
    expect(html).toContain('<img src="data:image/png;base64,AA=="')
    expect(html).toContain('&lt;script&gt;test&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })
  it('follows visible reading position and handles reaching the bottom', () => {
    const root = viewport([['a', '', 'a'], ['b', '', 'b'], ['c', '', 'c']])
    Object.defineProperties(root, { scrollHeight: { value: 1000 }, clientHeight: { value: 400 } })
    root.getBoundingClientRect = () => ({ top: 0 } as DOMRect)
    const anchors = readConversationRail(root, false)
    anchors.forEach((item, index) => { item.element.getBoundingClientRect = () => ({ top: index * 300 - root.scrollTop } as DOMRect) })
    root.scrollTop = 310
    expect(conversationRailActive(root, anchors)).toBe(2)
    root.scrollTop = 600
    expect(conversationRailActive(root, anchors)).toBe(3)
    expect(conversationRailActive(root, [])).toBeNull()
  })
  it('anchors a reading message during width reflow, but keeps bottom-follow at the bottom', () => {
    const root = viewport([['a', '', 'a']])
    let height = 2000, y = 10
    Object.defineProperties(root, { scrollHeight: { get: () => height }, clientHeight: { value: 400 } })
    root.getBoundingClientRect = () => ({ top: 0 } as DOMRect)
    root.firstElementChild!.getBoundingClientRect = () => ({ top: y, bottom: y + 40 } as DOMRect)
    root.scrollTop = 500
    preserveConversationReading(root, () => { height += 300; y += 300 })
    expect(root.scrollTop).toBe(800)
    root.scrollTop = height - 400
    preserveConversationReading(root, () => { height += 300 })
    expect(root.scrollTop).toBe(height - 400)
  })
})
