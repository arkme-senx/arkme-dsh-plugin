import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), patch: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/conversation-members-store.js', () => ({ arkmeConversationMembers: { patchSelfNickname: mocks.patch } }))
import { ArkmeGroupSelfNicknameDialog } from '../src/client/ArkmeGroupSelfNicknameDialog.js'
import { ArkmeConfirmDialog } from '../src/client/ArkmeConfirmDialog.js'
const source: ArkmeSourceItem = { sourceRef: 'group', kind: 'group_chat', displayName: '群' }
let renderer: ReactTestRenderer | undefined
const close = vi.fn(), saved = vi.fn()
const render = () => create(<ArkmeGroupSelfNicknameDialog source={source} accountScope="test:1" onClose={close} onSaved={saved} />)
afterEach(async () => { await act(async () => { renderer?.unmount() }); renderer = undefined; vi.clearAllMocks() })
it('prefills, counts Unicode, prevents duplicate writes and keeps failed input for retry', async () => {
  let finish!: (value: unknown) => void
  mocks.call.mockImplementation(async (op: string) => op.endsWith('.set') ? await new Promise(resolve => { finish = resolve }) : { nickname: '原昵称', memberRef: 'self', sourceRef: 'group' })
  await act(async () => { renderer = render() })
  const input = () => renderer!.root.findByType('input')
  const dialog = () => renderer!.root.findByType(ArkmeConfirmDialog)
  expect(input().props.value).toBe('原昵称')
  for (const value of ['   ', '😀'.repeat(11)]) {
    await act(async () => { input().props.onChange({ target: { value } }) })
    expect(dialog().props.confirmDisabled).toBe(true)
  }
  await act(async () => { input().props.onChange({ target: { value: '  ' + '😀'.repeat(10) + '  ' } }) })
  expect(dialog().props.confirmDisabled).toBe(false)
  await act(async () => { dialog().props.onConfirm(); dialog().props.onConfirm() })
  expect(mocks.call.mock.calls.filter(call => call[0].endsWith('.set'))).toHaveLength(1)
  expect(dialog().props.busy).toBe(true)
  await act(async () => { finish({ sourceRef: 'group', memberRef: 'self', nickname: '服务端昵称' }) })
  expect(mocks.patch).toHaveBeenCalledWith('test:1', source, 'self', '服务端昵称')
  expect(close).toHaveBeenCalledOnce()
  mocks.call.mockRejectedValueOnce(new Error('保存失败'))
  await act(async () => { dialog().props.onConfirm() })
  expect(input().props.value.trim()).toBe('😀'.repeat(10))
  expect(dialog().props.error).toBe('保存失败')
  expect(dialog().props.busy).toBe(false)
})
it('offers read retry and ignores write completion after unmount', async () => {
  mocks.call.mockRejectedValueOnce(new Error('读取失败')).mockResolvedValueOnce({ nickname: '昵称', memberRef: 'self', sourceRef: 'group' })
  await act(async () => { renderer = render() })
  expect(renderer!.root.findByType(ArkmeConfirmDialog).props.confirmDisabled).toBe(true)
  await act(async () => { renderer!.root.findAllByType('button').find(button => button.children.includes('重试'))!.props.onClick() })
  let finish!: (value: unknown) => void
  mocks.call.mockImplementationOnce(async () => await new Promise(resolve => { finish = resolve }))
  await act(async () => { renderer!.root.findByType(ArkmeConfirmDialog).props.onConfirm() })
  const signal = mocks.call.mock.calls.at(-1)![2] as AbortSignal
  await act(async () => { renderer!.unmount(); renderer = undefined })
  expect(signal.aborted).toBe(true)
  await act(async () => { finish({ sourceRef: 'group', memberRef: 'self', nickname: '新昵称' }) })
  expect(mocks.patch).not.toHaveBeenCalled()
  expect(saved).not.toHaveBeenCalled()
})
