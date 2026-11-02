import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeConfirmDialog } from '../src/client/ArkmeConfirmDialog.js'
import type { ArkmeSourceItem } from '../src/types.js'
const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async () => ({ ...await vi.importActual('../src/client/api.js'), callArkme: api.call }))
import { PrivateGroupCreateDialog } from '../src/client/PrivateGroupCreateDialog.js'
const source: ArkmeSourceItem = { sourceRef: 'private-ref', kind: 'private_chat', displayName: '小王', peerUserId: 1002, unreadCount: 0, activeAtMillis: 0 }
const created: ArkmeSourceItem = { sourceRef: 'new-group', kind: 'group_chat', displayName: '新群', unreadCount: 0, activeAtMillis: 0 }
const people = [{ personRef: 'person-3', displayName: '小陈', searchText: '小陈 chen' }, { personRef: 'person-4', displayName: '小李', searchText: '小李 li' }]
const exact = { source: { ...created, sourceRef: 'existing-group', displayName: '三人讨论' }, kind: 'exact', memberCount: 3, extraCount: 0 }
let renderer: ReactTestRenderer | undefined
const form = () => renderer!.root.findByType(ArkmeConfirmDialog)
const button = (label: string) => renderer!.root.findAllByType('button').find(node => node.children.includes(label))!
const render = async (onCreated = vi.fn(), account = 'test:1001') => {
  await act(async () => { renderer = create(<PrivateGroupCreateDialog source={source} accountScope={account} onClose={vi.fn()} onCreated={onCreated} />) })
}
const choose = async (name = '小陈') => {
  await act(async () => renderer!.root.findByProps({ 'aria-label': `选择成员：${name}` }).props.onClick())
  await act(async () => { await vi.advanceTimersByTimeAsync(200) })
}
beforeEach(() => {
  vi.useFakeTimers()
  api.call.mockImplementation(async (op: string) => op === 'group.private.context' ? { peerName: '小王' } : op === 'group.private.people' ? { items: people, hasMore: false, incomplete: false } : op === 'group.private.matches' ? [] : { status: 'created', source: created })
})
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); api.call.mockReset() })

