import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('conversation composer redesign styles', () => {
  it('lets the primary Arkme composer focus state override redesign important rules', async () => {
    const css = await readFile(new URL('../src/client/redesign/arkme-redesign.css', import.meta.url), 'utf8')

    expect(css).toMatch(/\.arkme-redesign-route-chats \.arkme-conversation-composer-inner\[data-arkme-primary-composer="true"\]\s*\{[^}]*box-shadow:\s*none !important;/s)
    expect(css).toMatch(/\.arkme-redesign-route-chats \.arkme-conversation-composer-inner\[data-arkme-primary-composer="true"\]\[data-arkme-composer-focused="true"\]\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--dsw-alias-bg-base, #ffffff\) 97%, #000000\) !important;/s)
    expect(css).toMatch(/body\[data-ds-dark-theme\] \.arkme-redesign-route-chats \.arkme-conversation-composer-inner\[data-arkme-primary-composer="true"\]\s*\{[^}]*box-shadow:\s*none !important;/s)
  })
})
