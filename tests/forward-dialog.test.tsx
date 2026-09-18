import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { ArkmeForwardDialog, ArkmeForwardTargetRow } from '../src/client/ArkmeForwardDialog.js'
import { ArkmeDirectorySourceAvatar } from '../src/client/ArkmeAvatar.js'
import type { ArkmeSourceItem } from '../src/types.js'

const target = { sourceRef: 'target', kind: 'private_chat', displayName: '接收人', activeAtMillis: 0 } as ArkmeSourceItem
let view: ReactTestRenderer | undefined
afterEach(async () => { await act(async () => view?.unmount()); view = undefined })
async function mount(selected: boolean, sending = false) {
  const send = vi.fn(); const close = vi.fn()
  await act(async () => { view = create(<ArkmeForwardDialog keyword="" onKeywordChange={() => {}} sending={sending}
    selectedTargets={selected ? [target] : []} previewTitle="DeepSeek Harness" previewSubtitle="1 条消息"
    comment="" onCommentChange={() => {}} error="" onClose={close} onSend={send}>
    <ArkmeForwardTargetRow target={target} selected={selected} meta="私聊" onToggle={() => {}} />
  </ArkmeForwardDialog>) })
  return { send, close }
}
it('shows target avatars immediately and composer only after selecting recipients', async () => {
  await mount(false)
  expect(view!.root.findAllByType(ArkmeDirectorySourceAvatar)).toHaveLength(1)
  expect(view!.root.findAllByType('textarea')).toHaveLength(0)
  expect(view!.root.findByType('h3').props.style.textAlign).toBe('center')
  expect(view!.root.findByType('input').props['aria-label']).toBe('搜索转发对象')
})
it('uses the Arkme recipient strip and composer, preserving IME and Shift+Enter', async () => {
  const { send } = await mount(true)
  expect(view!.root.findAllByType(ArkmeDirectorySourceAvatar)).toHaveLength(2)
  const input = view!.root.findByType('textarea')
  expect(input.props['aria-label']).toBe('转发附言')
  for (const [shiftKey, isComposing] of [[true, false], [false, true]]) {
    const preventDefault = vi.fn()
    input.props.onKeyDown({ key: 'Enter', shiftKey, nativeEvent: { isComposing }, preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
  }
  expect(send).not.toHaveBeenCalled()
  input.props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, preventDefault: vi.fn() })
  expect(send).toHaveBeenCalledTimes(1)
})
it('disables close and composer while delivering and ignores backdrop dismissal', async () => {
  const { close, send } = await mount(true, true)
  expect(view!.root.findByType('textarea').props.disabled).toBe(true)
  expect(view!.root.findAllByType('button').filter(node => node.props['aria-label'] === '关闭转发对象选择').every(node => node.props.disabled)).toBe(true)
  const backdrop = view!.root.findByProps({ 'data-arkme-notification-blocking-overlay': 'true' })
  const node = {}; backdrop.props.onMouseDown({ target: node, currentTarget: node })
  expect(close).not.toHaveBeenCalled()
  view!.root.findByType('textarea').props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false }, preventDefault: vi.fn() })
  expect(send).not.toHaveBeenCalled()
})

it('describes native snapshots as forwarded notes, with the first selected speaker and body', async () => {
  const { nativeForwardPreview } = await import('../src/client/NativeForwardAction.js')
  const messages = [{ key: 'a', anchorSeq: 1, role: 'assistant' as const, text: '第一行\n  第二行', createdAtMillis: 1 }]
  const single = nativeForwardPreview({ sessionId: 'session', messages })
  expect(single).toEqual({ title: '我和DeepSeek Harness的快记', subtitle: 'DeepSeek Harness：第一行 第二行' })
  expect(single.icon).toBeUndefined()
  expect(nativeForwardPreview({ sessionId: 'session', messages: [{ ...messages[0]!, role: 'user', text: '问题' }, ...messages] })).toEqual({ title: '我和DeepSeek Harness的2条快记', subtitle: '我：问题' })
  expect(messages[0]!.text).toBe('第一行\n  第二行')
})
