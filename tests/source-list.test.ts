import { describe, expect, it } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import { arkmeSourceTimeLabel, sortArkmeSources } from '../src/client/source-list.js'

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
  it('sorts a sibling snapshot without mutating its input', () => {
    const sources = [
      source('parent', 'Beta', 20, 5),
      source('child', 'Alpha', 30, 1, 'parent'),
      source('root', 'Gamma', 10, 10),
    ]

    expect(sortArkmeSources(sources, 'latest').map(item => item.sourceRef))
      .toEqual(['child', 'parent', 'root'])
    expect(sortArkmeSources(sources, 'most').map(item => item.sourceRef))
      .toEqual(['root', 'parent', 'child'])
    expect(sortArkmeSources(sources, 'name').map(item => item.sourceRef))
      .toEqual(['child', 'parent', 'root'])
    expect(sources.map(item => item.sourceRef)).toEqual(['parent', 'child', 'root'])
  })

  it('formats compact Chinese timestamps for source-card metadata', () => {
    const now = new Date(2026, 7, 18, 21, 30).getTime()
    expect(arkmeSourceTimeLabel(new Date(2026, 7, 18, 20, 49).getTime(), now)).toBe('20:49')
    expect(arkmeSourceTimeLabel(new Date(2026, 7, 17, 8, 0).getTime(), now)).toBe('昨天')
    expect(arkmeSourceTimeLabel(new Date(2026, 7, 5, 8, 0).getTime(), now)).toBe('8月5日')
  })
})
