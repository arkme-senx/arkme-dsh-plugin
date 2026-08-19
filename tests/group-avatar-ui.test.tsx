import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeGroupAvatarVisual } from '../src/client/ArkmeAvatar.js'

describe('desktop-compatible group avatar', () => {
  it('uses the client two-slot composition and add affordance for one actual member', () => {
    const markup = renderToStaticMarkup(<ArkmeGroupAvatarVisual
      memberCount={1}
      slots={[{ fallback: { kind: 'phone_default', colorIndex: 5, label: '53' } }]}
      size={100}
    />)

    expect(markup).toContain('data-arkme-group-avatar-count="2"')
    expect(markup.match(/data-arkme-group-avatar-slot=/g)).toHaveLength(2)
    expect(markup).toContain('left:-10px')
    expect(markup).toContain('top:-8px')
    expect(markup).toContain('left:44px')
    expect(markup).toContain('top:46px')
    expect(markup).toContain('background:#00A6A6')
    expect(markup).toContain('53')
    expect(markup).toContain('>+</span>')
  })

  it('uses all five client coordinates and does not collapse fallback slots', () => {
    const markup = renderToStaticMarkup(<ArkmeGroupAvatarVisual
      memberCount={8}
      slots={[
        { imageUrl: 'data:image/png;base64,b25l' },
        { fallback: { kind: 'default' } },
        { fallback: { kind: 'phone_default', colorIndex: 2, label: '42' } },
      ]}
      size={100}
    />)

    expect(markup).toContain('data-arkme-group-avatar-count="5"')
    expect(markup.match(/data-arkme-group-avatar-slot=/g)).toHaveLength(5)
    expect(markup.match(/<img/g)).toHaveLength(1)
    expect(markup).toContain('left:68px')
    expect(markup).toContain('top:36px')
    expect(markup).toContain('left:48px')
    expect(markup).toContain('top:65px')
    expect(markup).toContain('left:15px')
    expect(markup).toContain('top:64px')
  })
})
