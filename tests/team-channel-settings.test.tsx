import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamChannel } from '../src/team-app-contract.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async original => ({ ...await original<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(), Toast: ({text}: {text:string}) => <div role="status">{text}</div> }))
import { TeamChannelSettings } from '../src/client/TeamMessagingPanel.js'

function text(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : text(child)).join('')
}
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
let renderer: ReactTestRenderer | undefined
let channel: TeamChannel
let changed: ReturnType<typeof vi.fn>
const button = (label: string) => renderer!.root.findAllByType('button').find(node => node.props['aria-label'] === label || text(node) === label)!
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
  it('hides empty joining applications and duplicate channel status text', async () => {
    await mount()
    expect(text(renderer!.root)).toContain('接收外部消息')
    expect(text(renderer!.root)).not.toContain('正在接收消息')
    expect(text(renderer!.root)).not.toContain('没有待处理申请')
    expect(renderer!.root.findAllByType('details')).toHaveLength(0)
  })
  it('still shows pending joining applications', async () => {
    const original = mocks.call.getMockImplementation()!
    mocks.call.mockImplementation(async (op, p) => op === 'team.app.applications'
      ? {items:[{ref:'application',name:'申请人甲',state:'pending',requestedAt:1}],hasMore:false}
      : original(op,p))
    await mount()
    expect(text(renderer!.root)).toContain('申请人甲')
    expect(button('同意')).toBeDefined()
  })
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
    expect(button('重置链接')).toBeUndefined()
    expect(mocks.call.mock.calls.some(v => v[0] === 'team.app.applications')).toBe(false)
    await click(button('复制链接'))
    expect(writeText).toHaveBeenCalledWith(channel.link)
    expect(text(renderer!.root)).toContain('链接已复制')
  })
  it.each(['arkme_cn', 'studio'])('preserves owner approval and link actions when %s cannot be paused', async jotmoId => {
    channel = { ...channel, jotmoId, canPause: false, enabled: true, publicRef: 'a'.repeat(32), link: 'https://example.com/team-message?channel=' + 'a'.repeat(32) }
    const original = mocks.call.getMockImplementation()!
    mocks.call.mockImplementation(async (op, p) => op === 'team.app.applications'
      ? { items: [{ ref: 'application', name: '申请人甲', state: 'pending', requestedAt: 1 }], hasMore: false }
      : op === 'team.app.application.decide' ? {} : original(op, p))
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await mount()
    expect(renderer!.root.findAllByProps({ role: 'switch' })).toHaveLength(0)
    expect(text(renderer!.root)).toContain('申请人甲')
    await click(button('同意')); await click(button('确认'))
    expect(mocks.call).toHaveBeenCalledWith('team.app.application.decide', { applicationRef: 'application', approve: true }, expect.any(AbortSignal))
    await click(button('复制链接'))
    expect(writeText).toHaveBeenCalledWith(channel.link)
    await click(button('重置链接')); await click(button('确认'))
    expect(mocks.call).toHaveBeenCalledWith('team.app.channel.configure', { teamRef: 'team', revision: 1, enabled: true, rotate: true }, expect.any(AbortSignal))
    expect(channel.enabled).toBe(true)
    expect(renderer!.root.findAllByProps({ role: 'switch' })).toHaveLength(0)
  })
  it.each([true, undefined])('allows owners to pause with current or legacy capability: %s', async canPause => {
    channel = { ...channel, ...(canPause === undefined ? {} : { canPause }), enabled: true, publicRef: 'a'.repeat(32) }
    await mount()
    await click(renderer!.root.findByProps({ role: 'switch' }))
    expect(mocks.call).toHaveBeenCalledWith('team.app.channel.configure', { teamRef: 'team', revision: 1, enabled: false, rotate: false }, expect.any(AbortSignal))
  })
  it('offers retry after a failed initial load without a permanent refresh action', async () => {
    mocks.call.mockRejectedValueOnce(new Error('暂时无法读取'))
    await mount()
    expect(text(renderer!.root.findByProps({ role: 'alert' }))).toContain('暂时无法读取')
    await click(button('重试'))
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    expect(button('重试')).toBeUndefined()
    expect(renderer!.root.findByProps({ role: 'switch' }).props['aria-checked']).toBe(false)
    expect(mocks.call.mock.calls.every(v => v[0] !== 'team.app.channel.configure')).toBe(true)
  })
  it('groups link actions and confirms reset while preserving the paused state', async () => {
    channel = { ...channel, publicRef: 'a'.repeat(32), link: 'https://example.com/team-message?channel=' + 'a'.repeat(32) }
    await mount()
    const card = renderer!.root.findByProps({ className: 'team-channel-card' })
    expect(card.findAllByType('button').map(text)).toContain('复制链接')
    expect(card.findAllByType('button').map(text)).not.toContain('重置链接')
    const linkRow = card.findByProps({className: 'team-channel-link-row'})
    const actions = linkRow.findAllByType('button')
    expect(actions.map(node => node.props['aria-label'] || text(node))).toEqual(['复制链接', '重置链接'])
    expect(text(card)).not.toContain('消息链接')
    expect(text(card)).toContain('外部用户可通过链接发消息')
    expect(button('重置链接').props.title).toBe('重置链接')
    await click(button('重置链接'))
    expect(text(renderer!.root.findByProps({ role: 'alert' }))).toContain('重置后旧链接失效，已存在的会话继续保留')
    expect(mocks.call.mock.calls.some(v => v[0] === 'team.app.channel.configure')).toBe(false)
    await click(button('取消'))
    expect(changed).not.toHaveBeenCalled()
    await click(button('重置链接')); await click(button('确认'))
    expect(mocks.call).toHaveBeenCalledWith('team.app.channel.configure', { teamRef: 'team', revision: 1, enabled: false, rotate: true }, expect.any(AbortSignal))
    expect(renderer!.root.findByProps({ role: 'switch' }).props['aria-checked']).toBe(false)
    expect(changed).toHaveBeenCalledOnce()
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
