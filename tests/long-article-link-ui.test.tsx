import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeLongArticleDialog } from '../src/client/ArkmeLongArticleDialog.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))

vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))

beforeEach(() => {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
    clearInterval: (timer: ReturnType<typeof setInterval>) => clearInterval(timer),
  })
  mocks.callArkme.mockReset()
})

afterEach(() => { vi.unstubAllGlobals() })

describe('Arkme long-article link presentation', () => {
  it('projects the Host action reference as soon as a new article is confirmed', async () => {
    const onCreated = vi.fn()
    const onClose = vi.fn()
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('article-record')
      .mockReturnValueOnce('article-relation') })
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.long-article.draft.get') return undefined
      if (operation === 'source.long-article.draft.delete') return undefined
      if (operation === 'source.send-rich') return {
        sourceRef: 'source-1', itemUid: 'article-record', status: 1, localState: 'synced',
        messageActionRef: 'opaque-article-message-action',
      }
      throw new Error(`unexpected operation ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeLongArticleDialog sourceRef="source-1" onClose={onClose} onCreated={onCreated} />)
      await Promise.resolve()
    })
    const inputs = renderer.root.findAllByType('input')
    const body = renderer.root.findByType('textarea')
    await act(async () => {
      inputs[0]!.props.onChange({ target: { value: '长文标题' } })
      body.props.onChange({ target: { value: '长文正文' } })
      await Promise.resolve()
    })
    const publish = renderer.root.find(node => node.type === 'button'
      && node.children.some(child => typeof child === 'string' && child.includes('发布')))
    await act(async () => {
      publish.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({
      itemUid: 'article-record',
      messageActionRef: 'opaque-article-message-action',
    }))
    expect(onClose).toHaveBeenCalledOnce()
    await act(async () => { renderer.unmount() })
  })

  it('renders safe links through the real read-mode dialog', async () => {
    mocks.callArkme.mockResolvedValue({
      sourceRef: 'source-1', itemUid: 'article-1', title: '长文链接',
      textContent: '正文 https://example.com/article [jm_emoji:angry_face]', sendAtMillis: 1, updateAtMillis: 1,
      recordDurationMillis: 0, editDurationMillis: 0, thinkingDurationMillis: 0,
      version: 1, editable: false,
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeLongArticleDialog sourceRef="source-1" item={{
        itemUid: 'article-1', senderName: '我', isMe: true, sendAtMillis: 1, status: 1,
        title: '长文链接', textContent: '旧正文', templateKind: 8,
      }} onClose={() => undefined} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    const link = renderer.root.findByProps({ 'data-arkme-text-link': 'true' })
    expect(link.props).toMatchObject({
      href: 'https://example.com/article',
      target: '_blank',
      rel: 'noopener noreferrer',
      'data-arkme-link-title': 'raw',
    })
    expect(link.findByProps({ 'data-arkme-link-label': 'true' }).children).toEqual([
      'https://example.com/article',
    ])
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'link.metadata')).toHaveLength(0)
    expect(renderer.root.findAllByType('textarea')).toHaveLength(0)
    expect(renderer.root.findAllByProps({ 'data-arkme-rich-emoji': 'angry_face' })).toHaveLength(0)
    await act(async () => { renderer.unmount() })
  })
})
