import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { ArkmeRichText } from '../src/client/ArkmeRichText.js'
import { arkmeLinkMetadataResolver } from '../src/client/link-metadata-client.js'

describe('shared emoji presentation', () => {
  it.each(['body', 'preview'] as const)('preserves URL syntax before parsing emoji in %s text', presentation => {
    const href = 'https://example.com/?value=[jm_emoji:heart_eyes]'
    let renderer!: ReturnType<typeof create>
    act(() => { renderer = create(<ArkmeRichText presentation={presentation} linkLabelMode="raw"
      text={`${href} [im_emoji:thumb_up]`} />) })
    expect(renderer.root.findAllByType('img')).toHaveLength(1)
    expect(renderer.root.findByType('img').props['data-arkme-rich-emoji']).toBe('thumb_up')
    if (presentation === 'body') expect(renderer.root.findByType('a').props.href).toBe(href)
    else expect(renderer.root.findAllByType('a')).toHaveLength(0)
    expect(JSON.stringify(renderer.toJSON())).toContain(href)
    act(() => { renderer.unmount() })
  })

  it('leaves native copying alone when the selection has no emoji', () => {
    let renderer!: ReturnType<typeof create>
    act(() => { renderer = create(<ArkmeRichText text="https://example.com 普通文本" linkLabelMode="raw" />) })
    const event = { currentTarget: { ownerDocument: { getSelection: () => ({
      rangeCount: 1, isCollapsed: false, anchorNode: {}, focusNode: {},
      getRangeAt: () => ({ cloneContents: () => ({ textContent: '普通文本', querySelectorAll: () => [] }) }),
    }) }, contains: () => true }, clipboardData: { setData: vi.fn() }, preventDefault: vi.fn() }
    renderer.root.find(node => node.type === 'span' && node.props.onCopy !== undefined).props.onCopy(event)
    expect(event.clipboardData.setData).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    act(() => { renderer.unmount() })
  })

  it('keeps previews non-interactive and never resolves link metadata, including remounts', () => {
    const resolve = vi.spyOn(arkmeLinkMetadataResolver, 'resolve')
    try {
      for (let i = 0; i < 3; i++) {
        let renderer!: ReturnType<typeof create>
        act(() => { renderer = create(<ArkmeRichText presentation="preview" highlightMentions
          text="@小林 #话题 [jm_emoji:heart_eyes][im_emoji:thumb_up] https://example.com" />) })
        expect(renderer.root.findAllByType('img')).toHaveLength(2)
        expect(renderer.root.findAllByType('a')).toHaveLength(0)
        expect(renderer.root.findAll(node => node.props.role === 'link' || node.props.tabIndex !== undefined)).toHaveLength(0)
        expect(resolve).not.toHaveBeenCalled()
        act(() => { renderer.unmount() })
      }
    } finally { resolve.mockRestore() }
  })

  it('falls back to readable Unicode when an asset fails and resets for another emoji', () => {
    let renderer!: ReturnType<typeof create>
    act(() => { renderer = create(<ArkmeRichText text="[jm_emoji:heart_eyes]" />) })
    const img = renderer.root.findByType('img')
    expect(img.props['aria-label']).toBe('喜欢')
    act(() => { img.props.onError() })
    expect(renderer.root.findAllByType('img')).toHaveLength(0)
    expect(JSON.stringify(renderer.toJSON())).toContain('😍')
    act(() => { renderer.update(<ArkmeRichText text="[im_emoji:thumb_up]" />) })
    expect(renderer.root.findByType('img').props['data-arkme-rich-emoji']).toBe('thumb_up')
    act(() => { renderer.unmount() })
  })

  it.each([false, true])('copies emoji from a real selection, excludes read badges (%s), and leaves cross-block selection alone', withReadBadge => {
    let renderer!: ReturnType<typeof create>
    act(() => { renderer = create(<ArkmeRichText text="前[jm_emoji:heart_eyes]后" />) })
    const dom = new JSDOM('<div id="message"></div><p id="outside">另一条消息</p>')
    const doc = dom.window.document
    const message = doc.getElementById('message')!
    message.innerHTML = `<b>前<img data-arkme-rich-emoji="heart_eyes">${withReadBadge ? '<span data-arkme-mention-read>已读</span>' : ''}</b><span>后</span>`
    const range = doc.createRange()
    range.selectNodeContents(message)
    doc.getSelection()!.addRange(range)
    const event = { currentTarget: message,
      clipboardData: { setData: vi.fn() }, preventDefault: vi.fn() }
    const copy = renderer.root.find(node => node.type === 'span' && node.props.onCopy !== undefined).props.onCopy
    copy(event)
    expect(event.clipboardData.setData).toHaveBeenCalledWith('text/plain', '前😍后')
    expect(event.clipboardData.setData).toHaveBeenCalledWith('text/html', '<b>前😍</b><span>后</span>')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(message.querySelectorAll('img[data-arkme-rich-emoji]')).toHaveLength(1)
    expect(message.querySelectorAll('[data-arkme-mention-read]')).toHaveLength(withReadBadge ? 1 : 0)
    event.clipboardData.setData.mockClear()
    event.preventDefault.mockClear()
    range.setEnd(doc.getElementById('outside')!.firstChild!, 2)
    copy(event)
    expect(event.clipboardData.setData).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    act(() => { renderer.unmount() })
    dom.window.close()
  })
})
