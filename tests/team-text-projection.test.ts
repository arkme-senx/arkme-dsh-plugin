import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { quoteCanonicalText, quoteSourceContent } from '../src/message-quote.js'
import fixtures from './fixtures/arkme-text-v1.json'

it.each(fixtures)('$name keeps the Record/browser projection protocol identical', row => {
  const source={textContent:row.body,textFormat:row.format as 'plain'|'markdown'}
  expect(quoteCanonicalText(source)).toBe(row.canonical)
  expect(createHash('sha256').update(quoteSourceContent(source)).digest('hex')).toBe(row.digest)
})
