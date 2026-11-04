import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PublicGroup, PublicPerson } from '../src/public-social-contract.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async () => ({ ...await vi.importActual('../src/client/api.js'), callArkme: mocks.call }))
import { PublicSocialDirectory } from '../src/client/PublicSocialDirectory.js'
import { PublicPersonListingDialog, PublicGroupSettingsDialog } from '../src/client/PublicSocialDialogs.js'
import { ArkmeConfirmDialog } from '../src/client/ArkmeConfirmDialog.js'
import { ArkmeGroupCreateDialog } from '../src/client/ArkmeQuickAdd.js'
import { ArkmeWorldSurface } from '../src/client/ArkmeWorldSurface.js'
import { PublicGroupJoinRequests } from '../src/client/PublicGroupJoinRequests.js'

const group: PublicGroup = { chatSessionUid: 'group-a', title: '产品交流', introduction: '一起聊产品', ownerUserId: 1002, hasJoined: false, joinMode: 1 }
const person: PublicPerson = { userId: 1001, isListed: true, displayName: '公开昵称', avatarUrl: '', introduction: '原介绍' }
const source = { sourceRef: 'signed-group', kind: 'group_chat', displayName: group.title }
let renderer: ReactTestRenderer | undefined
const buttons = () => renderer!.root.findAllByType('button')
const button = (text: string) => buttons().find(b => b.children.includes(text))!
afterEach(async () => { await act(async () => { renderer?.unmount() }); renderer = undefined; vi.clearAllMocks() })

