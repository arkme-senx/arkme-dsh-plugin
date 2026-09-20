import { expect, it } from 'vitest'
import { inMenuHoverRegion } from '../src/client/menu-hover-region.js'

const anchor = { left: 200, right: 240, top: 100, bottom: 140 }

it.each([
  [{ left: 20, right: 240, top: 144, bottom: 304 }, 220, 142],
  [{ left: 20, right: 240, top: 20, bottom: 96 }, 220, 98],
  [{ left: 20, right: 196, top: 100, bottom: 240 }, 198, 120],
  [{ left: 244, right: 420, top: 100, bottom: 240 }, 242, 120],
])('protects only the short crossing corridor in each placement (%j)', (menu, x, y) => {
  expect(inMenuHoverRegion(x, y, anchor, menu)).toBe(true)
  expect(inMenuHoverRegion(220, 120, anchor, menu)).toBe(true)
  expect(inMenuHoverRegion(menu.left + 1, menu.top + 1, anchor, menu)).toBe(true)
  expect(inMenuHoverRegion(500, 500, anchor, menu)).toBe(false)
})

it('does not keep unrelated whitespace or a distant menu open', () => {
  const menu = { left: 20, right: 240, top: 144, bottom: 304 }
  expect(inMenuHoverRegion(150, 142, anchor, menu)).toBe(false)
  expect(inMenuHoverRegion(242, 142, anchor, menu)).toBe(false)
  expect(inMenuHoverRegion(220, 160, anchor, { ...menu, top: 180 })).toBe(false)
  expect(inMenuHoverRegion(195, 142, anchor, { ...menu, right: 190 })).toBe(false)
})
