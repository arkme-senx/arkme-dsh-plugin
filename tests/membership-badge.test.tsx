import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeMembershipBadge } from '../src/client/ArkmeMembershipBadge.js'
import { arkmePeerMemberType } from '../src/peer-membership.js'

describe('private-chat membership star', () => {
  it.each([undefined, 'free', 'unknown'] as const)('hides %s', memberType => {
    expect(renderToStaticMarkup(<ArkmeMembershipBadge memberType={memberType} />)).toBe('')
  })
  it.each(['vip', 'svip'] as const)('renders compact %s star', memberType => {
    const markup = renderToStaticMarkup(<ArkmeMembershipBadge memberType={memberType} />)
    expect(markup).toContain(`aria-label="${memberType.toUpperCase()} 会员"`)
    expect(markup).toContain('width="13" height="13"')
    expect(markup).toContain(memberType === 'svip' ? '#e3b65b' : '#d8c7f9')
  })
  it.each([[1, 'vip'], [' VIP ', 'vip'], ['vip_member', 'vip'], [2, 'svip'], ['super-vip', 'svip'], [0, 'free'], [undefined, 'unknown'], ['future', 'unknown']])('normalizes %s', (input, expected) => {
    expect(arkmePeerMemberType(input)).toBe(expected)
  })
})