describe('desktop public social interactions', () => {
  it('opens public directories from World and returns to the existing personal feed', async () => {
    mocks.call.mockImplementation(async (op: string) => op === 'social.groups.query' ? { items: [group], hasMore: false } : op === 'social.people.read' ? person : { items: [], hasMore: false })
    await act(async () => { renderer = create(<ArkmeWorldSurface accountScope="test:1001" currentUserId={1001} />) })
    await act(async () => button('公开群聊').props.onClick())
    expect(renderer!.root.findByType(PublicSocialDirectory).props.mode).toBe('groups')
    await act(async () => button('找人聊聊').props.onClick())
    expect(renderer!.root.findAllByType(PublicSocialDirectory).map(view => view.props.mode)).toEqual(['groups', 'people'])
    await act(async () => button('我的世界').props.onClick())
    expect(renderer!.root.findAllByType(PublicSocialDirectory)).toHaveLength(2)
    expect(mocks.call.mock.calls.filter(([op, input]) => op === 'social.groups.query' && !input.userId)).toHaveLength(1)
    expect(mocks.call).toHaveBeenCalledWith('world.mine', expect.any(Object), expect.any(AbortSignal))
    await act(async () => button('查看全部').props.onClick())
    expect(renderer!.root.findByType(PublicSocialDirectory).props.profileUserId).toBe(1001)
  })
  it('retains directory searches, selections and feed data across all four tabs', async () => {
    mocks.call.mockImplementation(async (op: string) => op === 'social.groups.query' ? { items: [group], hasMore: false } : op === 'social.people.query' ? { items: [person], hasMore: false } : op === 'social.people.read' ? person : { items: [], hasMore: false })
    await act(async () => { renderer = create(<ArkmeWorldSurface accountScope="test:1001" currentUserId={1001} />) })
    await act(async () => button('公开群聊').props.onClick())
    const directory = renderer!.root.findByType(PublicSocialDirectory)
    await act(async () => directory.findByType('input').props.onChange({ currentTarget: { value: '产品' } }))
    await act(async () => directory.findByType('form').props.onSubmit({ preventDefault() {} }))
    const reads = mocks.call.mock.calls.filter(([op, input]) => op === 'social.groups.query' && !input.userId).length
    await act(async () => button('找人聊聊').props.onClick())
    await act(async () => button('我的世界').props.onClick())
    await act(async () => button('世界').props.onClick())
    await act(async () => button('公开群聊').props.onClick())
    expect(renderer!.root.findAllByType(PublicSocialDirectory)[0]!.findByType('input').props.value).toBe('产品')
    expect(mocks.call.mock.calls.filter(([op, input]) => op === 'social.groups.query' && !input.userId)).toHaveLength(reads)
    expect(mocks.call.mock.calls.filter(([op]) => op === 'world.feed')).toHaveLength(1)
    expect(renderer!.root.findAllByType('h1').map(heading => heading.children.join(''))).toEqual(['世界'])
    expect(renderer!.root.findAllByType('nav').filter(nav => nav.props['aria-label'] === '世界范围')).toHaveLength(1)
    expect(button('公开群聊').props['aria-current']).toBe('page')
    expect(button('世界').props['aria-current']).toBeUndefined()
  })
  it('cancels optional author decoration when its feed is left', async () => {
    mocks.call.mockImplementation(async (op: string) => op === 'world.feed' ? { items: [{ recordRef: 'post', authorRef: 'author', authorName: '公开昵称', headline: '', textContent: '正文', tags: [], templateKind: 0, imageRefs: [], imageCount: 0, videoCount: 0, voiceCount: 0, extendCount: 0 }], hasMore: false } : op === 'world.author-labels' ? new Promise(() => {}) : { items: [], hasMore: false })
    await act(async () => { renderer = create(<ArkmeWorldSurface accountScope="test:1001" currentUserId={1001} />) })
    const signal = mocks.call.mock.calls.find(([op]) => op === 'world.author-labels')![2] as AbortSignal
    expect(signal.aborted).toBe(false)
    await act(async () => button('公开群聊').props.onClick())
    expect(signal.aborted).toBe(true)
  })
  it('prevents duplicate joins and reuses the request identity after an uncertain failure', async () => {
    let reject!: (error: Error) => void
    const activated = vi.fn()
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'social.groups.query') return { items: [group], hasMore: false }
      return await new Promise((_, fail) => { reject = fail })
    })
    await act(async () => { renderer = create(<PublicSocialDirectory accountScope="test:1001" mode="groups" onSourceActivated={activated} />) })
    await act(async () => { button('加入群聊').props.onClick(); button('加入群聊').props.onClick() })
    const joins = () => mocks.call.mock.calls.filter(c => c[0] === 'social.groups.join')
    expect(joins()).toHaveLength(1)
    const requestUid = joins()[0]![1].requestUid
    await act(async () => reject(new Error('网络中断，结果待确认')))
    expect(JSON.stringify(renderer!.toJSON())).toContain('网络中断，结果待确认')
    mocks.call.mockResolvedValueOnce({ status: 'joined', group: { ...group, hasJoined: true }, source })
    await act(async () => button('加入群聊').props.onClick())
    expect(joins()[1]![1].requestUid).toBe(requestUid); expect(activated).toHaveBeenCalledWith(source)
  })
  it('retains a pending join result without navigating away from the newly selected tab', async () => {
    let finish!: (value: unknown) => void
    const activated = vi.fn()
    mocks.call.mockImplementation(async (op: string) => op === 'social.groups.query' ? { items: [group], hasMore: false } : new Promise(resolve => { finish = resolve }))
    await act(async () => { renderer = create(<PublicSocialDirectory accountScope="test:1001" mode="groups" onSourceActivated={activated} />) })
    await act(async () => button('加入群聊').props.onClick())
    await act(async () => renderer!.update(<PublicSocialDirectory active={false} accountScope="test:1001" mode="groups" onSourceActivated={activated} />))
    await act(async () => finish({ status: 'joined', group: { ...group, hasJoined: true }, source }))
    expect(activated).not.toHaveBeenCalled()
    expect(button('打开群聊')).toBeDefined()
  })
  it('refreshes approval state and completes the original approved request', async () => {
    let approved = false
    mocks.call.mockImplementation(async (op: string) => op === 'social.groups.query' ? { items: [{ ...group, joinMode: 2, joinRequest: { requestUid: 'original-request', status: approved ? 2 : 1 } }], hasMore: false } : { status: 'joined', group: { ...group, hasJoined: true }, source })
    await act(async () => { renderer = create(<PublicSocialDirectory accountScope="test:1001" mode="groups" onSourceActivated={vi.fn()} />) })
    expect(button('等待审批').props.disabled).toBe(true)
    approved = true
    await act(async () => button('刷新').props.onClick())
    await act(async () => button('进入群聊').props.onClick())
    expect(mocks.call).toHaveBeenCalledWith('social.groups.join', expect.objectContaining({ requestUid: 'original-request' }), expect.any(AbortSignal))
  })
  it('keeps an in-flight admission alive while searching the directory', async () => {
    let finish!: (value: unknown) => void
    mocks.call.mockImplementation(async (op: string) => op === 'social.groups.query' ? { items: [group], hasMore: false } : await new Promise(resolve => { finish = resolve }))
    await act(async () => { renderer = create(<PublicSocialDirectory accountScope="test:1001" mode="groups" />) })
    await act(async () => button('加入群聊').props.onClick())
    const signal = mocks.call.mock.calls.find(c => c[0] === 'social.groups.join')![2] as AbortSignal
    await act(async () => renderer!.root.findByType('input').props.onChange({ currentTarget: { value: '产品' } }))
    await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(signal.aborted).toBe(false)
    await act(async () => finish({ status: 'pending', group: { ...group, joinMode: 2, joinRequest: { requestUid: 'request', status: 1 } } }))
    expect(button('等待审批').props.disabled).toBe(true)
    expect(button('刷新').props.disabled).toBe(false)
  })
  it('opens an existing membership without submitting another join request', async () => {
    const activated = vi.fn()
    mocks.call.mockImplementation(async (op: string) => op === 'social.groups.query' ? { items: [{ ...group, hasJoined: true }], hasMore: false } : source)
    await act(async () => { renderer = create(<PublicSocialDirectory accountScope="test:1001" mode="groups" onSourceActivated={activated} />) })
    await act(async () => button('打开群聊').props.onClick())
    expect(mocks.call).toHaveBeenCalledWith('social.groups.open', { accountScope: 'test:1001', chatSessionUid: group.chatSessionUid }, expect.any(AbortSignal))
    expect(mocks.call.mock.calls.some(c => c[0] === 'social.groups.join')).toBe(false)
    expect(activated).toHaveBeenCalledWith(source)
  })
  it('does not apply an old account response', async () => {
    let finish!: (value: unknown) => void
    mocks.call.mockImplementation(async (_op: string, input: { accountScope: string }) => input.accountScope === 'test:1001' ? await new Promise(resolve => { finish = resolve }) : { items: [], hasMore: false })
    await act(async () => { renderer = create(<PublicSocialDirectory accountScope="test:1001" mode="groups" />) })
    const oldSignal = mocks.call.mock.calls[0]![2] as AbortSignal
    await act(async () => renderer!.update(<PublicSocialDirectory accountScope="test:1002" mode="groups" />))
    await act(async () => finish({ items: [group], hasMore: false }))
    expect(oldSignal.aborted).toBe(true); expect(JSON.stringify(renderer!.toJSON())).not.toContain('产品交流')
  })
  it('keeps edited introductions after save failure and confirms unlisting from the server', async () => {
    const saved = vi.fn(), close = vi.fn()
    mocks.call.mockResolvedValueOnce(person)
    await act(async () => { renderer = create(<PublicPersonListingDialog accountScope="test:1001" onSaved={saved} onClose={close} />) })
    await act(async () => renderer!.root.findByType('textarea').props.onChange({ currentTarget: { value: '想交流硬件' } }))
    mocks.call.mockRejectedValueOnce(new Error('保存失败'))
    await act(async () => renderer!.root.findByType(ArkmeConfirmDialog).props.onConfirm())
    expect(renderer!.root.findByType('textarea').props.value).toBe('想交流硬件')
    expect(renderer!.root.findByType(ArkmeConfirmDialog).props.error).toBe('保存失败')
    mocks.call.mockResolvedValueOnce({ ...person, isListed: false })
    await act(async () => button('下架我的展示').props.onClick())
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ isListed: false })); expect(close).toHaveBeenCalledOnce()
  })
  it('offers member-controlled showcase without an owner visibility switch', async () => {
    mocks.call.mockResolvedValueOnce({ chatSessionUid: 'group-a', isPublic: true, isShown: false, introduction: '介绍', canManage: false })
    await act(async () => { renderer = create(<PublicGroupSettingsDialog accountScope="test:1001" sourceRef="signed-group" onClose={vi.fn()} />) })
    expect(renderer!.root.findAllByType('input')).toHaveLength(1)
    await act(async () => renderer!.root.findByType('input').props.onChange({ currentTarget: { checked: true } }))
    mocks.call.mockResolvedValueOnce({ chatSessionUid: 'group-a', isPublic: true, isShown: true, introduction: '介绍', canManage: false })
    await act(async () => renderer!.root.findByType(ArkmeConfirmDialog).props.onConfirm())
    expect(mocks.call).toHaveBeenCalledWith('social.groups.showcase.set', expect.objectContaining({ isShown: true }), expect.any(AbortSignal))
  })
  it('preserves creation draft while browsing and sends explicit private visibility', async () => {
    mocks.call.mockResolvedValue({ items: [], hasMore: false })
    await act(async () => { renderer = create(<ArkmeGroupCreateDialog accountScope="test:1001" onClose={vi.fn()} onSourceCreated={vi.fn()} />) })
    const name = () => renderer!.root.findAllByType('input').find(n => n.props.type !== 'checkbox')!
    await act(async () => { name().props.onChange({ target: { value: '硬件交流' } }); renderer!.root.findByType('textarea').props.onChange({ currentTarget: { value: '聊聊硬件' } }) })
    await act(async () => button('浏览公开群聊').props.onClick())
    await act(async () => button('返回创建群聊').props.onClick())
    expect(name().props.value).toBe('硬件交流'); expect(renderer!.root.findByType('textarea').props.value).toBe('聊聊硬件')
    await act(async () => renderer!.root.findAllByType('input').find(n => n.props.type === 'checkbox')!.props.onChange({ currentTarget: { checked: false } }))
    mocks.call.mockResolvedValueOnce(source)
    await act(async () => button('确认').props.onClick())
    expect(mocks.call).toHaveBeenCalledWith('group.create', expect.objectContaining({ title: '硬件交流', introduction: '聊聊硬件', isPublic: false, accountScope: 'test:1001', clientMutationId: expect.any(String) }))
  })
})


