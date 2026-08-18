import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ArkmeOfficialCommunityEntryContent,
  ArkmeOfficialCommunityJoinConfirmation,
} from '../src/client/ArkmeOfficialCommunityEntry.js'

const avatars = [
  'data:image/png;base64,b3duZXI=',
  'data:image/png;base64,bWVtYmVy',
]

describe('official community entry UI', () => {
  it('reuses the approved copy, real avatar mosaic, and non-sticky list placement', () => {
    const markup = renderToStaticMarkup(<ArkmeOfficialCommunityEntryContent
      avatarUrls={avatars}
      joining={false}
      onActivate={() => {}}
    />)

    expect(markup).toContain('即我社区')
    expect(markup).toContain('还没加入即我官方群？')
    expect(markup).toContain('和大家一起聊聊')
    expect(markup).toContain('去加入')
    expect(markup.match(/<img/g)).toHaveLength(2)
    expect(markup).not.toContain('position:sticky')
    expect(markup).not.toContain('JOT')
  })

  it('shows the existing confirmation sheet before the join action', () => {
    const markup = renderToStaticMarkup(<ArkmeOfficialCommunityJoinConfirmation
      avatarUrls={avatars}
      onCancel={() => {}}
      onConfirm={() => {}}
    />)

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('即我官方群')
    expect(markup).toContain('加入群聊')
    expect(markup.match(/<img/g)).toHaveLength(2)
  })

  it('disables the entry while one join is already in flight', () => {
    const markup = renderToStaticMarkup(<ArkmeOfficialCommunityEntryContent
      avatarUrls={avatars}
      joining
      onActivate={() => {}}
    />)

    expect(markup).toContain('disabled=""')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('加入中…')
    expect(markup).not.toContain('去加入')
  })
})
