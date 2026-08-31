import { describe, expect, it } from 'vitest'
import {
  arkmeComposerGroupMemberCount, arkmeComposerPlaceholderText,
} from '../src/client/composer-placeholder.js'

describe('composer placeholder business projection', () => {
  it('uses record-owner copy without a destination label', () => {
    expect(arkmeComposerPlaceholderText({ kind: 'record' })).toBe('记录此刻想法...')
  })

  it('formats private-chat labels with desktop line and grapheme rules', () => {
    expect(arkmeComposerPlaceholderText({
      kind: 'private_chat',
      displayName: '这个也超长哈哈哈哈',
    })).toBe('发消息给@这个也超长哈哈…')
    expect(arkmeComposerPlaceholderText({
      kind: 'private_chat',
      displayName: '天天\r\n睡大觉',
    })).toBe('发消息给@天天 睡大觉')
    for (const separator of ['\r', '\n', '\u2028', '\u2029']) {
      expect(arkmeComposerPlaceholderText({
        kind: 'private_chat',
        displayName: `天天${separator}睡大觉`,
      })).toBe('发消息给@天天 睡大觉')
    }
    expect(arkmeComposerPlaceholderText({
      kind: 'private_chat',
      displayName: '一二三四五六七',
    })).toBe('发消息给@一二三四五六七')
    expect(arkmeComposerPlaceholderText({
      kind: 'private_chat',
      displayName: '一二三四五六七八',
    })).toBe('发消息给@一二三四五六七…')
    expect(arkmeComposerPlaceholderText({
      kind: 'private_chat',
      displayName: '家人👨‍👩‍👧‍👦群聊测试哈哈',
    })).toBe('发消息给@家人👨‍👩‍👧‍👦群聊测试…')
  })

  it('falls back to record-owner copy for an empty private target', () => {
    expect(arkmeComposerPlaceholderText({ kind: 'private_chat', displayName: '' }))
      .toBe('记录此刻想法...')
  })

  it('formats group labels with an optional positive member count', () => {
    expect(arkmeComposerPlaceholderText({
      kind: 'group_chat', displayName: '前端重构', memberCount: 11,
    })).toBe('发消息到 前端重构(11人)')
    expect(arkmeComposerPlaceholderText({
      kind: 'group_chat', displayName: '一二三四五六七八', memberCount: 11,
    })).toBe('发消息到 一二三四五六七…(11人)')
    expect(arkmeComposerPlaceholderText({ kind: 'group_chat', displayName: '设计讨论' }))
      .toBe('发消息到 设计讨论')
    expect(arkmeComposerPlaceholderText({
      kind: 'group_chat', displayName: '设计讨论', memberCount: 0,
    })).toBe('发消息到 设计讨论')
    expect(arkmeComposerPlaceholderText({
      kind: 'group_chat', displayName: '设计讨论', memberCount: Number.NaN,
    })).toBe('发消息到 设计讨论')
  })

  it('uses the first positive count instead of treating zero as final', () => {
    expect(arkmeComposerGroupMemberCount(12, 11)).toBe(12)
    expect(arkmeComposerGroupMemberCount(0, 11)).toBe(11)
    expect(arkmeComposerGroupMemberCount(Number.NaN, 11)).toBe(11)
    expect(arkmeComposerGroupMemberCount(-1, 11)).toBe(11)
    expect(arkmeComposerGroupMemberCount(0, 0)).toBeUndefined()
    expect(arkmeComposerGroupMemberCount(undefined, undefined)).toBeUndefined()
  })
})
