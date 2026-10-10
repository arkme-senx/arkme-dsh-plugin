// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it } from 'vitest'
import { ArkmeAvatarMosaic, ArkmeSourceAvatar, ArkmeUserAvatar } from '../src/client/ArkmeAvatar.js'
import { ArkmeArkoAvatar } from '../src/client/ArkmeArkoAvatar.js'

afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = '' })

it('keeps user, source, group members and Arko avatars round under the Harness superellipse theme', () => {
  const theme = document.createElement('style')
  theme.textContent = '* { corner-shape: superellipse(1.5); }'
  document.head.append(theme)
  const plugin = document.createElement('style')
  plugin.textContent = readFileSync(resolve('src/client/redesign/arkme-redesign.css'), 'utf8')
  document.head.append(plugin)
  document.body.innerHTML = renderToStaticMarkup(<>
    <ArkmeUserAvatar /><ArkmeSourceAvatar kind="single" /><ArkmeArkoAvatar />
    <ArkmeAvatarMosaic urls={['data:image/png;base64,AA==', 'data:image/png;base64,AQ==']} />
    <span className="arkme-contact-profile-avatar"><ArkmeUserAvatar size={72} /></span>
    <button id="unrelated">消息操作</button>
  </>)
  const avatars = document.querySelectorAll('[data-arkme-avatar], [data-arkme-avatar] *, .arkme-contact-profile-avatar')
  expect(avatars.length).toBeGreaterThan(10)
  // jsdom does not compute corner-shape yet; inspect parsed declarations and
  // their match against real component markup instead of claiming visual QA.
  const roundRule = Array.from(plugin.sheet!.cssRules).find(rule =>
    rule instanceof CSSStyleRule && rule.style.getPropertyValue('corner-shape') === 'round') as CSSStyleRule
  expect(roundRule).toBeDefined()
  for (const avatar of avatars) expect(avatar.matches(roundRule.selectorText)).toBe(true)
  expect(document.querySelector('#unrelated')!.matches(roundRule.selectorText)).toBe(false)
  expect(getComputedStyle(document.querySelector('.arkme-contact-profile-avatar')!).borderRadius).toBe('50%')
})
