import { describe, expect, it } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import {
  arkmeSelfDirectorySources, arkmeSourceTimeLabel, isArkmeSelfWorkspaceSource, sortArkmeSources,
} from '../src/client/source-list.js'

function source(
  sourceRef: string,
  displayName: string,
  activeAtMillis: number,
  recordCount: number,
  parentSourceRef?: string,
): ArkmeSourceItem {
  return {
    sourceRef,
    ...(parentSourceRef === undefined ? {} : { parentSourceRef }),
    kind: 'topic',
    displayName,
    activeAtMillis,
    unreadCount: 0,
    recordCount,
  }
}

describe('Arkme send-to-self source list', () => {
  it('keeps the aggregate selected in the left navigation while excluding it from category rows', () => {
    const aggregate = { ...source('aggregate', '发给自己', 0, 0), kind: 'send_to_self' as const }
    const defaultCategory = { ...source('default', '默认分类', 0, 0), kind: 'default_category' as const }
    const topic = source('topic', '工作', 0, 0)
    const chat = { ...source('chat', '联系人', 0, 0), kind: 'private_chat' as const }

    expect(isArkmeSelfWorkspaceSource(undefined)).toBe(true)
    expect(isArkmeSelfWorkspaceSource(aggregate)).toBe(true)
    expect(isArkmeSelfWorkspaceSource(defaultCategory)).toBe(true)
    expect(isArkmeSelfWorkspaceSource(topic)).toBe(true)
    expect(isArkmeSelfWorkspaceSource(chat)).toBe(false)
    expect(arkmeSelfDirectorySources([aggregate, defaultCategory, topic]).map(item => item.displayName))
      .toEqual(['默认分类', '工作'])
  })

  it('globally sorts parents and children for card modes without mutating its input', () => {
    const sources = [
      source('parent', 'Beta', 20, 5),
      source('child', 'Alpha', 30, 1, 'parent'),
      source('root', 'Gamma', 10, 10),
    ]

    expect(sortArkmeSources(sources, 'default').map(item => item.sourceRef))
      .toEqual(['parent', 'child', 'root'])
    expect(sortArkmeSources(sources, 'latest').map(item => item.sourceRef))
      .toEqual(['child', 'parent', 'root'])
    expect(sortArkmeSources(sources, 'most').map(item => item.sourceRef))
      .toEqual(['root', 'parent', 'child'])
    expect(sources.map(item => item.sourceRef)).toEqual(['parent', 'child', 'root'])
  })

  it('formats compact Chinese timestamps for source-card metadata', () => {
    const now = new Date(2026, 7, 18, 21, 30).getTime()
    expect(arkmeSourceTimeLabel(new Date(2026, 7, 18, 20, 49).getTime(), now)).toBe('20:49')
    expect(arkmeSourceTimeLabel(new Date(2026, 7, 17, 8, 0).getTime(), now)).toBe('昨天 08:00')
    expect(arkmeSourceTimeLabel(new Date(2026, 7, 5, 8, 0).getTime(), now)).toBe('8月5日')
  })
})
