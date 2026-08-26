import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeEmojiPicker } from '../src/client/ArkmeEmojiPicker.js'
import { arkmeComposerToolButtonStyle } from '../src/client/ArkmeComposerToolButton.js'
import {
  arkmeDefaultEmojis, insertArkmeEmojiAtSelection, nextArkmeRecentEmojiIds,
} from '../src/client/arkme-emoji.js'

const { callArkme } = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme }))

const favoriteList = {
  items: [
    {
      fileAssetUid: 'asset-first-1234', fileName: 'first.gif', mimeType: 'image/gif', size: 128, fileKind: 1,
      isAnimated: true, isAvailable: true, mediaRef: 'media:first',
    },
    {
      fileAssetUid: 'asset-missing-12', fileName: 'missing.png', mimeType: 'image/png', size: 64, fileKind: 1,
      isAnimated: false, isAvailable: false, unavailableReason: '文件已失效',
    },
  ],
  itemCount: 2,
  updatedAtMillis: 1,
}

describe('Arkme emoji composer', () => {
  it('keeps the desktop catalog order, rich tokens, and custom SVG assets', () => {
    expect(arkmeDefaultEmojis).toHaveLength(56)
    expect(arkmeDefaultEmojis.slice(0, 3)).toMatchObject([
      { id: 'angry_face', unicode: '😡', label: '生气' },
      { id: 'awkward_face', unicode: '😐', label: '尴尬' },
      { id: 'heart_eyes', unicode: '😍', label: '喜欢' },
    ])
    expect(arkmeDefaultEmojis[0]).toMatchObject({ assetIndex: 1, token: '[jm_emoji:angry_face]' })
    expect(arkmeDefaultEmojis[0]?.assetUrl).toMatch(/^data:image\/svg\+xml;base64,/u)
  })

  it('inserts an emoji at the current selection and returns the next caret', () => {
    const emoji = arkmeDefaultEmojis[3]!
    expect(insertArkmeEmojiAtSelection('你好世界', emoji, 2, 3)).toEqual({
      text: `你好${emoji.token}界`,
      caretIndex: 2 + emoji.token.length,
    })
    expect(insertArkmeEmojiAtSelection('1234', emoji, 4, 4, 5)).toBeUndefined()
  })

  it('deduplicates recent selections, removes unknown ids, and caps the row', () => {
    expect(nextArkmeRecentEmojiIds(['thumb_up', 'missing', 'joy_face'], 'joy_face', 2))
      .toEqual(['joy_face', 'thumb_up'])
  })

  it('opens the DSH-styled panel, supports continuous selection, and closes on scope change', () => {
    const selected: string[] = []
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(<ArkmeEmojiPicker
        disabled={false}
        scopeKey="private:1"
        onSelect={emoji => { selected.push(emoji.id) }}
      />)
    })

    const trigger = renderer.root.findByProps({ 'aria-label': '选择表情' })
    const triggerButton = renderer.root.findAllByType('button')
      .find(node => node.props['data-arkme-composer-tool'] === 'emoji')!
    expect(triggerButton.props.style).toEqual(arkmeComposerToolButtonStyle)
    expect(triggerButton.props.onMouseEnter).toBeUndefined()
    expect(triggerButton.props.onMouseLeave).toBeUndefined()
    act(() => { trigger.props.onClick() })
    expect(triggerButton.props.style).toEqual(arkmeComposerToolButtonStyle)
    const panel = renderer.root.findByProps({ 'data-arkme-emoji-panel': true })
    expect(panel.props.style).toMatchObject({ left: 0, bottom: 44 })
    expect(renderer.root.findByProps({ 'data-arkme-emoji-picker': true }).props.style).toMatchObject({ position: 'relative' })
    expect(renderer.root.findAllByProps({ 'data-arkme-emoji-id': 'angry_face' })).toHaveLength(1)
    expect(renderer.root.findByProps({ 'data-arkme-emoji-id': 'angry_face' }).findByType('img').props.src)
      .toMatch(/^data:image\/svg\+xml;base64,/u)
    expect(renderer.root.findByProps({ children: '创作者：牛mo王' })).toBeDefined()

    act(() => { renderer.root.findByProps({ 'data-arkme-emoji-id': 'angry_face' }).props.onClick() })
    act(() => { renderer.root.findByProps({ 'data-arkme-emoji-id': 'heart_eyes' }).props.onClick() })
    expect(selected).toEqual(['angry_face', 'heart_eyes'])
    expect(renderer.root.findByProps({ 'data-arkme-emoji-panel': true })).toBeDefined()

    act(() => {
      renderer.update(<ArkmeEmojiPicker disabled={false} scopeKey="group:2" onSelect={vi.fn()} />)
    })
    expect(renderer.root.findAllByProps({ 'data-arkme-emoji-panel': true })).toHaveLength(0)
    act(() => { renderer.unmount() })
  })

  it('matches desktop favorite sticker layout, recovery states, and context actions', async () => {
    callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'favorite-stickers.list' || operation === 'favorite-stickers.manage') return favoriteList
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeEmojiPicker
        disabled={false} scopeKey="private:1" sourceRef="source-ref" onSelect={() => undefined}
      />)
    })
    await act(async () => { renderer.root.findByProps({ 'aria-label': '选择表情' }).props.onClick() })
    await act(async () => { renderer.root.findByProps({ 'aria-label': '收藏表情' }).props.onClick() })

    expect(renderer.root.findByProps({ 'data-arkme-favorite-sticker-grid': 'true' }).props.style)
      .toMatchObject({ gridTemplateColumns: 'repeat(5, 82px)', gap: 8 })
    expect(renderer.root.findByProps({ 'aria-label': '添加收藏表情' })).toBeDefined()
    expect(renderer.root.findByProps({ 'aria-label': 'missing.png不可用' }).props.title).toBe('文件已失效')
    expect(renderer.root.findByProps({ children: 'GIF' })).toBeDefined()

    const first = renderer.root.findByProps({ 'aria-label': '发送first.gif' })
    await act(async () => {
      first.props.onContextMenu({ preventDefault: () => undefined, stopPropagation: () => undefined, clientX: 220, clientY: 220 })
    })
    expect(renderer.root.findByProps({ children: '移至最前' })).toBeDefined()
    expect(renderer.root.findByProps({ children: '删除' })).toBeDefined()
    await act(async () => { renderer.root.findByProps({ children: '移至最前' }).props.onClick() })
    expect(callArkme).toHaveBeenCalledWith('favorite-stickers.manage', {
      fileAssetUid: 'asset-first-1234', action: 'move-to-front',
    })

    const preview = renderer.root.findByType('img')
    await act(async () => { preview.props.onError() })
    expect(renderer.root.findByProps({ 'aria-label': '重试first.gif' })).toBeDefined()
    await act(async () => { renderer.unmount() })
  })

  it('keeps favorites visible but does not offer unsupported sending outside chats', async () => {
    callArkme.mockResolvedValue(favoriteList)
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeEmojiPicker disabled={false} scopeKey="self" onSelect={() => undefined} />)
    })
    await act(async () => { renderer.root.findByProps({ 'aria-label': '选择表情' }).props.onClick() })
    await act(async () => { renderer.root.findByProps({ 'aria-label': '收藏表情' }).props.onClick() })

    const sticker = renderer.root.findByProps({ 'aria-label': 'first.gif仅聊天可发送' })
    expect(sticker.props['aria-disabled']).toBe(true)
    expect(sticker.props.title).toBe('收藏表情仅支持私聊和群聊发送')
    await act(async () => { sticker.props.onClick({}) })
    expect(callArkme).not.toHaveBeenCalledWith('favorite-stickers.send', expect.anything())
    await act(async () => { renderer.unmount() })
  })
})
