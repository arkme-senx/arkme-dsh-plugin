import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { shouldShowUserBanAction } from '../src/client/user-ban.js'

describe('private-chat user-ban UI', () => {
  it('shows the action only to a staff account with a concrete private-chat peer', () => {
    expect(shouldShowUserBanAction({
      authenticated: true, sourceKind: 'private_chat', accountType: 2, peerUserId: 42, currentUserId: 7,
    })).toBe(true)
    expect(shouldShowUserBanAction({
      authenticated: true, sourceKind: 'private_chat', accountType: 1, peerUserId: 42, currentUserId: 7,
    })).toBe(false)
    expect(shouldShowUserBanAction({
      authenticated: true, sourceKind: 'group_chat', accountType: 2, peerUserId: 42, currentUserId: 7,
    })).toBe(false)
    expect(shouldShowUserBanAction({
      authenticated: true, sourceKind: 'private_chat', accountType: 2, peerUserId: 7, currentUserId: 7,
    })).toBe(false)
  })

  it('places the employee action in the existing private-chat menu below related recordings', () => {
    const source = readFileSync(new URL('../src/client/ArkmeSidebar.tsx', import.meta.url), 'utf8')
    const related = source.indexOf('<span>相关录音</span>')
    const ban = source.indexOf("userBanSnapshot.banned ? '解封用户' : '封禁用户'")

    expect(related).toBeGreaterThan(-1)
    expect(ban).toBeGreaterThan(related)
    expect(source).not.toContain('用户管理')
    expect(source).toContain('Backend、聊天和录音请求会立即受限，其他现有凭证最迟约 1 小时失效')
    expect(source).toContain("remark: ''")
    expect(source).not.toContain('remark: userBanSnapshot.record')
  })
})
