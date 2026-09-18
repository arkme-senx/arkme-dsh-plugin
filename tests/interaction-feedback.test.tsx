import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeComposerToolButton } from '../src/client/ArkmeComposerToolButton.js'
import { ArkmeConversationHeaderIconButton } from '../src/client/ArkmeGroupChatControls.js'
import { ArkmeCalendarCell } from '../src/client/ArkmeCalendarSurface.js'
import { ArkmeQuickAddMenu } from '../src/client/ArkmeQuickAdd.js'

const css = readFileSync(new URL('../src/client/redesign/interaction-feedback.css', import.meta.url), 'utf8')
const readSource = (name: string) => readFileSync(new URL(`../src/client/${name}.tsx`, import.meta.url), 'utf8')

// Exercise selector eligibility separately from rendering. JSDOM does not
// implement pointer state, registered properties or gradient interpolation.
const selectorFor = (state: string) => css.match(new RegExp(`([^{}]+):${state}\\s*\\{`))![1]!.trim()
const eligible = (html: string, state: string) => {
  const dom = new JSDOM(`<body>${html}</body>`)
  const matches = dom.window.document.querySelector('button')!.matches(selectorFor(state))
  dom.window.close()
  return matches
}

describe('shared Arkme interaction feedback', () => {
  it.each(['hover', 'active', 'focus-visible'])('only opts interactive controls into %s', state => {
    expect(eligible('<button data-arkme-feedback="neutral" />', state)).toBe(true)
    expect(eligible('<button />', state)).toBe(false)
    expect(eligible('<button data-arkme-feedback="neutral" disabled />', state)).toBe(false)
    expect(eligible('<button data-arkme-feedback="neutral" aria-disabled="true" />', state)).toBe(false)
    expect(eligible('<button data-arkme-feedback="neutral" aria-disabled="false" />', state)).toBe(true)
  })

  it.each(['hover', 'active'])('does not imply a busy control is available on %s', state => {
    expect(eligible('<button data-arkme-feedback="neutral" aria-busy="true" />', state)).toBe(false)
  })

  it('preserves base fill and geometry, with separate selected, primary and danger feedback', () => {
    expect(css).toContain('background-image: linear-gradient(')
    expect(css).not.toMatch(/(?:^|[;\s])(?:background|width|height|padding|margin|border-radius|transform):/)
    expect(css).toContain('[data-arkme-feedback="neutral"]:is([aria-current="page"]')
    expect(css).toContain('[aria-selected="true"]')
    expect(css).toContain('[aria-checked="true"]')
    expect(css).toContain('[data-arkme-feedback="primary"]')
    expect(css).toContain('[data-arkme-feedback="danger"]')
    expect(css).toContain('--dsw-alias-interactive-bg-hover-danger')
    expect(css).toContain('--dsw-alias-interactive-bg-active')
    expect(css).toContain('--dsw-alias-label-primary-inverted')
  })

  it('uses the host theme, desktop hover, visible keyboard focus and reduced-motion preference', () => {
    expect(css).toContain('@media (hover: hover)')
    expect(css).toContain('@property --arkme-control-feedback-fill')
    expect(css).toContain('inherits: false')
    expect(css).toContain('120ms ease')
    expect(css).toContain(':focus-visible')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('transition: none !important')
    const installer = readFileSync(new URL('../src/client/redesign/styles.ts', import.meta.url), 'utf8')
    expect(installer).toContain("import interactionFeedbackCss from './interaction-feedback.css?inline'")
    expect(installer).toContain('${interactionFeedbackCss}')
    expect(installer).toContain('document.head.append(style)')
  })

  it('shares feedback across rendered composer tools, header tools and portaled-menu content', () => {
    const markup = renderToStaticMarkup(<>
      <ArkmeComposerToolButton aria-label="添加" onClick={vi.fn()}>+</ArkmeComposerToolButton>
      <ArkmeConversationHeaderIconButton label="搜索" onClick={vi.fn()}>搜索</ArkmeConversationHeaderIconButton>
      <ArkmeQuickAddMenu onContactAdd={vi.fn()} onCreateGroup={vi.fn()} onAddBot={vi.fn()} />
    </>)
    const dom = new JSDOM(markup)
    const buttons = [...dom.window.document.querySelectorAll('button')]
    expect(buttons.length).toBeGreaterThanOrEqual(5)
    expect(buttons.filter(button => button.getAttribute('role') !== 'menuitem').every(button => button.dataset.arkmeFeedback === 'neutral')).toBe(true)
    expect(buttons.filter(button => button.getAttribute('role') === 'menuitem').every(button => !button.dataset.arkmeFeedback)).toBe(true)
    expect(dom.window.document.querySelector<HTMLButtonElement>('[aria-label="添加"]')!.style.width).toBe('34px')
    expect(dom.window.document.querySelector<HTMLButtonElement>('[aria-label="搜索"]')!.style.width).toBe('28px')
    dom.window.close()
  })

  it.each([false, true])('keeps calendar selection and disabled state independent (%s)', disabled => {
    const markup = renderToStaticMarkup(<ArkmeCalendarCell date={new Date(2026, 8, 18)} selected disabled={disabled} onClick={vi.fn()} />)
    const dom = new JSDOM(markup)
    const button = dom.window.document.querySelector('button')!
    expect(button.dataset.arkmeFeedback).toBe('primary')
    expect(button.dataset.selected).toBe('true')
    expect(button.disabled).toBe(disabled)
    dom.window.close()
  })

  it.each([
    'ArkmeProductNavigation', 'ArkmeVirtualWorkspace', 'ArkmeSidebar',
    'ArkmeConversationSearch', 'ArkmePrivateCallMenu', 'ArkmeMessageActions',
    'ArkmeChatMemberActions', 'ArkmeConfirmDialog', 'ArkmeEmojiPicker',
    'ArkmeSearchSurface', 'ArkmeRecordingSurface', 'ArkmeCallSurface',
    'ArkmeWorldSurface', 'ArkmeMarketplace', 'ArkmeSettingsSurface',
    'redesign/contacts/ContactProfileDetail', 'recordings/RecordingTranscriptButton',
  ])('opts %s into the shared system rather than a new local hover style', name => {
    expect(readSource(name)).toContain('data-arkme-feedback=')
  })

  it('does not replace DSH native menu feedback or add a second emoji highlight', () => {
    expect(readSource('ArkmeDshMenu')).not.toContain('data-arkme-feedback')
    expect(readSource('ArkmeEmojiPicker')).not.toContain('background: \'var(--dsw-alias-fill-hover')
    expect(readSource('ArkmeEmojiPicker')).toContain('onMouseEnter={() => { setHoveredId(emoji.id) }}')
  })
})
