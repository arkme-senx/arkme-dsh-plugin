import { describe, expect, it } from 'vitest'
import { calculateArkmeFloatingFrame } from '../src/client/ArkmeConversationSurface.js'
import { arkmeAuthView } from '../src/client/ArkmeSidebar.js'

describe('Arkme floating conversation frame', () => {
  it('keeps a uniform floating inset inside a wide DSH conversation column', () => {
    expect(calculateArkmeFloatingFrame({ left: 280, top: 0, width: 1232, height: 674 })).toEqual({
      left: 296,
      top: 16,
      width: 1200,
      height: 642,
    })
  })

  it('keeps compact margins when the DSH conversation column is narrow', () => {
    expect(calculateArkmeFloatingFrame({ left: 64, top: 0, width: 640, height: 480 })).toEqual({
      left: 80,
      top: 16,
      width: 608,
      height: 448,
    })
  })

  it('does not treat an unresolved auth check as logged out', () => {
    expect(arkmeAuthView(undefined)).toBe('checking')
    expect(arkmeAuthView({ status: 'authenticated', environment: 'prod', userId: 1 })).toBe('content')
    expect(arkmeAuthView({ status: 'logged-out', environment: 'prod' })).toBe('login')
    expect(arkmeAuthView({ status: 'expired', environment: 'prod' })).toBe('login')
  })
})
