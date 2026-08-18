import { describe, expect, it } from 'vitest'
import {
  callDirectionLabel,
  callMediaLabel,
  formatCallDuration,
  formatCallTime,
  mergeCallListItems,
  sectionStatusMessage,
} from '../src/client/call-presentation.js'
import type { JotmoCallListItem } from '../src/types.js'

function call(callRef: string, displayName: string): JotmoCallListItem {
  return {
    callRef,
    displayName,
    participantCount: 2,
    mediaType: 'audio',
    direction: 'outgoing',
    connected: true,
    startedAtMillis: 0,
    acceptedAtMillis: 0,
    endedAtMillis: 0,
    durationMillis: 0,
    summaryState: 'empty',
    summaryPreview: '',
  }
}

describe('call history client presentation', () => {
  it('appends unseen calls without replacing an existing page item', () => {
    const first = call('call-a', '原名称')
    const current = [first]
    const merged = mergeCallListItems(current, [call('call-a', '新名称'), call('call-b', '小林')])
    expect(merged).toEqual([first, call('call-b', '小林')])
    expect(merged).not.toBe(current)
  })

  it.each([
    [0, '0秒'],
    [1_000, '1秒'],
    [61_000, '1分01秒'],
    [3_661_000, '1小时01分01秒'],
  ])('formats %i milliseconds as %s', (durationMillis, label) => {
    expect(formatCallDuration(durationMillis)).toBe(label)
  })

  it('formats missing and same-day call timestamps deterministically', () => {
    expect(formatCallTime(0, Date.UTC(2026, 7, 18, 4))).toBe('--')
    expect(formatCallTime(
      Date.UTC(2026, 7, 18, 2, 30),
      Date.UTC(2026, 7, 18, 4),
    )).toBe('10:30')
  })

  it('maps media and direction labels without leaking enum values', () => {
    expect(['audio', 'video', 'unknown'].map(callMediaLabel)).toEqual(['语音', '视频', '通话'])
    expect(['incoming', 'outgoing', 'group', 'unknown'].map(callDirectionLabel)).toEqual([
      '呼入', '呼出', '群通话', '通话',
    ])
  })

  it('returns stable section messages for non-ready states', () => {
    expect(sectionStatusMessage('summary', 'empty')).toBe('暂无 AI 摘要')
    expect(sectionStatusMessage('summary', 'processing')).toBe('AI 摘要生成中')
    expect(sectionStatusMessage('summary', 'failed')).toBe('AI 摘要生成失败')
    expect(sectionStatusMessage('transcript', 'empty')).toBe('暂无转录内容')
    expect(sectionStatusMessage('transcript', 'processing')).toBe('通话转录处理中')
    expect(sectionStatusMessage('transcript', 'failed')).toBe('通话转录失败')
  })
})
