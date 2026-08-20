import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as startupAuthGateModule from '../src/client/ArkmeStartupAuthGate.js'
import {
  ArkmeStartupAuthGateView,
  inertArkmeAppFrameSiblings,
  startupAuthGateEnabled,
  startupAuthGateScreen,
} from '../src/client/ArkmeStartupAuthGate.js'

afterEach(() => { vi.unstubAllGlobals() })

class FakeElement {
  readonly attributes = new Map<string, string>()
  inert = false
  parentElement: FakeElement | null = null
  children: FakeElement[] = []

  hasAttribute(name: string): boolean { return this.attributes.has(name) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  removeAttribute(name: string): void { this.attributes.delete(name) }
}

describe('Arkme startup authentication gate', () => {
  it('is enabled only by the immutable desktop preload capability', () => {
    expect(startupAuthGateEnabled({ arkmeDesktop: { startupAuthGate: true } })).toBe(true)
    expect(startupAuthGateEnabled({ arkmeDesktop: { startupAuthGate: false } })).toBe(false)
    expect(startupAuthGateEnabled({})).toBe(false)
  })

  it('maps every authentication outcome to a fail-closed screen', () => {
    expect(startupAuthGateScreen(undefined, 'unknown', '')).toBe('checking')
    expect(startupAuthGateScreen(undefined, 'unknown', '网络连接失败')).toBe('error')
    expect(startupAuthGateScreen({ status: 'logged-out', environment: 'prod' }, 'unknown', '')).toBe('login')
    expect(startupAuthGateScreen({ status: 'expired', environment: 'prod' }, 'unknown', '')).toBe('login')
    expect(startupAuthGateScreen({ status: 'binding-required', environment: 'prod', userId: 1 }, 'required', '')).toBe('login')
    expect(startupAuthGateScreen({ status: 'authenticated', environment: 'prod', userId: 1 }, 'checking', '')).toBe('checking')
    expect(startupAuthGateScreen({ status: 'authenticated', environment: 'prod', userId: 1 }, 'ready', '')).toBe('authenticated')
  })

  it('renders checking and retry states while authenticated removes the overlay surface', () => {
    expect(renderToStaticMarkup(<ArkmeStartupAuthGateView screen="checking" error="" busy={false} onRetry={() => undefined} />))
      .toContain('正在确认登录状态')
    const errorMarkup = renderToStaticMarkup(
      <ArkmeStartupAuthGateView screen="error" error="网络连接失败" busy={false} onRetry={() => undefined} />,
    )
    expect(errorMarkup).toContain('网络连接失败')
    expect(errorMarkup).toContain('重试')
    expect(renderToStaticMarkup(
      <ArkmeStartupAuthGateView screen="authenticated" error="" busy={false} onRetry={() => undefined} />,
    )).toBe('')
  })

  it('makes every AppFrame sibling inert and restores its exact accessibility state', () => {
    const frame = new FakeElement()
    const sidebar = new FakeElement()
    const conversation = new FakeElement()
    const overlay = new FakeElement()
    conversation.inert = true
    conversation.setAttribute('aria-hidden', 'false')
    overlay.setAttribute('data-shell-overlay', '')
    frame.children = [sidebar, conversation, overlay]
    sidebar.parentElement = frame
    conversation.parentElement = frame
    overlay.parentElement = frame

    const restore = inertArkmeAppFrameSiblings(overlay as never)

    expect(sidebar.inert).toBe(true)
    expect(sidebar.getAttribute('aria-hidden')).toBe('true')
    expect(conversation.inert).toBe(true)
    expect(conversation.getAttribute('aria-hidden')).toBe('true')
    expect(overlay.inert).toBe(false)

    restore()
    expect(sidebar.inert).toBe(false)
    expect(sidebar.hasAttribute('aria-hidden')).toBe(false)
    expect(conversation.inert).toBe(true)
    expect(conversation.getAttribute('aria-hidden')).toBe('false')
  })

  it('dismisses host dialogs once per gate activation', () => {
    const syncHostDialogs = Reflect.get(startupAuthGateModule, 'syncAuthGateHostDialogs') as unknown
    expect(syncHostDialogs).toBeTypeOf('function')
    if (typeof syncHostDialogs !== 'function') return

    class FakeKeyboardEvent {
      readonly type: string
      readonly key: string
      readonly bubbles: boolean
      readonly cancelable: boolean

      constructor(type: string, init: KeyboardEventInit) {
        this.type = type
        this.key = init.key ?? ''
        this.bubbles = init.bubbles ?? false
        this.cancelable = init.cancelable ?? false
      }
    }
    vi.stubGlobal('KeyboardEvent', FakeKeyboardEvent)
    const events: FakeKeyboardEvent[] = []
    const target = {
      dispatchEvent(event: FakeKeyboardEvent) {
        events.push(event)
        return true
      },
    }
    const sync = syncHostDialogs as (
      wasActive: boolean,
      screen: 'checking' | 'login' | 'error' | 'authenticated',
      eventTarget: typeof target,
    ) => boolean

    let active = sync(false, 'checking', target)
    active = sync(active, 'login', target)
    active = sync(active, 'authenticated', target)
    active = sync(active, 'login', target)

    expect(active).toBe(true)
    expect(events).toEqual([
      expect.objectContaining({ type: 'keydown', key: 'Escape', bubbles: true, cancelable: true }),
      expect.objectContaining({ type: 'keydown', key: 'Escape', bubbles: true, cancelable: true }),
    ])
  })
})
