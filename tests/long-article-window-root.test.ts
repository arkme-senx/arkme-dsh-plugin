import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// The production native root must share the same stacking context as body portals.
// A fixed sibling with a very high z-index is invisible but steals pointer hits.
describe('independent article and browse production entry', () => {
  it('registers the native root instead of placing a transparent full-window sibling above the portals', () => {
    const source = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
    const branch = source.slice(source.indexOf('if (longArticleWindowRequested())'), source.indexOf('if (deepSeekHarnessEmbedRequested())', source.indexOf('if (longArticleWindowRequested())')))
    expect(branch).toContain('registerLongArticleWindowRoot(ctx)')
    expect(branch).not.toContain('createRoot(')
    const registration = readFileSync(new URL('../src/client/long-article-window-root.tsx', import.meta.url), 'utf8')
    expect(registration).toContain("name: 'root'")
    expect(registration).not.toContain('document.body.append')
    expect(registration).not.toContain('2147483000')
  })
})
