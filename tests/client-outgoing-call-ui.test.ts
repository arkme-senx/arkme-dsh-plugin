import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { ArkmePrivateCallMenu } from '../src/client/ArkmePrivateCallMenu.js'
import { ArkmeActionMenu } from '../src/client/ArkmeDshMenu.js'
import { outgoingCallModalLayout } from '../src/client/ArkmeOutgoingCallHost.js'

describe('outgoing call UI', () => {
  it('renders the exact-size private-chat call trigger with the pinned frontend icon', () => {
    const html = renderToStaticMarkup(createElement(ArkmePrivateCallMenu, {
      sourceRef: 'signed-private-ref', displayName: '小林', assetBasePath: '/arkme-self/api/call',
    }))
    expect(html).toContain('aria-label="呼叫小林"')
    expect(html).toContain('/arkme-self/api/call/call-linear-strong.svg')
    expect(html).toContain('width:28px')
    expect(html).toContain('height:28px')
    expect(html).toContain('--dsw-alias-label-secondary')
    expect(html).toContain('mask-image:url(&quot;/arkme-self/api/call/call-linear-strong.svg&quot;)')
    expect(html).toContain('background-color:currentColor')
    expect(html).not.toContain('<img')
  })

  it('uses the shared DSH menu rather than a private sizing or animation implementation', () => {
    let renderer: ReactTestRenderer | undefined
    act(() => { renderer = create(createElement(ArkmePrivateCallMenu, { sourceRef: 'ref', displayName: '小林' })) })
    const menu = renderer!.root.findByType(ArkmeActionMenu)
    expect(menu.props.label).toBe('选择通话方式')
    expect(menu.props.align).toBe('end')
    expect(menu.props.actions.map((item: { label: string }) => item.label)).toEqual(['语音通话', '视频通话'])
    act(() => renderer!.unmount())
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
    expect(audioIcon.props.style).toMatchObject({ width: 16, height: 16, backgroundColor: 'currentColor' })
    expect(audioIcon.props.style.maskImage).toBe('url("/arkme-self/api/call/call-linear.svg")')
    const videoIcon = renderer!.root.findByProps({ 'data-arkme-private-call-menu-icon': 'video-linear.svg' })
    expect(videoIcon.props.style.maskImage).toBe('url("/arkme-self/api/call/video-linear.svg")')
    const [audioItem, videoItem] = renderer!.root.findAllByProps({ role: 'menuitem' })
    expect(audioItem!.props['aria-label']).toBe('语音通话')
    expect(videoItem!.props['aria-label']).toBe('视频通话')
    expect(audioItem!.props.style).toBeUndefined()
    act(() => { renderer!.unmount() })
  })

  it('uses the confirmed default, compact, and fullscreen modal dimensions', () => {
    expect(outgoingCallModalLayout(false, false)).toMatchObject({ width: 'min(960px, calc(100vw - 32px))', height: 'min(640px, calc(100vh - 32px))' })
    expect(outgoingCallModalLayout(true, false)).toMatchObject({ width: 160, height: 280 })
    expect(outgoingCallModalLayout(false, true)).toMatchObject({ width: '100vw', height: '100vh' })
  })
})
