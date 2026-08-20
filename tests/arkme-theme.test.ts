import { describe, expect, it } from 'vitest'
import { arkmeTheme } from '../src/client/arkme-theme.js'

describe('Arkme theme contract', () => {
  it('delegates theme-sensitive colors to DSH semantic tokens', () => {
    const themeSensitive = [
      arkmeTheme.base, arkmeTheme.layer1, arkmeTheme.layer2, arkmeTheme.layer3,
      arkmeTheme.sidebar, arkmeTheme.input, arkmeTheme.menu,
      arkmeTheme.messageOther, arkmeTheme.subtle,
      arkmeTheme.elevated, arkmeTheme.hover, arkmeTheme.active,
      arkmeTheme.text, arkmeTheme.secondary, arkmeTheme.tertiary, arkmeTheme.caption,
      arkmeTheme.border, arkmeTheme.borderSoft, arkmeTheme.accentSoft,
      arkmeTheme.infoSoft, arkmeTheme.dangerSoft, arkmeTheme.warningSoft,
    ]

    expect(themeSensitive.every(value => value.startsWith('var(--dsw-'))).toBe(true)
    expect(arkmeTheme.messageOwn).toContain('--arkme-chat-self-bubble')
    expect(arkmeTheme.messageOwn).toContain('--dsw-specific-bubble')
  })

  it('keeps DSH as the only theme owner', () => {
    expect(Object.values(arkmeTheme).join('\n')).not.toContain('prefers-color-scheme')
    expect(Object.values(arkmeTheme).join('\n')).not.toContain('data-ds-dark-theme')
  })

  it('uses the client-compatible DSH bubble color for received messages', () => {
    expect(arkmeTheme.messageOther).toContain('--dsw-specific-bubble')
    expect(arkmeTheme.messageOther).not.toContain('--dsw-alias-bg-subtle')
  })
})
