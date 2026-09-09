import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { ArkmePrivateCallMenu, arkmePrivateCallMenuMotionCss, arkmePrivateCallMenuPlacement } from '../src/client/ArkmePrivateCallMenu.js'
import { outgoingCallModalLayout } from '../src/client/ArkmeOutgoingCallHost.js'

describe('outgoing call UI', () => {
  it('renders the exact-size private-chat call trigger with the pinned frontend icon', () => {
    const html = renderToStaticMarkup(createElement(ArkmePrivateCallMenu, {
      sourceRef: 'signed-private-ref', displayName: '小林', assetBasePath: '/arkme-self/api/call',
    }))
    expect(html).toContain('aria-label="呼叫小林"')
    expect(html).toContain('/arkme-self/api/call/call-linear-strong.svg')
    expect(html).toContain('width:24px')
    expect(html).toContain('height:24px')
    expect(html).toContain('--dsw-alias-label-secondary')
    expect(html).toContain('mask-image:url(&quot;/arkme-self/api/call/call-linear-strong.svg&quot;)')
    expect(html).toContain('background-color:currentColor')
    expect(html).not.toContain('<img')
  })

  it('keeps the private-chat call menu inside the viewport when the trigger sits near a clipped edge', () => {
    const placement = arkmePrivateCallMenuPlacement(
      { left: 180, right: 204, top: 20, bottom: 44 },
      { width: 240, height: 300 },
    )
    expect(placement).toMatchObject({ position: 'fixed', left: 84, top: 52, width: 148, transformOrigin: '108px top' })
  })

  it('uses Flutter popup menu expansion and sequential item fades without scaling the content', () => {
    expect(arkmePrivateCallMenuMotionCss).toContain('arkme-private-call-menu-width 85.714286ms linear both')
    expect(arkmePrivateCallMenuMotionCss).toContain('arkme-private-call-menu-height 171.428571ms linear both')
    expect(arkmePrivateCallMenuMotionCss).toContain('arkme-private-call-menu-fade 128.571429ms linear both')
    expect(arkmePrivateCallMenuMotionCss).toContain('animation-delay: 85.714286ms')
    expect(arkmePrivateCallMenuMotionCss).toContain('animation-delay: 171.428571ms')
    expect(arkmePrivateCallMenuMotionCss).not.toContain('scale(')
    expect(arkmePrivateCallMenuMotionCss).toContain('prefers-reduced-motion')
  })

  it('opens with the original desktop private-chat call menu assets and item rhythm', () => {
    let renderer: ReactTestRenderer | undefined
    act(() => {
      renderer = create(createElement(ArkmePrivateCallMenu, {
        sourceRef: 'signed-private-ref',
        displayName: '小林',
        assetBasePath: '/arkme-self/api/call',
      }))
    })
    act(() => {
      renderer!.root.findByProps({ 'aria-label': '呼叫小林' }).props.onClick({
        currentTarget: {
          getBoundingClientRect: () => ({ left: 40, right: 64, top: 10, bottom: 34 }),
        },
      })
    })

    const audioIcon = renderer!.root.findByProps({ 'data-arkme-private-call-menu-icon': 'call-linear.svg' })
    expect(audioIcon.props.style).toMatchObject({ width: 18, height: 18, backgroundColor: 'currentColor' })
    expect(audioIcon.props.style.maskImage).toBe('url("/arkme-self/api/call/call-linear.svg")')
    const videoIcon = renderer!.root.findByProps({ 'data-arkme-private-call-menu-icon': 'video-linear.svg' })
    expect(videoIcon.props.style.maskImage).toBe('url("/arkme-self/api/call/video-linear.svg")')
    const [audioItem, videoItem] = renderer!.root.findAllByProps({ role: 'menuitem' })
    expect(audioItem!.props.style).toMatchObject({
      height: '100%',
      padding: '0 10px',
      gap: 8,
      borderRadius: 10,
      color: '#292D32',
      fontSize: 13,
      fontWeight: 500,
    })
    expect(videoItem!.children).toContain('视频通话')
    act(() => { renderer!.unmount() })
  })

  it('uses the confirmed default, compact, and fullscreen modal dimensions', () => {
    expect(outgoingCallModalLayout(false, false)).toMatchObject({ width: 'min(960px, calc(100vw - 32px))', height: 'min(640px, calc(100vh - 32px))' })
    expect(outgoingCallModalLayout(true, false)).toMatchObject({ width: 160, height: 280 })
    expect(outgoingCallModalLayout(false, true)).toMatchObject({ width: '100vw', height: '100vh' })
  })
})
