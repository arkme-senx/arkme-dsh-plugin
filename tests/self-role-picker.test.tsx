import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeSelfRole } from '../src/types.js'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/ArkmeAvatar.js', () => ({
  ArkmeUserAvatar: ({ avatarRef }: { avatarRef?: string }) => <span data-avatar-ref={avatarRef} />,
}))
vi.mock('../src/client/ArkmeExtensionAvatarCropDialog.js', () => ({
  ArkmeExtensionAvatarCropDialog: ({ onConfirm }: { onConfirm(file: File): void }) =>
    <button type="button" aria-label="确认测试裁剪" onClick={() => onConfirm(new File(['image'], 'role.png', { type: 'image/png' }))} />,
}))

import { ArkmeActionMenu } from '../src/client/ArkmeDshMenu.js'
import { ArkmeSelfRolePicker } from '../src/client/ArkmeSelfRolePicker.js'

const role: ArkmeSelfRole = {
  roleId: 'r1', name: '理性我', avatarRef: 'file_asset://abcdefgh', createdAtMillis: 1, updatedAtMillis: 1,
}
let renderer: ReactTestRenderer | undefined

function menu() {
  return renderer!.root.findByType(ArkmeActionMenu)
}
function trigger() {
  return renderer!.root.findByProps({ 'data-arkme-self-role-trigger': 'true' })
}
function action(id: string) {
  return menu().props.actions.find((entry: { id: string }) => entry.id === id)
}

beforeEach(() => { mocks.call.mockReset() })
afterEach(async () => {
  await act(async () => { renderer?.unmount() })
  renderer = undefined
  vi.unstubAllGlobals()
})

