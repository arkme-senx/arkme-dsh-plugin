import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ArkmeConversationMemberItem, ArkmeConversationMemberJoinEvent } from '../src/types.js'
import {
  ARKME_MEMBER_RECORDS_DEFAULT_WIDTH,
  ArkmeMemberActionMenu, ArkmeMemberProfileCard, ArkmeMemberRecordsPanel,
  arkmeMemberActionMenuRowCount, arkmeMemberConversationAction,
  arkmeMemberProfileNames,
  arkmeMemberRecordTimeline, arkmeMemberRecordTotal, formatArkmeMemberRecordTime,
  clampArkmeMemberRecordsWidth, positionArkmeMemberMenu,
} from '../src/client/ArkmeChatMemberActions.js'
import { arkmeVisibleMentionRuns } from '../src/client/ArkmeRichContent.js'
import {
  ArkmeMemberJoinNotice, arkmeConversationJoinEventsInLoadedWindow, arkmeMemberJoinDisplayName,
  arkmeMemberJoinTimeLabel, arkmeVisibleMemberJoinInvitees,
} from '../src/client/ArkmeSidebar.js'

const member: ArkmeConversationMemberItem = {
  memberRef: 'member-ref', displayName: '小林', role: 'member', status: 'active',
  isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 7, mentionCount: 2,
}

