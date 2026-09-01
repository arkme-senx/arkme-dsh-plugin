import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeConversationMemberItem, ArkmeSourceItem, ArkmeTimelineItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }))

import {
  ArkmeMessageWithdrawalDialog, arkmeCanWithdrawTimelineMessage,
} from '../src/client/ArkmeMessageWithdrawalDialog.js'
import { ArkmeGroupMemberRemoveDialog } from '../src/client/ArkmeChatMemberActions.js'

const group: ArkmeSourceItem = {
  sourceRef: 'group-ref', sourceKey: 'chat:group', kind: 'group_chat', displayName: '群聊',
  activeAtMillis: 1, unreadCount: 0,
}
const message: ArkmeTimelineItem = {
  itemUid: 'record-1', timelineItemKey: 'timeline-key-1',
  messageWithdrawalRef: 'arkme-message-withdrawal-v1.payload.signature',
  senderName: '小林', isMe: false, sendAtMillis: 1, title: '', textContent: '需要撤回的消息', status: 1,
}
const member: ArkmeConversationMemberItem = {
  memberRef: 'member-ref-1', displayName: '小林', role: 'member', status: 'active',
  isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 0, mentionCount: 0,
}

describe('group owner governance UI', () => {
  let renderer: ReactTestRenderer | undefined
  beforeEach(() => { mocks.callArkme.mockReset() })
  afterEach(async () => { await act(async () => { renderer?.unmount() }); renderer = undefined })

  it('offers withdrawal only to the group owner for another member message', () => {
    expect(arkmeCanWithdrawTimelineMessage(group, message, 'owner')).toBe(true)
    expect(arkmeCanWithdrawTimelineMessage(group, message, 'member')).toBe(false)
    expect(arkmeCanWithdrawTimelineMessage({ ...group, kind: 'private_chat' }, message, 'owner')).toBe(false)
    expect(arkmeCanWithdrawTimelineMessage(group, { ...message, isMe: true }, 'owner')).toBe(false)
    expect(arkmeCanWithdrawTimelineMessage(group, { ...message, messageWithdrawalRef: undefined }, 'owner')).toBe(false)
  })

  it('explains the exact scope and submits only the opaque withdrawal reference', async () => {
    const result = {
      messageWithdrawalRef: message.messageWithdrawalRef!, timelineItemKey: 'timeline-key-1',
      withdrawnAtMillis: 123, alreadyWithdrawn: false,
    }
    mocks.callArkme.mockResolvedValue(result)
    const onWithdrawn = vi.fn()
    await act(async () => {
      renderer = create(<ArkmeMessageWithdrawalDialog item={message} onClose={vi.fn()} onWithdrawn={onWithdrawn} />)
    })
    const text = JSON.stringify(renderer!.toJSON())
    expect(text).toContain('所有群成员都无法再查看')
    expect(text).toContain('不会移除或限制发送者')
    expect(renderer!.root.findByProps({ role: 'dialog' }).props['aria-busy']).toBeUndefined()
    await act(async () => {
      renderer!.root.findAllByType('button').filter(node => node.children.includes('确认撤回'))[0]!.props.onClick()
      await Promise.resolve()
    })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.message-withdraw', {
      messageWithdrawalRef: message.messageWithdrawalRef,
    }, expect.any(AbortSignal))
    expect(onWithdrawn).toHaveBeenCalledWith(result)
  })

  it('keeps removal separate from the optional future-join restriction and deduplicates submit', async () => {
    mocks.callArkme.mockImplementation(async () => await new Promise(() => undefined))
    await act(async () => {
      renderer = create(<ArkmeGroupMemberRemoveDialog
        sourceRef="group-ref"
        member={member}
        onClose={vi.fn()}
        onRemoved={vi.fn()}
      />)
    })
    const text = JSON.stringify(renderer!.toJSON())
    expect(text).toContain('禁止再次加入此群')
    expect(text).toContain('可在群聊设置中解除')
    expect(renderer!.root.findByProps({ role: 'dialog' }).props['aria-modal']).toBe('true')
    const checkbox = renderer!.root.findByType('input')
    await act(async () => { checkbox.props.onChange({ currentTarget: { checked: true } }) })
    const confirm = renderer!.root.findAllByType('button').find(node => node.children.includes('确认移除'))!
    await act(async () => {
      confirm.props.onClick()
      confirm.props.onClick()
      await Promise.resolve()
    })
    expect(mocks.callArkme).toHaveBeenCalledTimes(1)
    expect(mocks.callArkme).toHaveBeenCalledWith('group.member-remove', {
      sourceRef: 'group-ref', memberRef: member.memberRef, preventRejoin: true,
    }, expect.any(AbortSignal))
  })
})
