import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ARKME_GROUP_HEADER_ICON_COLOR, ArkmeGroupChatControls,
} from '../src/client/ArkmeGroupChatControls.js'

describe('group chat header dark-mode contract', () => {
  it('renders member and more icons from the current semantic foreground', () => {
    const html = renderToStaticMarkup(<ArkmeGroupChatControls
      source={{
        sourceRef: 'group-ref', kind: 'group_chat', displayName: '群聊',
        activeAtMillis: 1, unreadCount: 0,
      }}
      overlayHostRef={createRef<HTMLElement>()}
      onSourceActivated={() => {}}
      onError={() => {}}
    />)

    expect(ARKME_GROUP_HEADER_ICON_COLOR).toContain('--dsw-alias-label-secondary')
    expect(html).toContain('aria-label="查看群成员"')
    expect(html).toContain('mask-image:url(&quot;data:image/svg+xml;base64,')
    expect(html).toContain('background-color:currentColor')
    expect(html).toContain('fill="currentColor"')
    expect(html).not.toContain('filter:brightness(0)')
  })
})
