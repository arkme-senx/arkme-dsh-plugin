// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeInterwovenMentionCard } from '../src/client/interwoven-moments.js'
import { connectArkmeLocale } from '../src/client/locale.js'
import type { ArkmeInterwovenMention } from '../src/types.js'

const { callArkme, avatarImage } = vi.hoisted(() => ({ callArkme: vi.fn(), avatarImage: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme }))
vi.mock('../src/client/use-arkme-avatar-image.js', () => ({ useArkmeAvatarImage: avatarImage }))
const moment: ArkmeInterwovenMention = {
  momentId: 'one', momentRef: 'ref-one', occurredAtMillis: 1700000000000,
  groupName: '用于验证很长名称仍然能够完整查看的产品讨论群', senderName: '完整发送者昵称',
  senderAvatarRef: 'opaque-avatar', senderIsMe: false,
  summary: '@同事 请看看这个问题，正文不能被群名称和昵称挤掉', degraded: false,
}
let root: Root, host: HTMLDivElement, disconnectLocale: () => void
const onOpen = vi.fn()
const button = () => host.querySelector<HTMLButtonElement>('button')!
const tip = () => document.querySelector<HTMLElement>('[role="tooltip"]')
const render = (overrides: Partial<ArkmeInterwovenMention> = {}) => act(() => root.render(
  <ul><ArkmeInterwovenMentionCard moment={{ ...moment, ...overrides }} onOpen={onOpen} /></ul>,
))
const hover = () => act(() => { button().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers(); callArkme.mockReset(); onOpen.mockReset()
  avatarImage.mockReset().mockImplementation((ref?: string) => ref ? `https://avatar.test/${ref}` : undefined)
  disconnectLocale = connectArkmeLocale({ getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); disconnectLocale()
  vi.useRealTimers(); vi.unstubAllGlobals()
})

describe('compact interwoven summary', () => {
  it.each([true, false])('shows the actual sender avatar, content, then bounded group label (outgoing=%s)', senderIsMe => {
    const senderAvatarRef = senderIsMe ? 'own-avatar' : 'peer-avatar'
    render({ senderIsMe, senderAvatarRef })
    const parts = [...button().children]
    expect(parts[0]?.hasAttribute('data-arkme-interwoven-avatar')).toBe(true)
    expect(parts[0]?.querySelector('img')?.getAttribute('src')).toBe(`https://avatar.test/${senderAvatarRef}`)
    expect(avatarImage).toHaveBeenCalledWith(senderAvatarRef)
    expect((parts[0] as HTMLElement).style.width).toBe('20px')
    expect((parts[0] as HTMLElement).style.height).toBe('20px')
    expect((parts[0] as HTMLElement).style.flex).toBe('0 0 auto')
    expect(parts[1]?.textContent).toBe(moment.summary)
    expect(parts[2]?.textContent).toBe(moment.groupName)
    expect(host.querySelector('[data-arkme-interwoven-direction]')).toBeNull()
    expect(button().textContent).not.toContain(moment.senderName)
    expect(button().getAttribute('aria-label')).toContain(moment.senderName)
    expect((parts[1] as HTMLElement).style.textOverflow).toBe('ellipsis')
    expect((parts[2] as HTMLElement).style.maxWidth).toBe('min(9em, 24%)')
    expect(callArkme).not.toHaveBeenCalled()
  })

  it.each(['小林', '  Alice', '😀朋友', ''])('uses a visible nickname initial when an avatar is unavailable (%s)', senderName => {
    render({ senderAvatarRef: undefined, senderName })
    const avatar = host.querySelector('[data-arkme-interwoven-avatar]')!
    expect(avatar.querySelector('img')).toBeNull()
    expect(avatar.textContent).toBe(Array.from(senderName.trim())[0] || '?')
  })

  it('uses the same initial while the image cache is loading or its request failed', () => {
    avatarImage.mockReturnValue(undefined)
    render()
    expect(host.querySelector('[data-arkme-interwoven-avatar]')?.textContent).toBe('完')
    avatarImage.mockReturnValue('https://avatar.test/loaded')
    render()
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://avatar.test/loaded')
  })

  it('replaces a broken image with the nickname initial and retries a refreshed image URL', () => {
    render()
    act(() => { host.querySelector('img')!.dispatchEvent(new Event('error')) })
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('[data-arkme-interwoven-avatar]')?.textContent).toBe('完')
    hover(); expect(host.querySelector('img')).toBeNull()
    avatarImage.mockReturnValue('https://avatar.test/refreshed')
    render()
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://avatar.test/refreshed')
  })

  it('does not carry a failed image or old photo across a sender change', () => {
    render()
    act(() => { host.querySelector('img')!.dispatchEvent(new Event('error')) })
    render({ senderAvatarRef: 'new-sender', senderName: '新昵称' })
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://avatar.test/new-sender')
    render({ senderAvatarRef: undefined, senderName: '无头像' })
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('[data-arkme-interwoven-avatar]')?.textContent).toBe('无')
  })

  it('immediately reveals full identity and content without a native delayed title or a new request', () => {
    render(); expect(tip()).toBeNull(); hover()
    expect(tip()?.textContent).toBe(`${moment.groupName}，${moment.senderName}：${moment.summary}`)
    expect(button().hasAttribute('title')).toBe(false)
    expect(button().getAttribute('aria-describedby')).toBe(tip()?.id)
    expect(callArkme).not.toHaveBeenCalled()
    act(() => { button().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })) })
    expect(tip()).toBeNull()
  })

  it('supports keyboard focus and preserves the single details action', () => {
    render(); act(() => button().focus()); expect(tip()).not.toBeNull()
    act(() => button().click())
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(moment)
    expect(tip()).toBeNull()
    act(() => button().blur()); expect(button().hasAttribute('aria-describedby')).toBe(false)
  })

  it.each(['Escape', 'scroll', 'resize', 'blur'])('dismisses the full hint on %s', kind => {
    render(); hover(); expect(tip()).not.toBeNull()
    act(() => {
      if (kind === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: kind }))
      else if (kind === 'scroll') host.dispatchEvent(new Event('scroll'))
      else window.dispatchEvent(new Event(kind))
    })
    expect(tip()).toBeNull()
  })

  it('does not retain an old message tooltip when a row is reused', () => {
    render(); hover(); render({ momentRef: 'ref-two', summary: '新内容' })
    expect(tip()).toBeNull(); expect(button().textContent).toContain('新内容')
  })

  it('localizes empty-summary fallback without translating user content or adding direction text', () => {
    disconnectLocale()
    disconnectLocale = connectArkmeLocale({ getLocale: () => ({ active: 'en' }), subscribe: () => () => {} })
    render({ summary: '  ', senderIsMe: false })
    expect(button().textContent).toBe(`Group mention${moment.groupName}`)
    render({ senderIsMe: true })
    expect(button().textContent).toBe(`${moment.summary}${moment.groupName}`)
  })
})
