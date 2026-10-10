import { describe, expect, it } from 'vitest'
import {
  arkmeTopicDragAutoScrollDelta,
  arkmeTopicDropPosition,
} from '../src/client/ArkmeSourceBreadcrumb.js'

describe('topic drag geometry', () => {
  it('uses narrow reorder edges and a generous child-drop center', () => {
    const rect = { top: 100, height: 100 }
    expect(arkmeTopicDropPosition(110, rect)).toBe('before')
    expect(arkmeTopicDropPosition(121, rect)).toBe('before')
    expect(arkmeTopicDropPosition(122, rect)).toBe('into')
    expect(arkmeTopicDropPosition(178, rect)).toBe('into')
    expect(arkmeTopicDropPosition(179, rect)).toBe('after')
  })

  it('scrolls toward the nearest edge with stronger speed near the boundary', () => {
    const rect = { left: 10, right: 210, top: 100, bottom: 500 }
    expect(arkmeTopicDragAutoScrollDelta(100, 300, rect)).toBe(0)
    expect(arkmeTopicDragAutoScrollDelta(100, 120, rect)).toBeLessThan(0)
    expect(arkmeTopicDragAutoScrollDelta(100, 101, rect)).toBeLessThan(
      arkmeTopicDragAutoScrollDelta(100, 120, rect),
    )
    expect(arkmeTopicDragAutoScrollDelta(100, 480, rect)).toBeGreaterThan(0)
    expect(arkmeTopicDragAutoScrollDelta(100, 499, rect)).toBeGreaterThan(
      arkmeTopicDragAutoScrollDelta(100, 480, rect),
    )
    expect(arkmeTopicDragAutoScrollDelta(0, 499, rect)).toBe(0)
  })
})
