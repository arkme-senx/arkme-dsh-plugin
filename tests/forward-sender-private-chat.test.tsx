// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/client/api.js')>()),
  callArkme: mocks.callArkme,
}))

const { ForwardRecordsDetail, arkmeForwardSenderChatPeerId } = await import('../src/client/ArkmeNoteDetails.js')
type TimelineItem = import('../src/types.js').ArkmeTimelineItem
type ArkmeSourceItem = import('../src/types.js').ArkmeSourceItem

let host: HTMLDivElement
let root: Root

const flush = async () => { await act(async () => { await Promise.resolve() }) }
const hoverEntries = () => document.querySelectorAll('[data-arkme-forward-sender-hover]')
const menu = () => document.querySelector<HTMLElement>('[role="menu"]')

function forwarded(items: Array<Record<string, unknown>>): TimelineItem {
  return {
    itemUid: 'forward-1', senderName: '我', isMe: true, sendAtMillis: 1, status: 1, title: '', textContent: '',
    forwardRecords: { title: 'Tison和花朝之间的快记', createdAtMillis: 1, summaryLines: [], items },
  } as unknown as TimelineItem
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  mocks.callArkme.mockReset()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

const render = async (item: TimelineItem, onPrivateChatOpened?: (source: ArkmeSourceItem) => void) => {
  await act(async () => {
    root.render(<ForwardRecordsDetail item={item} onClose={vi.fn()}
      {...(onPrivateChatOpened === undefined ? {} : { onPrivateChatOpened })} />)
  })
  await flush()
}

it('offers a private chat from the avatar of a resolved other sender', async () => {
  const opened = vi.fn()
  const source = { sourceRef: 'private:7', kind: 'private_chat', displayName: '花朝' } as unknown as ArkmeSourceItem
  mocks.callArkme.mockResolvedValue({ source })
  await render(forwarded([
    { senderName: '花朝', senderUserId: 7, sendAtMillis: 1, title: '', textContent: '你好' },
  ]), opened)

  expect(hoverEntries()).toHaveLength(1)
  await act(async () => {
    hoverEntries()[0]!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
  })
  await flush()
  const entry = [...menu()!.querySelectorAll('button')].find(button => button.textContent?.includes('发起私聊'))
  expect(entry).toBeDefined()

  await act(async () => { entry!.click() })
  await flush()
  expect(mocks.callArkme).toHaveBeenCalledWith('chat.private.open', { peerUserId: 7, displayName: '花朝' })
  expect(opened).toHaveBeenCalledWith(source)
  expect(menu()).toBeNull()
})

it('keeps the card open and shows the failure when the chat cannot be opened', async () => {
  const opened = vi.fn()
  mocks.callArkme.mockRejectedValue(new Error('对方暂时无法接收消息'))
  await render(forwarded([
    { senderName: '花朝', senderUserId: 7, sendAtMillis: 1, title: '', textContent: '你好' },
  ]), opened)
  await act(async () => {
    hoverEntries()[0]!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
  })
  await flush()
  await act(async () => {
    [...menu()!.querySelectorAll('button')].find(button => button.textContent?.includes('发起私聊'))!.click()
  })
  await flush()
  expect(opened).not.toHaveBeenCalled()
  expect(menu()?.textContent).toContain('对方暂时无法接收消息')
})

it('adds no hover entry without a resolved account identity', async () => {
  await render(forwarded([
    { senderName: '花朝', sendAtMillis: 1, title: '', textContent: '只有名字和头像' },
  ]), vi.fn())
  expect(hoverEntries()).toHaveLength(0)
})

it('adds no hover entry when the surface cannot navigate to a conversation', async () => {
  await render(forwarded([
    { senderName: '花朝', senderUserId: 7, sendAtMillis: 1, title: '', textContent: '你好' },
  ]))
  expect(hoverEntries()).toHaveLength(0)
})

it('never treats a transcript speaker as an account identity', async () => {
  await render(forwarded([
    { senderName: '花朝', senderUserId: 7, sendAtMillis: 1, title: '', textContent: '你好' },
    {
      senderName: '花朝', senderUserId: 7, sendAtMillis: 2, title: '', textContent: '',
      segments: [{ speakerNumber: 1, speakerName: '说话人 1', textContent: '转写内容', startMillis: 0, endMillis: 1 }],
    },
  ]), vi.fn())
  // The speaker label reuses the sender's name and photo, but it is not an
  // account: only the record sender row gets the hover entry.
  expect(document.querySelectorAll('[data-arkme-forward-segment]')).toHaveLength(1)
  expect(hoverEntries()).toHaveLength(1)
  expect(document.querySelector('[data-arkme-forward-segment] [data-arkme-forward-sender-hover]')).toBeNull()
})

it('adds no hover entry when the snapshot is a recording transcript', async () => {
  await render(forwarded([
    {
      senderName: '花朝', senderUserId: 7, sendAtMillis: 1, title: '', textContent: '',
      sourceType: 'long_recording_segments',
      segments: [{ speakerNumber: 1, speakerName: '说话人 1', textContent: '转写内容', startMillis: 0, endMillis: 1 }],
    },
  ]), vi.fn())
  expect(hoverEntries()).toHaveLength(0)
})

it('resolves the chat target only for a resolved record sender', () => {
  expect(arkmeForwardSenderChatPeerId(7, false, true)).toBe(7)
  expect(arkmeForwardSenderChatPeerId(undefined, false, true)).toBeUndefined()
  // A speaker row must stay inert even if a caller ever hands it an id.
  expect(arkmeForwardSenderChatPeerId(7, true, true)).toBeUndefined()
  expect(arkmeForwardSenderChatPeerId(7, false, false)).toBeUndefined()
})