it('uses a fresh admission identity after a completed membership is removed', async()=>{
 let member=false, removed=false
 mocks.call.mockImplementation(async(op:string)=>{
  if(op==='social.groups.query')return {items:[{...group,joinMode:2,hasJoined:member,joinRequest:removed?undefined:{requestUid:'old-approved-request',status:2}}],hasMore:false}
  member=true;return {status:'joined',group:{...group,hasJoined:true},source}
 })
 await act(async()=>{renderer=create(<PublicSocialDirectory accountScope="test:1001" mode="groups"/>)})
 await act(async()=>button('进入群聊').props.onClick())
 member=false;removed=true
 await act(async()=>button('刷新').props.onClick())
 await act(async()=>button('申请加入').props.onClick())
 const calls=mocks.call.mock.calls.filter(c=>c[0]==='social.groups.join')
 expect(calls[0]![1].requestUid).toBe('old-approved-request')
 expect(calls[1]![1].requestUid).not.toBe('old-approved-request')
})
it('allows direct admission when a former pending request remains in a stale UI snapshot', async()=>{
 mocks.call.mockImplementation(async(op:string)=>op==='social.groups.query'?{items:[{...group,joinRequest:{requestUid:'pending',status:1}}],hasMore:false}:{status:'joined',group:{...group,hasJoined:true},source})
 await act(async()=>{renderer=create(<PublicSocialDirectory accountScope="test:1001" mode="groups"/>)})
 expect(button('加入群聊').props.disabled).toBe(false)
 await act(async()=>button('加入群聊').props.onClick())
 expect(mocks.call.mock.calls.some(c=>c[0]==='social.groups.join')).toBe(true)
})

it('finishes a pending refresh before allowing approval so a stale list cannot restore the processed row', async () => {
  const page = { items: [{ requestRef: 'opaque-request', displayName: '公开昵称', status: 1, requestAt: 1 }], hasMore: false }
  let finishRefresh!: (value: typeof page) => void
  mocks.call.mockResolvedValueOnce(page).mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve })).mockResolvedValue({ status: 2 })
  await act(async () => { renderer = create(<PublicGroupJoinRequests accountScope="test:1001" sourceRef="group-source" disabled={false} onBusyChange={() => {}} />) })
  await act(async () => button('刷新申请').props.onClick())
  expect(button('同意').props.disabled).toBe(true)
  await act(async () => button('同意').props.onClick())
  expect(mocks.call.mock.calls.some(c => c[0] === 'social.groups.requests.resolve')).toBe(false)
  await act(async () => finishRefresh(page))
  expect(button('同意').props.disabled).toBe(false)
  await act(async () => button('同意').props.onClick())
  expect(renderer!.root.findAllByType('article')).toHaveLength(0)
  expect(mocks.call).toHaveBeenCalledWith('social.groups.requests.resolve', expect.objectContaining({ requestRef: 'opaque-request', approved: true }), expect.any(AbortSignal))
})
