import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import vectors from './fixtures/message-text-anchors.json'
import { quoteCanonicalText, quoteContext, quoteMatchesCanonical, quoteSourceContent } from '../src/message-quote.js'

it.each(vectors)('keeps the server/PC projection and digest for $text', vector => {
  const source = { textContent: vector.text, textFormat: vector.format as 'plain' | 'markdown' }
  expect(quoteCanonicalText(source)).toBe(vector.canonical)
  expect(createHash('sha256').update(quoteSourceContent(source)).digest('hex')).toBe(vector.digest)
})
it('keeps new context UTF-16 well formed while retaining the old private local anchor', () => {
  const canonical = '😀' + 'a'.repeat(31) + '重点' + 'b'.repeat(31) + '😀尾'
  const context = quoteContext(canonical, 33, 35)
  expect(context).toEqual({ prefix: 'a'.repeat(31), suffix: 'b'.repeat(31) })
  const anchor = { version: 1 as const, projection: 'arkme-text-v1' as const, sourceDigest: 'a'.repeat(64), start: 33, end: 35, text: '重点', ...context }
  expect(quoteMatchesCanonical(anchor, canonical)).toBe(true)
  const oldPrivateAnchor = { ...anchor, prefix: canonical.slice(1, 33), suffix: canonical.slice(35, 67) }
  expect(JSON.parse(JSON.stringify(oldPrivateAnchor))).toEqual(oldPrivateAnchor)
  expect(quoteMatchesCanonical(oldPrivateAnchor, canonical)).toBe(true)
})
