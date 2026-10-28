import { JSDOM } from 'jsdom'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useArkmeMessageActions, type ArkmeMessageActionViewItem } from '../src/client/ArkmeMessageActions.js'
import { ArkmeActionMenu } from '../src/client/ArkmeDshMenu.js'

const mocks = vi.hoisted(() => ({ copyText: vi.fn() }))
vi.mock('../src/client/clipboard-text.js', () => ({ copyText: mocks.copyText }))

const item: ArkmeMessageActionViewItem = {
  id: 'message', copyText: '前缀选中文字后缀', actionRef: 'ref', conversationRef: 'conversation',
  copyLinkAvailable: true, forwardAvailable: true,
}
function Harness() {
  const actions = useArkmeMessageActions({ scopeKey: 'conversation', items: [item] })
  return <><div onContextMenu={event => actions.openMenu(item, event)} />{actions.overlay}</>
}
let renderer: ReactTestRenderer
let dom: JSDOM
beforeEach(() => {
  dom = new JSDOM('<div id="bubble">前缀选中文字后缀</div>')
  mocks.copyText.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout })
})
afterEach(() => { act(() => renderer?.unmount()); dom.window.close(); vi.unstubAllGlobals() })

async function open(withSelection: boolean) {
  const bubble = dom.window.document.getElementById('bubble')!
  if (withSelection) dom.window.getSelection()!.setBaseAndExtent(bubble.firstChild!, 2, bubble.firstChild!, 6)
  await act(async () => { renderer = create(<Harness />) })
  await act(async () => { renderer.root.findByType('div').props.onContextMenu({ currentTarget: bubble, clientX: 20, clientY: 20, preventDefault() {}, stopPropagation() {} }) })
  return renderer.root.findByType(ArkmeActionMenu)
}

it('copies the captured selection after the menu has taken focus and the live selection disappeared', async () => {
  const menu = await open(true)
  expect(menu.props.label).toBe('选中文字操作')
  expect(menu.props.actions.map((action: { id: string }) => action.id)).toEqual(['copy-selection', 'copy-whole-divider', 'copy-whole'])
  dom.window.getSelection()!.removeAllRanges()
  await act(async () => menu.props.actions[0].onSelect())
  expect(mocks.copyText).toHaveBeenCalledWith('选中文字')
  expect(renderer.root.findAllByType(ArkmeActionMenu)).toHaveLength(0)
})

it('retains an explicit whole-message choice when a partial selection exists', async () => {
  const menu = await open(true)
  await act(async () => menu.props.actions[2].onSelect())
  expect(mocks.copyText).toHaveBeenCalledWith(item.copyText)
})

it('retains the normal message menu and copy without a text selection', async () => {
  const menu = await open(false)
  expect(menu.props.label).toBe('消息操作')
  expect(menu.props.actions.map((action: { id: string }) => action.id)).toEqual(['copy', 'link', 'select', 'forward'])
  await act(async () => menu.props.actions[0].onSelect())
  expect(mocks.copyText).toHaveBeenCalledWith(item.copyText)
})
