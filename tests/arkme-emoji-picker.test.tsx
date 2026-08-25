import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeEmojiPicker } from '../src/client/ArkmeEmojiPicker.js'
import {
  arkmeDefaultEmojis, insertArkmeEmojiAtSelection, nextArkmeRecentEmojiIds,
} from '../src/client/arkme-emoji.js'

describe('Arkme emoji composer', () => {
  it('keeps the desktop catalog order and labels while using portable Unicode', () => {
    expect(arkmeDefaultEmojis).toHaveLength(56)
    expect(arkmeDefaultEmojis.slice(0, 3)).toEqual([
      { id: 'angry_face', unicode: '😡', label: '生气' },
      { id: 'awkward_face', unicode: '😐', label: '尴尬' },
      { id: 'heart_eyes', unicode: '😍', label: '喜欢' },
    ])
  })

  it('inserts an emoji at the current selection and returns the next caret', () => {
    expect(insertArkmeEmojiAtSelection('你好世界', arkmeDefaultEmojis[3]!, 2, 3)).toEqual({
      text: '你好😊界',
      caretIndex: 4,
    })
    expect(insertArkmeEmojiAtSelection('1234', arkmeDefaultEmojis[3]!, 4, 4, 5)).toBeUndefined()
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
    act(() => { trigger.props.onClick() })
    expect(renderer.root.findByProps({ 'data-arkme-emoji-panel': true })).toBeDefined()
    expect(renderer.root.findAllByProps({ 'data-arkme-emoji-id': 'angry_face' })).toHaveLength(1)

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
})
