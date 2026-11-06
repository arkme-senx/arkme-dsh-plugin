import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PublicGroup, PublicGroupPage } from '../src/public-social-contract.js'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async () => ({ ...await vi.importActual('../src/client/api.js'), callArkme: mocks.call }))
import { PublicWorldGroups } from '../src/client/PublicSocialDirectory.js'

let renderer: ReactTestRenderer | undefined
const shelf = () => renderer!.root.findAllByType('section').filter(node => node.props['aria-label'] === '公开群聊')
const button = (label: string) => renderer!.root.findAllByType('button').find(node => node.children.includes(label))!
const group: PublicGroup = { chatSessionUid: 'group-a', title: '产品交流', introduction: '', ownerUserId: 1001, hasJoined: false, joinMode: 1 }
afterEach(async () => { await act(async () => { renderer?.unmount() }); renderer = undefined; vi.resetAllMocks() })

describe('public groups on a personal World', () => {
  it.each([1001, 1002])('leaves no loading or empty card for World owner %s', async userId => {
    let finish!: (page: PublicGroupPage) => void
    mocks.call.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await act(async () => { renderer = create(<PublicWorldGroups accountScope="test:1001" userId={userId} onOpen={vi.fn()} />) })
    expect(renderer!.toJSON()).toBeNull()
    await act(async () => finish({ items: [], hasMore: false }))
    expect(renderer!.toJSON()).toBeNull()
  })

  it('keeps group navigation and the complete directory available when groups exist', async () => {
    mocks.call.mockResolvedValue({ items: [group], hasMore: false })
    const open = vi.fn()
    await act(async () => { renderer = create(<PublicWorldGroups accountScope="test:1001" userId={1001} onOpen={open} />) })
    expect(shelf()).toHaveLength(1)
    await act(async () => button('产品交流').props.onClick())
    expect(open).toHaveBeenLastCalledWith('group-a')
    await act(async () => button('查看全部').props.onClick())
    expect(open).toHaveBeenLastCalledWith()
  })

  it.each([
    { accountScope: 'test:1001', userId: 1002 },
    { accountScope: 'test:2001', userId: 1001 },
  ])('ignores an old response after switching to $accountScope / $userId', async next => {
    let finish!: (page: PublicGroupPage) => void
    mocks.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValue({ items: [], hasMore: false })
    const open = vi.fn()
    await act(async () => { renderer = create(<PublicWorldGroups accountScope="test:1001" userId={1001} onOpen={open} />) })
    const signal = mocks.call.mock.calls[0]![2] as AbortSignal
    await act(async () => renderer!.update(<PublicWorldGroups {...next} onOpen={open} />))
    expect(signal.aborted).toBe(true)
    await act(async () => finish({ items: [group], hasMore: false }))
    expect(renderer!.toJSON()).toBeNull()
  })

  it('offers a compact retry on failure without showing an empty card', async () => {
    mocks.call.mockRejectedValueOnce(new Error('公开群聊读取失败')).mockResolvedValue({ items: [], hasMore: false })
    await act(async () => { renderer = create(<PublicWorldGroups accountScope="test:1001" userId={1001} onOpen={vi.fn()} />) })
    expect(shelf()).toHaveLength(0)
    expect(renderer!.root.findByProps({ role: 'alert' }).props['aria-label']).toBe('公开群聊读取失败')
    await act(async () => button('重试').props.onClick())
    expect(mocks.call).toHaveBeenCalledTimes(2)
    expect(renderer!.toJSON()).toBeNull()
  })
})
