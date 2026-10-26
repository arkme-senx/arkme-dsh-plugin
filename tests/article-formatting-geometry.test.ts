import { expect, it } from 'vitest'
import { articleFormattingHref, articleFormattingSeat } from '../src/client/article-formatting-geometry.js'
const clip = { left: 100, right: 780, top: 90, bottom: 650 }
it('anchors above the first visible line and moves below when the viewport leaves insufficient room', () => {
  expect(articleFormattingSeat([{ left: 200, right: 380, top: 200, bottom: 225 }], clip, 800, 300, 44)).toEqual({ left: 140, top: 148 })
  expect(articleFormattingSeat([{ left: 200, right: 380, top: 10, bottom: 35 }], { ...clip, top: 0 }, 800, 300, 44)?.top).toBe(43)
})
it('clamps a narrow toolbar and hides selections scrolled outside the editor viewport', () => {
  expect(articleFormattingSeat([{ left: 260, right: 319, top: 200, bottom: 225 }], { left: 0, right: 320, top: 90, bottom: 650 }, 320, 240, 42)?.left).toBe(72)
  expect(articleFormattingSeat([{ left: 200, right: 300, top: 0, bottom: 50 }], clip, 800, 300, 44)).toBeUndefined()
  expect(articleFormattingSeat([{ left: 200, right: 300, top: 0, bottom: 50 }, { left: 200, right: 300, top: 200, bottom: 225 }], clip, 800, 300, 44)?.top).toBe(148)
})
it('normalizes portable links and rejects executable, local-file and malformed URLs', () => {
  expect(articleFormattingHref('www.example.com')).toBe('https://www.example.com/')
  expect(articleFormattingHref('mailto:hello@example.com')).toBe('mailto:hello@example.com')
  expect(articleFormattingHref('#标题')).toBe('#标题')
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/x', 'https://', 'https://a b', 'vbscript:msgbox(1)']) expect(articleFormattingHref(value)).toBeUndefined()
})
