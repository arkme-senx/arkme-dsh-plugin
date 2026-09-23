import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamChannel } from '../src/team-app-contract.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
import { TeamChannelSettings } from '../src/client/TeamMessagingPanel.js'

function text(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : text(child)).join('')
}
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
let renderer: ReactTestRenderer | undefined
let channel: TeamChannel
let changed: ReturnType<typeof vi.fn>
const button = (label: string) => renderer!.root.findAllByType('button').find(node => text(node) === label)!
const click = async (node: ReactTestInstance) => { await act(async () => { node.props.onClick(); await tick() }) }
const mount = async () => { await act(async () => { renderer = create(<TeamChannelSettings teamRef="team" accountKey="account" onChanged={changed} />); await tick() }) }
describe('Team channel settings interactions', () => {
  beforeEach(() => {
    channel = { teamRef: 'team', name: '工作室', jotmoId: 'studio', enabled: false, canManage: true, publicRef: '', link: '', revision: 1 }
    changed = vi.fn(); mocks.call.mockReset()
    mocks.call.mockImplementation(async (op: string, input: { enabled?: boolean }) => {
      if (op === 'team.app.channel') return channel
      if (op === 'team.app.applications') return { items: [], hasMore: false }
      if (op === 'team.app.channel.configure') { channel = { ...channel, enabled: input.enabled!, publicRef: 'a'.repeat(32), revision: channel.revision + 1 }; return channel }
      throw new Error(op)
    })
  })
  afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals() })
  it('requires confirmation before opening to all existing members and preserves revision on pause', async () => {
    await mount()
    await click(renderer!.root.findByProps({ role: 'switch' }))
    expect(mocks.call.mock.calls.filter(v => v[0] === 'team.app.channel.configure')).toHaveLength(0)
    expect(text(renderer!.root)).toContain('现有成员均可查看全部团队对话')
    await click(button('取消'))
    expect(changed).not.toHaveBeenCalled()
    await click(renderer!.root.findByProps({ role: 'switch' })); await click(button('确认'))
    expect(renderer!.root.findByProps({ role: 'switch' }).props['aria-checked']).toBe(true)
    await click(renderer!.root.findByProps({ role: 'switch' }))
    expect(mocks.call.mock.calls.filter(v => v[0] === 'team.app.channel.configure').map(v => v[1])).toEqual([
      { teamRef: 'team', revision: 1, enabled: true, rotate: false },
      { teamRef: 'team', revision: 2, enabled: false, rotate: false },
    ])
  })
  it.each(['arkme_cn', 'studio'])('offers the same member view for %s without management or membership mutations', async jotmoId => {
    channel = { ...channel, jotmoId, canManage: false, enabled: true, publicRef: 'a'.repeat(32), link: 'https://example.com/team-message?channel=' + 'a'.repeat(32) }
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await mount()
    expect(renderer!.root.findAllByProps({ role: 'switch' })).toHaveLength(0)
    expect(button('重置分享链接')).toBeUndefined()
    expect(mocks.call.mock.calls.some(v => v[0] === 'team.app.applications')).toBe(false)
    await click(button('复制消息链接'))
    expect(writeText).toHaveBeenCalledWith(channel.link)
    expect(text(renderer!.root)).toContain('通道链接已复制')
  })
  it('keeps a failed operation retryable without claiming that the channel changed', async () => {
    await mount(); await click(renderer!.root.findByProps({ role: 'switch' }))
    mocks.call.mockImplementation(async (op: string) => { if (op === 'team.app.channel.configure') throw new Error('服务暂不可用'); return channel })
    await click(button('确认'))
    expect(text(renderer!.root)).toContain('服务暂不可用')
    expect(renderer!.root.findByProps({ role: 'switch' }).props['aria-checked']).toBe(false)
    expect(button('确认').props.disabled).toBe(false)
    expect(changed).not.toHaveBeenCalled()
  })
})