describe('chat member action menu placement', () => {
  const host = { left: 100, top: 50, width: 800, height: 600 }

  it('anchors below the avatar instead of following the pointer coordinate', () => {
    expect(positionArkmeMemberMenu(
      { left: 140, right: 178, top: 120, bottom: 158 },
      host,
      3,
    )).toEqual({ left: 40, top: 112, placement: 'below' })
  })

  it('flips above near the lower edge and clamps horizontally', () => {
    expect(positionArkmeMemberMenu(
      { left: 890, right: 928, top: 600, bottom: 638 },
      host,
      3,
    )).toEqual({ left: 604, top: 414, placement: 'above' })
  })

  it('keeps a stable edge inset after the host shrinks', () => {
    expect(positionArkmeMemberMenu(
      { left: 10, right: 48, top: 5, bottom: 43 },
      { left: 0, top: 0, width: 220, height: 160 },
      3,
    )).toEqual({ left: 10, top: 20, placement: 'below' })
  })

  it('renders native menu semantics for another group member and the reusable profile action', () => {
    const menu = renderToStaticMarkup(createElement(ArkmeMemberActionMenu, {
      member,
      sourceKind: 'group_chat',
      position: { left: 10, top: 20, placement: 'below' },
      onMention: () => undefined,
      onRecords: () => undefined,
      onClose: () => undefined,
    }))
    expect(menu).toContain('@小林')
    expect(menu).toContain('@TA的快记')
    expect(menu).toContain('看TA的快记')
    expect(menu).toContain('>2<')
    expect(menu).toContain('>7<')

    const card = renderToStaticMarkup(createElement(ArkmeMemberProfileCard, {
      member,
      busy: false,
      onClose: () => undefined,
      onSend: () => undefined,
    }))
    expect(card).toContain('小林')
    expect(card).toContain('发送消息')
    expect(card).toContain('data-arkme-profile-send-state="idle"')
  })

  it('shows only the matching owner-record action with its count in private chats', () => {
    const otherMenu = renderToStaticMarkup(createElement(ArkmeMemberActionMenu, {
      member,
      sourceKind: 'private_chat',
      position: { left: 10, top: 20, placement: 'below' },
      onMention: () => undefined,
      onRecords: () => undefined,
      onClose: () => undefined,
    }))
    expect(otherMenu).toContain('看TA的快记')
    expect(otherMenu).toContain('>7<')
    expect(otherMenu).not.toContain('@TA的快记')
    expect(arkmeMemberActionMenuRowCount(member, 'private_chat')).toBe(1)

    const self = { ...member, isSelf: true, displayName: '颜格蕾', recordCount: 70, mentionCount: 9 }
    const selfMenu = renderToStaticMarkup(createElement(ArkmeMemberActionMenu, {
      member: self,
      sourceKind: 'private_chat',
      position: { left: 10, top: 20, placement: 'below' },
      onMention: () => undefined,
      onRecords: () => undefined,
      onClose: () => undefined,
    }))
    expect(selfMenu).toContain('看我的快记')
    expect(selfMenu).toContain('>70<')
    expect(selfMenu).not.toContain('@我的快记')
    expect(arkmeMemberActionMenuRowCount(self, 'private_chat')).toBe(1)
  })

  it('routes self and other profile cards to their existing conversation owners', () => {
    expect(arkmeMemberConversationAction(member)).toBe('private_chat')
    const self = { ...member, isSelf: true, displayName: '颜格蕾' }
    expect(arkmeMemberConversationAction(self)).toBe('send_to_self')
    const card = renderToStaticMarkup(createElement(ArkmeMemberProfileCard, {
      member: self,
      busy: true,
      onClose: () => undefined,
      onSend: () => undefined,
    }))
    expect(card).toContain('颜格蕾')
    expect(card).toContain('data-arkme-profile-send-state="loading"')
    expect(card).toContain('disabled=""')
  })

  it('matches the client profile name after a member changes their public nickname', () => {
    const renamed = {
      ...member,
      displayName: '即我用户3038',
      memberName: '即我用户3038',
      secondaryName: '芝士小狗',
    }
    expect(arkmeMemberProfileNames(renamed, true)).toEqual({
      displayName: '芝士小狗',
      topicNickname: '即我用户3038',
    })
    const card = renderToStaticMarkup(createElement(ArkmeMemberProfileCard, {
      member: renamed,
      showTopicNickname: true,
      busy: false,
      onClose: () => undefined,
      onSend: () => undefined,
    }))
    expect(card).toContain('aria-label="芝士小狗 的用户卡片"')
    expect(card).toContain('>芝士小狗</h3>')
    expect(card).toContain('主题内昵称：')
    expect(card).toContain('即我用户3038</p>')
    expect(arkmeMemberProfileNames(renamed, false)).toEqual({
      displayName: '即我用户3038',
      topicNickname: '',
    })
  })

  it('uses the projected mode count instead of the loaded page length', () => {
    expect(arkmeMemberRecordTotal(member, 'mentioned')).toBe(2)
    expect(arkmeMemberRecordTotal(member, 'owner')).toBe(7)
    const panel = renderToStaticMarkup(createElement(ArkmeMemberRecordsPanel, {
      sourceRef: 'source-ref',
      member,
      mode: 'mentioned',
      onClose: () => undefined,
    }))
    expect(panel).toContain('@小林的快记')
    expect(panel).toContain('2条')
    expect(panel).toContain('data-total="2"')
    expect(panel).toContain('data-arkme-member-records-dismiss="true"')
    expect(panel).toContain('data-arkme-member-records-resize-handle="true"')
    expect(panel).toContain(`data-width="${ARKME_MEMBER_RECORDS_DEFAULT_WIDTH}"`)
  })

  it('clamps the shared records drawer width like the desktop client', () => {
    expect(clampArkmeMemberRecordsWidth(520, 1_200)).toBe(520)
    expect(clampArkmeMemberRecordsWidth(900, 1_200)).toBe(720)
    expect(clampArkmeMemberRecordsWidth(520, 600)).toBe(428)
    expect(clampArkmeMemberRecordsWidth(520, 320)).toBe(320)
    expect(clampArkmeMemberRecordsWidth(Number.NaN, 1_200)).toBe(428)
  })

  it('builds the same chronological 30-minute time segmentation as the desktop client', () => {
    const now = new Date(2026, 7, 22, 15, 0).getTime()
    const at = (hour: number, minute: number) => new Date(2026, 7, 22, hour, minute).getTime()
    const items = [
      { itemUid: 'newest', senderName: '小林', isMe: false, sendAtMillis: at(12, 2), title: '', textContent: '三', status: 1 },
      { itemUid: 'middle', senderName: '小林', isMe: false, sendAtMillis: at(11, 40), title: '', textContent: '二', status: 1 },
      { itemUid: 'oldest', senderName: '小林', isMe: false, sendAtMillis: at(11, 20), title: '', textContent: '一', status: 1 },
    ]
    const timeline = arkmeMemberRecordTimeline(items, now)
    expect(timeline.map(entry => entry.kind === 'record' ? entry.item.itemUid : `time:${entry.label}`)).toEqual([
      'time:11:20', 'oldest', 'middle', 'time:12:02', 'newest',
    ])
  })

  it('formats today, yesterday, the day before yesterday and older dates like the client timeline', () => {
    const now = new Date(2026, 7, 22, 15, 0).getTime()
    expect(formatArkmeMemberRecordTime(new Date(2026, 7, 22, 11, 20).getTime(), now)).toBe('11:20')
    expect(formatArkmeMemberRecordTime(new Date(2026, 7, 21, 11, 20).getTime(), now)).toBe('昨天 11:20')
    expect(formatArkmeMemberRecordTime(new Date(2026, 7, 20, 11, 20).getTime(), now)).toBe('前天 11:20')
    expect(formatArkmeMemberRecordTime(new Date(2025, 7, 20, 11, 20).getTime(), now)).toBe('2025-08-20 11:20')
  })

  it('marks visible mention tokens without changing surrounding record text', () => {
    expect(arkmeVisibleMentionRuns('@Ye 首席UI设计师分配下，联系a@b.com')).toEqual([
      { kind: 'mention', text: '@Ye' },
      { kind: 'text', text: ' 首席UI设计师分配下，联系a@b.com' },
    ])
  })

  it('reveals member join events only after they enter the loaded timeline window', () => {
    const event = (eventId: string, occurredAtMillis: number): ArkmeConversationMemberJoinEvent => ({
      eventId, action: 'invite', occurredAtMillis,
      inviter: { memberRef: 'member-1', displayName: '群主', isSelf: false },
      invitees: [{ memberRef: 'member-2', displayName: '成员', isSelf: false }],
    })
    const events = [event('old', 100), event('visible', 300), event('new', 500)]
    const items = [{ itemUid: 'one', senderName: '群主', isMe: false, sendAtMillis: 250, title: '', textContent: '', status: 1 }]
    expect(arkmeConversationJoinEventsInLoadedWindow(events, items, true).map(item => item.eventId))
      .toEqual(['visible', 'new'])
    expect(arkmeConversationJoinEventsInLoadedWindow(events, items, false).map(item => item.eventId))
      .toEqual(['old', 'visible', 'new'])
  })

  it('matches the client join notice time, name, self, and two-person rules', () => {
    const now = new Date(2026, 7, 25, 12, 0).getTime()
    expect(arkmeMemberJoinTimeLabel(new Date(2026, 7, 24, 17, 39).getTime(), now)).toBe('昨天 17:39')
    expect(arkmeMemberJoinDisplayName({ displayName: '即我用户3038', isSelf: false }, 14)).toBe('即我用户3038')
    expect(arkmeMemberJoinDisplayName({ displayName: 'jw-XeSL8sjm-fuQEiXxDwCKR', isSelf: false }, 14))
      .toBe('jw-XeSL8sjm-fu...')
    expect(arkmeMemberJoinDisplayName({ displayName: '12345678901', isSelf: false }, 10)).toBe('1234567890...')
    expect(arkmeMemberJoinDisplayName({ displayName: '👨‍👩‍👧‍👦家庭用户名字很长', isSelf: false }, 4)).toBe('👨‍👩‍👧‍👦家庭用...')
    expect(arkmeMemberJoinDisplayName({ displayName: '任意姓名', isSelf: true }, 10)).toBe('你')
    const event: ArkmeConversationMemberJoinEvent = {
      eventId: 'join', action: 'invite', occurredAtMillis: now,
      inviter: { memberRef: 'member-ref', displayName: '群主', isSelf: false },
      invitees: [
        { displayName: '甲', isSelf: false },
        { displayName: '乙', isSelf: false },
        { displayName: '我', isSelf: true },
      ],
    }
    expect(arkmeVisibleMemberJoinInvitees(event).map(item => item.displayName)).toEqual(['甲', '我'])
    const html = renderToStaticMarkup(createElement(ArkmeMemberJoinNotice, {
      rowId: 'member-join:join', event,
      membersByRef: new Map([['member-ref', member]]), startsGroup: true, onOpenMember: () => undefined,
    }))
    expect(html).toContain('data-arkme-member-join-event="join"')
    expect(html).toContain('邀请')
    expect(html).toContain('等3人')
    expect(html).toContain('加入群聊')
    expect(html).toContain('font-size:13px')
    expect(html).toContain('font-weight:500')
    expect(html).toContain('data-arkme-member-join-group-start="true"')
    expect(html).toContain('margin-top:26px')
    expect(html).toContain('padding:4px 6px')
    expect(html).toContain('padding-top:8px')
    expect(html).toContain('640px')
  })
})
