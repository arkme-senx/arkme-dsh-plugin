import { describe, expect, it } from 'vitest'
import { applyMessageTextReplacement, resolveMessageTextReplacement } from '../src/client/message-text-replacement.js'
import { quoteCanonicalText, type ArkmeMessageQuote } from '../src/message-quote.js'

const anchor = (canonical: string, start: number, end: number): ArkmeMessageQuote => ({ version: 1, projection: 'arkme-text-v1',
  sourceDigest: 'a'.repeat(64), start, end, text: canonical.slice(start, end), prefix: canonical.slice(Math.max(0, start - 32), start), suffix: canonical.slice(end, end + 32) })
function change(textContent: string, start: number, end: number, value: string, textFormat: 'plain' | 'markdown' = 'plain') {
  const item = { textContent, textFormat }, range = resolveMessageTextReplacement(item, anchor(quoteCanonicalText(item), start, end))
  return applyMessageTextReplacement(textContent, range, value).text
}
describe('selected occurrence replacement', () => {
  it('changes the second repeated phrase, not the first', () => {
    expect(change('下午开会，下午发版', 5, 7, '明天')).toBe('下午开会，明天发版')
  })
  it('maps collapsed whitespace back to raw positions without losing other line breaks', () => {
    expect(change('  第一段\n\n 第二段\t内容\n第三段', 4, 7, '新段落')).toBe('  第一段\n\n 新段落\t内容\n第三段')
  })
  it('preserves surrounding Markdown, link destinations, and escaped replacement punctuation', () => {
    expect(change('你好 **重点** [重点](https://example.com)', 6, 8, '新*词', 'markdown')).toBe('你好 **重点** [新\\*词](https://example.com)')
  })
  it('maps escaped entities and emoji tokens without shifting following words', () => {
    expect(change('A &amp; B **词**', 6, 7, '新词', 'markdown')).toBe('A &amp; B **新词**')
    expect(change('[jm_emoji:thumb_up] 重复 重复', 6, 8, '替换')).toBe('[jm_emoji:thumb_up] 重复 替换')
  })
  it('rejects source drift and unsafe formatting boundaries instead of guessing', () => {
    const item = { textContent: '**词**尾巴', textFormat: 'markdown' as const }
    expect(() => resolveMessageTextReplacement(item, anchor('词尾巴', 0, 2))).toThrow('不同格式')
    expect(() => resolveMessageTextReplacement({ textContent: '词已变化' }, anchor('词尾巴', 0, 1))).toThrow('已变化')
  })
  it('allows removing only the chosen occurrence', () => {
    expect(change('重复 重复', 3, 5, '')).toBe('重复 ')
  })
  it('shifts untouched mentions and does not turn a partly edited mention into another person', () => {
    const mentions = [{ originalIndex: 0, displayName: '甲', startIndex: 3, length: 2 }]
    const source = '你好 @甲', range = resolveMessageTextReplacement({ textContent: source }, anchor(source, 0, 2))
    expect(applyMessageTextReplacement(source, range, '大家好', mentions)).toEqual({ text: '大家好 @甲', mentions: [{ ...mentions[0], startIndex: 4 }] })
    expect(() => applyMessageTextReplacement(source, { start: 4, end: 5, original: '甲', markdown: false }, '乙', mentions)).toThrow('完整选择')
    expect(applyMessageTextReplacement(source, { start: 3, end: 5, original: '@甲', markdown: false }, '朋友', mentions).mentions).toEqual([])
  })
})
