import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// Guard the actual production entry: the shared surface must own the native root,
// otherwise its body portals are painted behind a second, elevated React root.
describe('independent conversation production entry', () => {
 it('uses the native root slot instead of an elevated sibling root', () => {
  const source = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
  const branch = source.slice(source.indexOf('if (conversationWindowRequested())'), source.indexOf('if (longArticleWindowRequested())'))
  expect(branch).toContain('registerConversationWindowRoot(ctx)')
  expect(branch).not.toContain('createRoot(')
  expect(branch).not.toContain('2147483000')
 })
})
