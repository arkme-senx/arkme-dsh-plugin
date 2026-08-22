import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ArkmeConversationMemberItem } from '../src/types.js'
import {
  ArkmeMemberActionMenu, ArkmeMemberProfileCard, ArkmeMemberRecordsPanel,
  arkmeMemberRecordTimeline, arkmeMemberRecordTotal, formatArkmeMemberRecordTime,
  positionArkmeMemberMenu,
} from '../src/client/ArkmeChatMemberActions.js'
import { arkmeVisibleMentionRuns } from '../src/client/ArkmeRichContent.js'

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
})
