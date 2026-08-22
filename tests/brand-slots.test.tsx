import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeHeroBrandMark, ArkmeSidebarBrandMark, ArkmeSidebarBrandName } from '../src/client/ArkmeBrand.js'

describe('Arkme public brand slots', () => {
  it('renders the client brand assets at host-provided sizes', () => {
    const sidebar = renderToStaticMarkup(<ArkmeSidebarBrandMark size={24} />)
    const hero = renderToStaticMarkup(<ArkmeHeroBrandMark size={40} className="hero-mark" />)
    const name = renderToStaticMarkup(<ArkmeSidebarBrandName />)

    expect(sidebar).toContain('width="97"')
    expect(sidebar).toContain('data:image/png;base64,')
    expect(hero).toContain('width="40"')
    expect(hero).toContain('hero-mark')
    expect(name).toBe('')
  })

  it('owns the permanent parent surfaces instead of relying on official child brand slots', async () => {
    const source = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8')

    expect(source).toContain("ctx.slots.inject('sidebar'")
    expect(source).toContain("ctx.slots.inject('conversation'")
    expect(source).not.toContain("ctx.slots.inject('sidebar.brand.mark'")
    expect(source).not.toContain("ctx.slots.inject('conversation.hero.brand.mark'")
    expect(source.match(/priority: -100/g)).toHaveLength(3)
    expect(source).not.toContain('MutationObserver')
  })
})
