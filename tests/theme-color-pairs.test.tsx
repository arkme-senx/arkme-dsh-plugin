import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { ArkmeCalendarCell, ArkmeCalendarSurface } from '../src/client/ArkmeCalendarSurface.js'
import { CONVERSATION_MENU_COLORS } from '../src/client/conversation-selector-style.js'
import { arkmeTheme } from '../src/client/arkme-theme.js'
import { ArkmeVoiceprintSurface, RecognizedPersonDialog } from '../src/client/ArkmeVoiceprintSurface.js'
import { AddMembersDrawer, InviteCollaboratorsDialog } from '../src/client/ArkmeGroupChatControls.js'

// Use the actual installed DSH palettes, not hand-picked "dark enough" fixtures.
const require = createRequire(import.meta.url)
// 0.2 ships its palette inline in the browser factory instead of a CSS subpath.
const themeFactory = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-theme/client'), 'utf8')
const paletteLiteral = /var design_platform_css_default = ("(?:\\.|[^"\\])*");/.exec(themeFactory)?.[1]
if (!paletteLiteral) throw new Error('Installed DSH theme bundle has no native palette')
const palette: string = JSON.parse(paletteLiteral)
function tokens(dark: boolean) {
  const result = new Map<string, string>()
  // Static colors and semantic aliases each have separate light/dark blocks.
  for (const block of palette.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!dark && block[1]!.includes('body[data-ds-dark-theme]')) continue
    for (const match of block[2]!.matchAll(/(--dsw-[\w-]+):\s*([^;]+);/g)) result.set(match[1]!, match[2]!.trim())
  }
  return result
}
function color(value: string, dark: boolean, backing?: number[]): number[] {
  const vars = tokens(dark)
  let result = value
  for (let i = 0; i < 20 && result.startsWith('var('); i++) {
    const name = /^var\((--[\w-]+)/.exec(result)?.[1]
    expect(name && vars.has(name), `Missing DSH token: ${result}`).toBe(true)
    result = vars.get(name!)!
  }
  let rgba: number[]
  if (/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(result)) {
    rgba = [1, 3, 5].map(offset => Number.parseInt(result.slice(offset, offset + 2), 16))
    rgba.push(result.length === 9 ? Number.parseInt(result.slice(7, 9), 16) / 255 : 1)
  } else if (/^#[0-9a-f]{3,4}$/i.test(result)) {
    rgba = [...result.slice(1, 4)].map(part => Number.parseInt(part + part, 16))
    rgba.push(result.length === 5 ? Number.parseInt(result[4]! + result[4]!, 16) / 255 : 1)
  } else {
    expect(result, `Unresolved color: ${value}`).toMatch(/^rgba?\(/)
    rgba = result.match(/[\d.]+/g)!.map(Number)
  }
  // Native 0.2 menu materials are translucent. Test their painted contrast,
  // compositing the surface on the canvas and the foreground on that surface.
  const alpha = rgba[3] ?? 1
  const under = alpha < 1 ? backing ?? color('var(--dsw-alias-bg-base)', dark) : [0, 0, 0]
  return rgba.slice(0, 3).map((channel, i) => channel * alpha + under[i]! * (1 - alpha))
}
function luminance(rgb: number[]) {
  const values = rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return values[0]! * .2126 + values[1]! * .7152 + values[2]! * .0722
}
function contrast(foreground: string, background: string, dark: boolean) {
  const surface = color(background, dark)
  const a = luminance(color(foreground, dark, surface)), b = luminance(surface)
  return (Math.max(a,b) + .05) / (Math.min(a,b) + .05)
}

describe.each([false, true])('rendered theme color pairs (dark=%s)', dark => {
  it('keeps add-member panel and search readable; QR fallback stays dark on white', () => {
    const props = { source: { sourceRef: 'group', kind: 'group_chat' as const, displayName: '群聊', activeAtMillis: 1, unreadCount: 0 }, open: true, onClose() {}, onAdded() {}, onError() {}, onAddMembers() {} }
    const dom = new JSDOM(renderToStaticMarkup(<><AddMembersDrawer {...props}/><InviteCollaboratorsDialog {...props}/></>))
    try {
      const panel = dom.window.document.querySelector<HTMLElement>('section[aria-label="添加成员"]')!
      expect(contrast(panel.style.color, panel.style.background, dark)).toBeGreaterThanOrEqual(4.5)
      const input = panel.querySelector('input')!
      expect(contrast(input.style.color, input.style.background, dark)).toBeGreaterThanOrEqual(4.5)
      const fallback = [...dom.window.document.querySelectorAll('span')].find(e=>e.textContent==='邀请链接生成失败，请重试')!
      expect(fallback.style.color).toBe('rgb(81, 86, 95)')
      expect(fallback.parentElement!.style.background).toBe('rgb(255, 255, 255)')
    } finally { dom.window.close() }
  })
  it('keeps voiceprint page, primary actions and independent dialogs readable', () => {
    const noop = () => {}
    const dom = new JSDOM(renderToStaticMarkup(<><ArkmeVoiceprintSurface />
      <RecognizedPersonDialog person={{ status: 'loading' }} targetIdentifier="" invitation={{ status: 'idle' }}
        onRetryPerson={noop} onRetryLibrary={noop} onTargetIdentifierChange={noop} onSearchTarget={noop} onInvite={noop} onClose={noop} />
    </>))
    try {
      const page = dom.window.document.querySelector<HTMLElement>('[data-arkme-owned="voiceprint-surface"]')!
      expect(page.style.color).toBe(arkmeTheme.text)
      expect(contrast(page.style.color, page.style.background, dark)).toBeGreaterThanOrEqual(4.5)
      const primary = page.querySelector<HTMLElement>('[data-arkme-feedback="primary"]')!
      expect(contrast(primary.style.color, primary.style.background, dark)).toBeGreaterThanOrEqual(4.5)
      const dialog = dom.window.document.querySelector<HTMLElement>('[role="dialog"]')!
      expect(contrast(dialog.style.color, dialog.style.background, dark)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(arkmeTheme.secondary, arkmeTheme.subtle, dark)).toBeGreaterThanOrEqual(4.5)
    } finally { dom.window.close() }
  })

  it.each([false, true])('keeps populated date and count readable (selected=%s)', selected => {
    const dom = new JSDOM(renderToStaticMarkup(<ArkmeCalendarCell date={new Date(2026,8,18)}
      selected={selected} disabled={false} showCountLabel onClick={() => {}}
      meta={{bucketDate:'2026-09-18',count:18,hasRecords:true,protectedCount:0}} />))
    try {
      const button = dom.window.document.querySelector('button')!
      const count = button.querySelectorAll('span')[1]!
      const bg = button.style.background
      expect(contrast(button.style.color, bg, dark)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(count.style.color, bg, dark)).toBeGreaterThanOrEqual(4.5)
    } finally { dom.window.close() }
  })
  it('pairs the calendar portal surface with theme text', () => {
    const dom = new JSDOM(renderToStaticMarkup(<ArkmeCalendarSurface />))
    try {
      const card = dom.window.document.querySelector<HTMLElement>('section[aria-label="客户端日历"]')!
      expect(card.style.background).toBe(arkmeTheme.menu)
      expect(contrast(card.style.color, card.style.background, dark)).toBeGreaterThanOrEqual(4.5)
      if (dark) expect(luminance(color(card.style.background, dark))).toBeLessThan(.1)
    } finally { dom.window.close() }
  })
  it('keeps both shared floating selectors readable, including secondary counts', () => {
    expect(contrast(arkmeTheme.text, CONVERSATION_MENU_COLORS.selected, dark)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(arkmeTheme.secondary, CONVERSATION_MENU_COLORS.selected, dark)).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps input text and placeholder colors readable on the input surface', () => {
    expect(contrast(arkmeTheme.text, arkmeTheme.input, dark)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(arkmeTheme.secondary, arkmeTheme.input, dark)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(arkmeTheme.text, arkmeTheme.base, dark)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(arkmeTheme.secondary, arkmeTheme.base, dark)).toBeGreaterThanOrEqual(4.5)
    if (dark) expect(color(arkmeTheme.input, dark)).not.toEqual(color(arkmeTheme.base, dark))
  })
})