describe('private-chat quick group dialog', () => {
  it('includes the two fixed people and creates once with selected opaque references', async () => {
    const activated = vi.fn()
    await render(activated)
    expect(form().props.confirmDisabled).toBe(true)
    expect(JSON.stringify(renderer!.toJSON())).toContain('小王')
    await choose()
    expect(form().props.confirmDisabled).toBe(false)
    await act(async () => { form().props.onConfirm(); form().props.onConfirm() })
    const calls = api.call.mock.calls.filter(([op]) => op === 'group.private.create')
    expect(calls).toHaveLength(1)
    expect(calls[0]![1]).toMatchObject({ sourceRef: 'private-ref', personRefs: ['person-3'], title: '小王、小陈', isPublic: true, allowDuplicate: false, allowUnchecked: false })
    expect(activated).toHaveBeenCalledWith(created)
  })
  it('opens a matching group without creating and labels supersets separately', async () => {
    const activated = vi.fn(), normal = api.call.getMockImplementation()!
    api.call.mockImplementation(async (op, params, signal) => op === 'group.private.matches' ? [exact, { ...exact, source: { ...exact.source, sourceRef: 'larger', displayName: '四人讨论' }, kind: 'includes', memberCount: 4, extraCount: 1 }] : normal(op, params, signal))
    await render(activated); await choose()
    const text = JSON.stringify(renderer!.toJSON())
    expect(text).toContain('成员完全相同 · 3 人'); expect(text).toContain('包含全部已选成员，另有 1 人')
    expect(form().props.confirmLabel).toBe('仍然新建群聊')
    await act(async () => button('打开群聊').props.onClick())
    expect(activated).toHaveBeenCalledWith(exact.source)
    expect(api.call.mock.calls.some(([op]) => op === 'group.private.create')).toBe(false)
  })
  it('stops for a match that appears during submission until the user explicitly creates another', async () => {
    const activated = vi.fn(), normal = api.call.getMockImplementation()!
    let writes = 0
    api.call.mockImplementation(async (op, params, signal) => op === 'group.private.create' && writes++ === 0 ? { status: 'matches', matches: [exact] } : normal(op, params, signal))
    await render(activated); await choose()
    await act(async () => form().props.onConfirm())
    expect(activated).not.toHaveBeenCalled(); expect(form().props.confirmLabel).toBe('仍然新建群聊')
    expect(api.call.mock.calls.filter(([op]) => op === 'group.private.create')).toHaveLength(1)
    await act(async () => form().props.onConfirm())
    expect(api.call.mock.calls.filter(([op]) => op === 'group.private.create')[1]![1]).toMatchObject({ allowDuplicate: true })
    expect(activated).toHaveBeenCalledWith(created)
  })
  it('shows check failures without claiming absence and requires an explicit unchecked action', async () => {
    const normal = api.call.getMockImplementation()!
    api.call.mockImplementation(async (op, params, signal) => { if (op === 'group.private.matches') throw new Error('网络中断'); return normal(op, params, signal) })
    await render(); await choose()
    const text = JSON.stringify(renderer!.toJSON())
    expect(text).toContain('已有群聊尚未检查完整'); expect(text).not.toContain('未找到包含全部已选成员')
    expect(form().props.confirmLabel).toBe('仍然创建群聊')
    await act(async () => form().props.onConfirm())
    expect(api.call.mock.calls.find(([op]) => op === 'group.private.create')![1]).toMatchObject({ allowUnchecked: true })
  })
  it('offers explicit unchecked creation if the final check fails after a successful preview', async () => {
    const normal = api.call.getMockImplementation()!
    let first = true
    api.call.mockImplementation(async (op, params, signal) => {
      if (op === 'group.private.create' && first) { first = false; throw Object.assign(new Error('检查网络中断'), { body: { code: 'private-group-check-failed' } }) }
      return normal(op, params, signal)
    })
    await render(); await choose()
    await act(async () => form().props.onConfirm())
    expect(form().props.confirmLabel).toBe('仍然创建群聊')
    expect(JSON.stringify(renderer!.toJSON())).toContain('已有群聊尚未检查完整')
    await act(async () => form().props.onConfirm())
    const calls = api.call.mock.calls.filter(([op]) => op === 'group.private.create')
    expect(calls[1]![1]).toMatchObject({ allowUnchecked: true })
    expect(calls[1]![1].clientMutationId).toBe(calls[0]![1].clientMutationId)
  })
  it('discards an old selection check after adding another person', async () => {
    const normal = api.call.getMockImplementation()!
    let finish!: (value: unknown) => void
    api.call.mockImplementation(async (op, params, signal) => op === 'group.private.matches' && params.personRefs.length === 1 ? await new Promise(resolve => { finish = resolve }) : normal(op, params, signal))
    await render(); await choose()
    const oldSignal = api.call.mock.calls.find(([op]) => op === 'group.private.matches')![2] as AbortSignal
    await choose('小李')
    await act(async () => finish([exact]))
    expect(oldSignal.aborted).toBe(true)
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('三人讨论')
    expect(form().props.confirmLabel).toBe('创建群聊')
  })
  it('freezes the payload and reuses its request ID after an uncertain creation', async () => {
    const normal = api.call.getMockImplementation()!
    let first = true
    api.call.mockImplementation(async (op, params, signal) => {
      if (op === 'group.private.create' && first) { first = false; throw Object.assign(new Error('创建结果未知'), { body: { code: 'group-create-outcome-unknown' } }) }
      return normal(op, params, signal)
    })
    await render(); await choose()
    await act(async () => form().props.onConfirm())
    expect(form().props.confirmLabel).toBe('重试确认创建结果')
    expect(renderer!.root.findByProps({ 'aria-label': '群聊名称' }).props.disabled).toBe(true)
    await act(async () => form().props.onConfirm())
    const calls = api.call.mock.calls.filter(([op]) => op === 'group.private.create')
    expect(calls).toHaveLength(2); expect(calls[1]![1]).toEqual(calls[0]![1])
  })
  it('resets selections and ignores in-flight checks when switching accounts', async () => {
    const normal = api.call.getMockImplementation()!
    let finish!: (value: unknown) => void
    api.call.mockImplementation(async (op, params, signal) => op === 'group.private.matches' ? await new Promise(resolve => { finish = resolve }) : normal(op, params, signal))
    await render(); await choose()
    const old = api.call.mock.calls.find(([op]) => op === 'group.private.matches')![2] as AbortSignal
    await act(async () => renderer!.update(<PrivateGroupCreateDialog source={source} accountScope="test:1004" onClose={vi.fn()} onCreated={vi.fn()} />))
    await act(async () => finish([exact]))
    expect(old.aborted).toBe(true); expect(form().props.confirmDisabled).toBe(true)
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('三人讨论')
  })
  it('allows explicit duplicate consent after an uncertain retry finds another group, preserving the request and members', async () => {
    const normal = api.call.getMockImplementation()!
    let writes = 0
    api.call.mockImplementation(async (op, params, signal) => {
      if (op === 'group.private.create') {
        if (writes++ === 0) throw Object.assign(new Error('创建结果未知'), { body: { code: 'group-create-outcome-unknown' } })
        if (writes === 2) return { status: 'matches', matches: [exact] }
      }
      return normal(op, params, signal)
    })
    await render(); await choose()
    await act(async () => form().props.onConfirm())
    await act(async () => form().props.onConfirm())
    expect(form().props.confirmLabel).toBe('仍然新建群聊')
    expect(renderer!.root.findByProps({ 'aria-label': '群聊名称' }).props.disabled).toBe(true)
    await act(async () => form().props.onConfirm())
    const calls = api.call.mock.calls.filter(([op]) => op === 'group.private.create')
    expect(calls).toHaveLength(3)
    expect(calls[2]![1]).toEqual({ ...calls[0]![1], allowDuplicate: true })
  })
})