describe('self role picker', () => {
  it('offers the current self and saved roles, then reports each selection to its owner', async () => {
    const onSelect = vi.fn()
    mocks.call.mockResolvedValue([role])
    await act(async () => { renderer = create(<ArkmeSelfRolePicker accountKey="test:42" userId={42} selfAvatarRef="self-avatar" onSelect={onSelect} />) })
    expect(trigger().props['data-arkme-self-role-id']).toBe('me')
    expect(trigger().findByProps({ 'data-avatar-ref': 'self-avatar' })).toBeDefined()
    await act(async () => { trigger().props.onClick() })
    expect(menu().props.side).toBe('top')
    expect(menu().props.selectedIds).toEqual(['me'])
    expect(menu().props.actions.some((entry: { text?: string }) => entry.text === '角色资料和头像会自动同步')).toBe(true)
    await act(async () => { action('role:r1').onSelect() })
    expect(onSelect).toHaveBeenLastCalledWith(role)
    await act(async () => { renderer!.update(<ArkmeSelfRolePicker accountKey="test:42" userId={42} selectedRole={role} selfAvatarRef="self-avatar" onSelect={onSelect} />) })
    expect(trigger().props['aria-label']).toBe('当前发言角色：理性我')
    expect(trigger().props['data-arkme-self-role-id']).toBe('r1')
    await act(async () => { trigger().props.onClick(); action('me').onSelect() })
    expect(onSelect).toHaveBeenLastCalledWith(undefined)
  })

  it('creates and selects a named role with the account-bound operation', async () => {
    const onSelect = vi.fn()
    mocks.call.mockImplementation(async (operation: string) => operation === 'self-roles.list' ? [] : role)
    await act(async () => { renderer = create(<ArkmeSelfRolePicker accountKey="test:42" userId={42} onSelect={onSelect} />) })
    await act(async () => { trigger().props.onClick(); action('role-create').onSelect() })
    expect(JSON.stringify(renderer!.toJSON())).toContain('角色资料和头像会同步到其他设备；离线修改会在联网后继续同步。')
    const name = renderer!.root.findByProps({ 'aria-label': '角色名称' })
    await act(async () => { name.props.onChange({ currentTarget: { value: '  理性我  ' } }) })
    await act(async () => { renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(mocks.call).toHaveBeenCalledWith('self-roles.create', { expectedUserId: 42, name: '理性我' }, expect.any(AbortSignal))
    expect(onSelect).toHaveBeenCalledWith(role)
    expect(renderer!.root.findAllByProps({ 'aria-label': '创建发言角色' })).toHaveLength(0)
  })

  it('edits and clears an existing avatar without changing the role identity', async () => {
    const onSelect=vi.fn()
    mocks.call.mockImplementation(async(operation:string)=>operation==='self-roles.list'?[role]:{...role,name:'新名字',avatarRef:''})
    await act(async()=>{renderer=create(<ArkmeSelfRolePicker accountKey="test:42" userId={42} selectedRole={role} onSelect={onSelect}/> )})
    await act(async()=>{trigger().props.onClick();action('role-edit').onSelect()})
    await act(async()=>{renderer!.root.findByProps({'aria-label':'角色名称'}).props.onChange({currentTarget:{value:'新名字'}})})
    await act(async()=>{renderer!.root.findAllByType('button').find(button=>button.props.children==='移除头像')!.props.onClick()})
    await act(async()=>{renderer!.root.findByType('form').props.onSubmit({preventDefault(){}})})
    expect(mocks.call).toHaveBeenCalledWith('self-roles.update',{expectedUserId:42,roleId:'r1',name:'新名字',avatarRef:''},expect.any(AbortSignal))
  })

  it('stores a cropped avatar locally before creating the role', async () => {
    const onSelect = vi.fn()
    mocks.call.mockImplementation(async (operation: string) => operation === 'self-roles.list' ? [] : role)
    const saveAvatar = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, value: { avatarRef: 'arkme-self-role-image-v1.abcdefgh' } }) })
    vi.stubGlobal('fetch', saveAvatar)
    await act(async () => { renderer = create(<ArkmeSelfRolePicker accountKey="test:42" userId={42} onSelect={onSelect} />) })
    await act(async () => { trigger().props.onClick(); action('role-create').onSelect() })
    const picker = renderer!.root.findByProps({ type: 'file', hidden: true })
    await act(async () => { picker.props.onChange({ currentTarget: { files: [new File(['source'], 'source.png', { type: 'image/png' })], value: 'source.png' } }) })
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '确认测试裁剪' }).props.onClick() })
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '角色名称' }).props.onChange({ currentTarget: { value: '理性我' } }) })
    await act(async () => { renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(saveAvatar).toHaveBeenCalledWith('/arkme-self/api/self-role-avatar', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ 'X-Arkme-Expected-User-Id': '42' }),
    }))
    expect(mocks.call).toHaveBeenCalledWith('self-roles.create', {
      expectedUserId: 42, name: '理性我', avatarRef: 'arkme-self-role-image-v1.abcdefgh',
    }, expect.any(AbortSignal))
  })

  it('keeps creation open when local avatar saving fails', async () => {
    mocks.call.mockImplementation(async (operation: string) => operation === 'self-roles.list' ? [] : role)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false, error: { message: '本机头像保存失败' } }) }))
    await act(async () => { renderer = create(<ArkmeSelfRolePicker accountKey="test:42" userId={42} onSelect={vi.fn()} />) })
    await act(async () => { trigger().props.onClick(); action('role-create').onSelect() })
    await act(async () => { renderer!.root.findByProps({ type: 'file', hidden: true }).props.onChange({
      currentTarget: { files: [new File(['source'], 'source.png', { type: 'image/png' })], value: 'source.png' },
    }) })
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '确认测试裁剪' }).props.onClick() })
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '角色名称' }).props.onChange({ currentTarget: { value: '理性我' } }) })
    await act(async () => { renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(JSON.stringify(renderer!.toJSON())).toContain('本机头像保存失败')
    expect(renderer!.root.findAllByProps({ 'aria-label': '创建发言角色' })).toHaveLength(1)
    expect(mocks.call.mock.calls.some(([operation]) => operation === 'self-roles.create')).toBe(false)
  })

  it('ignores a previous account’s late list response', async () => {
    let finishOld!: (roles: ArkmeSelfRole[]) => void
    const oldResponse = new Promise<ArkmeSelfRole[]>(resolve => { finishOld = resolve })
    mocks.call.mockImplementation(async (_operation: string, params: { expectedUserId: number }) =>
      params.expectedUserId === 42 ? await oldResponse : [])
    const onSelect = vi.fn()
    await act(async () => { renderer = create(<ArkmeSelfRolePicker accountKey="test:42" userId={42} onSelect={onSelect} />) })
    await act(async () => { renderer!.update(<ArkmeSelfRolePicker accountKey="test:43" userId={43} onSelect={onSelect} />) })
    await act(async () => { finishOld([role]) })
    await act(async () => { trigger().props.onClick() })
    expect(menu().props.actions.some((entry: { id: string }) => entry.id === 'role:r1')).toBe(false)
    expect(mocks.call).toHaveBeenCalledWith('self-roles.list', { expectedUserId: 43 }, expect.any(AbortSignal))
  })

  it('keeps creation unavailable after a read error until retry succeeds', async () => {
    mocks.call.mockRejectedValueOnce(new Error('本地角色暂不可用')).mockResolvedValue([role])
    const onSelect = vi.fn()
    await act(async () => { renderer = create(<ArkmeSelfRolePicker accountKey="test:42" userId={42} onSelect={onSelect} />) })
    expect(action('role-create').disabled).toBe(true)
    expect(menu().props.actions.some((entry: { text?: string }) => entry.text === '加载失败：本地角色暂不可用')).toBe(true)
    await act(async () => { action('role-retry').onSelect() })
    expect(action('role-create').disabled).toBe(false)
    expect(action('role:r1').label).toBe('理性我')
  })
})
