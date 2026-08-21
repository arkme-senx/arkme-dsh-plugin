import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { ArkmePrivateCallMenu } from '../src/client/ArkmePrivateCallMenu.js'
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

  it('uses the confirmed default, compact, and fullscreen modal dimensions', () => {
    expect(outgoingCallModalLayout(false, false)).toMatchObject({ width: 'min(960px, calc(100vw - 32px))', height: 'min(640px, calc(100vh - 32px))' })
    expect(outgoingCallModalLayout(true, false)).toMatchObject({ width: 160, height: 280 })
    expect(outgoingCallModalLayout(false, true)).toMatchObject({ width: '100vw', height: '100vh' })
  })
})
