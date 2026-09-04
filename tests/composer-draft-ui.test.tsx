import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeArkoSurface } from '../src/client/ArkmeArkoSurface.js'
import { ArkmeRichComposerInput } from '../src/client/ArkmeRichComposerInput.js'
import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import '../src/client/composer-draft-auth-binding.js'
import {
  arkmeArkoComposerDraftKey,
  ARKME_COMPOSER_EMOJI_PLACEHOLDER,
  arkmeComposerDraftStore,
  arkmeSourceComposerDraftKey,
} from '../src/client/composer-draft-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import type { ArkmeAuthSnapshot, ArkmeSourceItem } from '../src/types.js'

const richComposerSource = readFileSync(new URL('../src/client/ArkmeRichComposerInput.tsx', import.meta.url), 'utf8')

const account: ArkmeAuthSnapshot = { status: 'authenticated', environment: 'test', userId: 10001 }
const sourceA: ArkmeSourceItem = {
  sourceRef: 'group-a', kind: 'group_chat', displayName: '会话 A', activeAtMillis: 1, unreadCount: 0,
}
const sourceB: ArkmeSourceItem = {
  sourceRef: 'group-b', kind: 'group_chat', displayName: '会话 B', activeAtMillis: 2, unreadCount: 0,
}

class FakeComposerNode {
  static readonly TEXT_NODE = 3
  readonly childNodes: FakeComposerNode[] = []

  constructor(readonly nodeType: number, private readonly text = '') {}

  get textContent(): string { return this.text }
}

class FakeComposerElement extends FakeComposerNode {
  readonly dataset: Record<string, string> = {}

  constructor(readonly tagName = 'DIV') { super(1) }

  override get textContent(): string {
    return this.childNodes.map(node => node.textContent).join('')
  }

  append(...nodes: FakeComposerNode[]): void { this.childNodes.push(...nodes) }

  replaceChildren(...nodes: FakeComposerNode[]): void {
    this.childNodes.splice(0, this.childNodes.length, ...nodes.flatMap(node =>
      node instanceof FakeComposerElement && node.tagName === 'FRAGMENT' ? node.childNodes : [node]))
  }
}

function stubComposerDom(): void {
  vi.stubGlobal('Node', FakeComposerNode)
  vi.stubGlobal('HTMLElement', FakeComposerElement)
  vi.stubGlobal('document', {
    createDocumentFragment: () => new FakeComposerElement('FRAGMENT'),
    createTextNode: (text: string) => new FakeComposerNode(FakeComposerNode.TEXT_NODE, text),
    getSelection: () => null,
  })
}

describe('composer draft UI projection', () => {
  afterEach(() => {
    arkmeComposerDraftStore.clearAccount(10001)
    vi.unstubAllGlobals()
  })

  it('projects only the selected conversation draft and restores it after switching back', () => {
    const keyA = arkmeSourceComposerDraftKey(10001, sourceA)
    const keyB = arkmeSourceComposerDraftKey(10001, sourceB)
    arkmeComposerDraftStore.setText(keyA, '只属于会话 A 的草稿')
    arkmeComposerDraftStore.setText(keyB, '只属于会话 B 的草稿')

    arkmeUi.selectSource(sourceA)
    const markupA = renderToStaticMarkup(<ArkmeSurface initialAuth={account} />)
    arkmeUi.selectSource(sourceB)
    const markupB = renderToStaticMarkup(<ArkmeSurface initialAuth={account} />)
    arkmeUi.selectSource(sourceA)
    const restoredA = renderToStaticMarkup(<ArkmeSurface initialAuth={account} />)

    expect(markupA).toContain('aria-label="会话 A"')
    expect(markupB).toContain('aria-label="会话 B"')
    expect(restoredA).toContain('aria-label="会话 A"')
    expect(arkmeComposerDraftStore.get(keyA).text).toBe('只属于会话 A 的草稿')
    expect(arkmeComposerDraftStore.get(keyB).text).toBe('只属于会话 B 的草稿')
  })

  it('maps each personal source kind to the record-owner placeholder without changing its source identity', () => {
    const personalSources: ArkmeSourceItem[] = [
      { ...sourceA, sourceRef: 'self', kind: 'send_to_self', displayName: '发给自己' },
      { ...sourceA, sourceRef: 'default', kind: 'default_category', displayName: '默认分类' },
      { ...sourceA, sourceRef: 'topic', kind: 'topic', displayName: '私人主题' },
    ]

    for (const source of personalSources) {
      arkmeUi.selectSource(source)
      const markup = renderToStaticMarkup(<ArkmeSurface
        initialAuth={account}
        productChrome={false}
        productNavigation={false}
      />)
      expect(markup).toContain('记录此刻想法...')
      expect(arkmeSourceComposerDraftKey(10001, source)).toContain(`:${source.kind}:`)
    }
  })

  it('keeps Arko draft separate from ordinary conversations across remounts', () => {
    arkmeAuthStore.setAuth(account)
    const arkoKey = arkmeArkoComposerDraftKey(10001)
    const sourceKey = arkmeSourceComposerDraftKey(10001, sourceA)
    arkmeComposerDraftStore.setText(arkoKey, 'Arko 未发送问题')
    arkmeComposerDraftStore.setText(sourceKey, '普通会话草稿')

    const firstMount = renderToStaticMarkup(<ArkmeArkoSurface />)
    const secondMount = renderToStaticMarkup(<ArkmeArkoSurface />)

    expect(firstMount).toContain('Arko 未发送问题')
    expect(firstMount).not.toContain('普通会话草稿')
    expect(secondMount).toContain('Arko 未发送问题')
  })

  it('clears every draft owned by the account when authentication logs out', () => {
    arkmeAuthStore.setAuth(account)
    const sourceKey = arkmeSourceComposerDraftKey(10001, sourceA)
    const arkoKey = arkmeArkoComposerDraftKey(10001)
    arkmeComposerDraftStore.setText(sourceKey, '会话草稿')
    arkmeComposerDraftStore.setText(arkoKey, 'Arko 草稿')

    arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })

    expect(arkmeComposerDraftStore.get(sourceKey).text).toBe('')
    expect(arkmeComposerDraftStore.get(arkoKey).text).toBe('')
  })

  it('renders selected rich emoji as an atomic editable object inside the real input surface', () => {
    const markup = renderToStaticMarkup(<ArkmeRichComposerInput
      value={`前${ARKME_COMPOSER_EMOJI_PLACEHOLDER}后`}
      mentions={[]}
      emojis={[{ emojiId: 'angry_face', startIndex: 1 }]}
      maxLength={20_000}
      placeholder="发送消息"
      ariaLabel="发送消息"
      disabled={false}
      style={{ minHeight: 38, fontSize: 13, lineHeight: '21px' }}
      onTextChange={() => {}}
    />)

    expect(markup).toContain('contenteditable="true"')
    expect(markup).toContain('data-arkme-rich-composer="true"')
    expect(markup).not.toContain('<textarea')
    expect(richComposerSource).toContain("atom.contentEditable = 'false'")
    expect(richComposerSource).toContain('atom.dataset.arkmeEditableEmoji = run.emoji.id')
    expect(richComposerSource).toContain('root.replaceChildren(fragment)')
    expect(richComposerSource).toContain("height: '1.45em', margin: 0")
    expect(richComposerSource).not.toContain("margin: '0 0.12em'")
    expect(richComposerSource).not.toContain("padding: '0 0.12em'")
    expect(richComposerSource).not.toContain("userSelect: 'all'")
    expect(richComposerSource).toContain('emojiAtomSemanticOffset(event.currentTarget, event.target)')
    expect(richComposerSource).toContain('applySelection(atomOffset, atomOffset + 1)')
  })

  it('shows the placeholder only for an empty draft without any focus-dependent contract', () => {
    const renderComposer = (value: string) => renderToStaticMarkup(<ArkmeRichComposerInput
      value={value}
      mentions={[]}
      emojis={[]}
      maxLength={20_000}
      placeholder="发消息到 前端重构(11人)"
      ariaLabel="发消息到 前端重构(11人)"
      disabled={false}
      style={{ minHeight: 38, fontSize: 13, lineHeight: '21px' }}
      onTextChange={() => {}}
    />)

    const empty = renderComposer('')
    const drafted = renderComposer('正在输入')
    const newlineDraft = renderComposer('\n')

    expect(empty).toContain('发消息到 前端重构(11人)')
    expect(empty).toContain('aria-label="发消息到 前端重构(11人)"')
    expect(drafted).not.toContain('>发消息到 前端重构(11人)</div>')
    expect(newlineDraft).not.toContain('>发消息到 前端重构(11人)</div>')
    expect(drafted).toContain('aria-label="发消息到 前端重构(11人)"')
  })

  it('restores the placeholder when the IME-owned editor content becomes empty before draft commit', () => {
    stubComposerDom()

    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(<ArkmeRichComposerInput
        value=""
        mentions={[]}
        emojis={[]}
        maxLength={20_000}
        placeholder="发消息到 前端重构(11人)"
        ariaLabel="发消息到 前端重构(11人)"
        disabled={false}
        style={{ minHeight: 38, fontSize: 13, lineHeight: '21px' }}
        onTextChange={() => {}}
      />)
    })
    const placeholder = () => renderer.root.findAll(node =>
      node.props['aria-hidden'] === true && node.children.includes('发消息到 前端重构(11人)'))

    expect(placeholder()).toHaveLength(1)
    const editor = renderer.root.findByProps({ 'data-arkme-rich-composer': 'true' })
    const root = new FakeComposerElement()
    act(() => {
      root.childNodes.push(new FakeComposerNode(FakeComposerNode.TEXT_NODE, '正在输入'))
      editor.props.onInput({ currentTarget: root, nativeEvent: { isComposing: true } })
    })
    expect(placeholder()).toHaveLength(0)
    act(() => {
      root.childNodes.splice(0)
      editor.props.onInput({ currentTarget: root, nativeEvent: { isComposing: true } })
    })
    expect(placeholder()).toHaveLength(1)
    act(() => { renderer.unmount() })
  })

  it('treats the browser empty-editor BR filler as empty after clearing committed text', () => {
    stubComposerDom()

    function Harness() {
      const [value, setValue] = useState('正在输入')
      return <ArkmeRichComposerInput
        value={value}
        mentions={[]}
        emojis={[]}
        maxLength={20_000}
        placeholder="发消息到 前端重构(11人)"
        ariaLabel="发消息到 前端重构(11人)"
        disabled={false}
        style={{ minHeight: 38, fontSize: 13, lineHeight: '21px' }}
        onTextChange={setValue}
      />
    }

    let renderer: ReactTestRenderer
    act(() => { renderer = create(<Harness />) })
    const root = new FakeComposerElement()
    root.childNodes.push(new FakeComposerElement('BR'))

    act(() => {
      renderer.root.findByProps({ 'data-arkme-rich-composer': 'true' }).props.onInput({
        currentTarget: root,
        nativeEvent: { isComposing: false },
      })
    })

    expect(renderer.root.findAll(node =>
      node.props['aria-hidden'] === true && node.children.includes('发消息到 前端重构(11人)'))).toHaveLength(1)
    act(() => { renderer.unmount() })
  })

  it('keeps a real newline distinct from the browser empty-editor BR filler', () => {
    stubComposerDom()

    const onTextChange = vi.fn()
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(<ArkmeRichComposerInput
        value=""
        mentions={[]}
        emojis={[]}
        maxLength={20_000}
        placeholder="记录此刻想法..."
        ariaLabel="记录此刻想法..."
        disabled={false}
        style={{ minHeight: 38, fontSize: 13, lineHeight: '21px' }}
        onTextChange={onTextChange}
      />)
    })
    const root = new FakeComposerElement()
    root.childNodes.push(new FakeComposerNode(FakeComposerNode.TEXT_NODE, '\n'))

    act(() => {
      renderer.root.findByProps({ 'data-arkme-rich-composer': 'true' }).props.onInput({
        currentTarget: root,
        nativeEvent: { isComposing: false },
      })
    })

    expect(onTextChange).toHaveBeenCalledWith('\n')
    expect(renderer.root.findAll(node =>
      node.props['aria-hidden'] === true && node.children.includes('记录此刻想法...'))).toHaveLength(0)
    act(() => { renderer.unmount() })
  })

  it('pastes plain tagged text at the selection and leaves the caret after it for rich-span restoration', () => {
    stubComposerDom()
    const onTextChange = vi.fn()
    const onSelectionChange = vi.fn()
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(<ArkmeRichComposerInput
        value="前"
        mentions={[]}
        emojis={[]}
        maxLength={20_000}
        placeholder="发送消息"
        ariaLabel="发送消息"
        disabled={false}
        style={{ minHeight: 38, fontSize: 13, lineHeight: '21px' }}
        onTextChange={onTextChange}
        onSelectionChange={onSelectionChange}
      />)
    })
    const pasted = ' #项目\n＃待办'
    const preventDefault = vi.fn()
    act(() => {
      renderer.root.findByProps({ 'data-arkme-rich-composer': 'true' }).props.onPaste({
        currentTarget: new FakeComposerElement(),
        clipboardData: { getData: () => pasted },
        defaultPrevented: false,
        preventDefault,
      })
    })

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(onTextChange).toHaveBeenCalledWith(`前${pasted}`)
    expect(onSelectionChange).toHaveBeenCalledWith(`前${pasted}`, 1 + pasted.length, 1 + pasted.length)
    act(() => { renderer.unmount() })
  })

  it('restores the empty-draft placeholder when oversized editor content is rejected', () => {
    stubComposerDom()

    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(<ArkmeRichComposerInput
        value=""
        mentions={[]}
        emojis={[]}
        maxLength={2}
        placeholder="记录此刻想法..."
        ariaLabel="记录此刻想法..."
        disabled={false}
        style={{ minHeight: 38, fontSize: 13, lineHeight: '21px' }}
        onTextChange={() => {}}
      />)
    })
    const root = new FakeComposerElement()
    root.childNodes.push(new FakeComposerNode(FakeComposerNode.TEXT_NODE, '超过限制'))

    act(() => {
      renderer.root.findByProps({ 'data-arkme-rich-composer': 'true' }).props.onInput({
        currentTarget: root,
        nativeEvent: { isComposing: false },
      })
    })

    expect(renderer.root.findAll(node =>
      node.props['aria-hidden'] === true && node.children.includes('记录此刻想法...'))).toHaveLength(1)
    act(() => { renderer.unmount() })
  })
})
