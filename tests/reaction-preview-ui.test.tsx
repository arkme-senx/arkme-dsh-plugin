import { reactionNotifications } from '../src/client/reaction-notifications.js'
import { expressionIdentity, labelExpression } from '../src/client/reaction-expression.js'
import { ArkmeReactionPhrases } from '../src/client/ArkmeReactionPhrases.js'
import { reactionLibrary } from '../src/client/reaction-library.js'
import { ArkmeReactionActorCard } from '../src/client/ArkmeReactionActorCard.js'
import { arkmeDefaultEmojis } from '../src/client/arkme-emoji.js'
import { act, create } from 'react-test-renderer'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { ArkmeReactionPreview, ArkmeReactionSelections, reactionToolbarPosition, reactionPanelPosition } from '../src/client/ArkmeReactionPreview.js'
import { reactionPreview } from '../src/client/reaction-preview-store.js'

import { reactionFixture } from './reaction-fixture.js'
vi.mock('../src/client/api.js', async importOriginal => ({ ...await importOriginal<object>(), callArkme: (operation: string, input: never) => operation === 'user.card' ? Promise.resolve({ displayName: '小陈' }) : reactionFixture.call(operation, input) }))
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }))

beforeEach(() => {
  reactionFixture.reset()
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) })
})

afterEach(async () => { reactionPreview.setScope(undefined); vi.unstubAllGlobals() })
describe('reaction review UI', () => {
  it('does not substitute the current profile for another actor whose real name is 我', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    reactionPreview.setScope('test:1')
    const actor = { userId: 2, displayName: '我', avatarRef: 'other-avatar' }
    const snapshot = vi.spyOn(reactionPreview, 'snapshot').mockReturnValue({ target_id: 'card', mine: { revision: 0, selections: [] }, actors_visible: true, private: false, has_more: false, groups: [{ key: 'received', expression: { text: '收到' }, count: 1, actors: [actor] }] })
    let ui!: ReturnType<typeof create>
    try {
      await act(async () => { ui = create(<ArkmeReactionSelections scope="test:1" target={{ id: 'card', source: '群', text: '' }} actorName="兔老大" actorAvatarRef="my-avatar" />) })
      await act(async () => ui.root.findByProps({ 'aria-label': '查看我的资料' }).props.onClick({ stopPropagation() {} }))
      expect(ui.root.findByType(ArkmeReactionActorCard).props.actor).toEqual(actor)
    } finally { await act(async () => ui?.unmount()); snapshot.mockRestore() }
  })
  it('highlights only the exact historical expression including its color', async () => {
    reactionPreview.setScope('test:1')
    const blue = { text: '收到', color: 'blue' }, red = { text: '收到', color: 'red' }
    const snapshot = vi.spyOn(reactionPreview, 'snapshot').mockReturnValue({ target_id: 'm', mine: { revision: 0, selections: [] }, actors_visible: true, private: false, has_more: false, groups: [blue, red].map((expression, index) => ({ key: String(index), expression, count: 1, actors: [{ userId: 2, displayName: '张三' }] })) })
    const highlight = vi.spyOn(reactionNotifications, 'highlights').mockReturnValue({ revision: 1, sourceKey: 'chat', itemUid: 'm', rows: [], active: true, expressionIdentity: expressionIdentity(blue) })
    let ui!: ReturnType<typeof create>
    try {
      await act(async () => { ui = create(<ArkmeReactionSelections scope="test:1" target={{ id: 'm', sourceKey: 'chat', itemUid: 'm', source: '群', text: '' }} />) })
      expect(ui.root.findAllByProps({ 'data-arkme-new-reaction': 'group' })).toHaveLength(1)
      expect(ui.root.findByProps({ 'data-arkme-new-reaction': 'group' }).findByProps({ 'aria-label': '添加收到' }).props.style.background).toBeDefined()
    } finally { await act(async () => ui?.unmount()); snapshot.mockRestore(); highlight.mockRestore() }
  })
  it('passes separate identity fields to the profile instead of the formatted reaction label', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    reactionPreview.setScope('test:1')
    const actor = { userId: 2, displayName: '哇咔咔', groupNickname: '负责人', avatarRef: 'opaque-avatar' }
    const snapshot = vi.spyOn(reactionPreview, 'snapshot').mockReturnValue({ target_id: 'card', mine: { revision: 0, selections: [] }, actors_visible: true, private: false, has_more: false, groups: [{ key: 'received', expression: { text: '收到' }, count: 1, actors: [actor] }] })
    let ui!: ReturnType<typeof create>
    try {
      await act(async () => { ui = create(<ArkmeReactionSelections scope="test:1" target={{ id: 'card', source: '群', text: '' }} />) })
      await act(async () => ui.root.findByProps({ 'aria-label': '查看哇咔咔的资料' }).props.onClick({ stopPropagation() {} }))
      expect(ui.root.findByType(ArkmeReactionActorCard).props.actor).toEqual(actor)
    } finally { await act(async () => ui?.unmount()); snapshot.mockRestore() }
  })
  it('highlights only the new actor in an old group and the entire newly added group', async () => {
    reactionPreview.setScope('test:1')
    const snapshot = vi.spyOn(reactionPreview, 'snapshot').mockReturnValue({ target_id: 'm', mine: { revision: 0, selections: [] }, actors_visible: true, private: false, has_more: false, groups: [
      { key: 'old', expression: { text: '赞' }, count: 2, actors: [{ userId: 2, displayName: '张三' }, { userId: 3, displayName: '李四' }] },
      { key: 'new', expression: { text: '收到' }, count: 1, actors: [{ userId: 4, displayName: '王五' }] },
    ] })
    const highlights = vi.spyOn(reactionNotifications, 'highlights').mockReturnValue({ revision: 1, active: true, sourceKey: 'chat', itemUid: 'm', rows: [
      { id: 'a', revision: 1, actorUserId: 3, sourceKey: 'chat', itemUid: 'm', recordOwnerUserId: 1, sendAtMillis: 1, text: '', selections: [{ key: 'old', expression: { text: '赞' }, at: 1 }] },
      { id: 'b', revision: 1, actorUserId: 4, sourceKey: 'chat', itemUid: 'm', recordOwnerUserId: 1, sendAtMillis: 1, text: '', selections: [{ key: 'new', expression: { text: '收到' }, at: 1 }] },
    ] })
    let ui!: ReturnType<typeof create>
    try {
      await act(async () => { ui = create(<ArkmeReactionSelections scope="test:1" target={{ id: 'm', source: '群', text: '', sourceKey: 'chat', itemUid: 'm', sourceRef: 's', messageActionRef: 'm' }} />) })
      expect(ui.root.findByProps({ 'aria-label': '查看张三的资料' }).props['data-arkme-new-reaction']).toBeUndefined()
      expect(ui.root.findByProps({ 'aria-label': '查看李四的资料' }).props['data-arkme-new-reaction']).toBe('actor')
      expect(ui.root.findAllByProps({ 'data-arkme-new-reaction': 'group' })).toHaveLength(1)
      expect(ui.root.findByProps({ 'data-arkme-new-reaction': 'group' }).findByProps({ 'aria-label': '查看王五的资料' })).toBeDefined()
    } finally { await act(async () => { ui?.unmount() }); snapshot.mockRestore(); highlights.mockRestore() }
  })

  it('loads the first response despite conversation updates and keeps existing chips on new messages', async () => {
    vi.useFakeTimers()
    reactionPreview.setScope('test:1')
    const target = { id: 'stable-message', source: '测试群', text: '正文', sourceRef: 'sequence-1', messageActionRef: 'message' }
    reactionFixture.states.set(target.id, { revision: 1, selections: [{ key: 'received', expression: { text: '收到' }, at: 1 }] })
    const originalCall = reactionFixture.call.bind(reactionFixture)
    let finish!: () => void
    let reads = 0
    const spy = vi.spyOn(reactionFixture, 'call').mockImplementation(async (operation, input) => {
      if (input.action === 'query') {
        reads++
        if (reads === 1) await new Promise<void>(resolve => { finish = resolve })
      }
      return originalCall(operation, input)
    })
    const render = (sequence: number) => {
      const current = { ...target, sourceRef: `sequence-${sequence}` }
      return <ArkmeReactionPreview scope="test:1" target={current}>
        <ArkmeReactionSelections scope="test:1" target={current} />
      </ArkmeReactionPreview>
    }
    let ui!: ReturnType<typeof create>
    try {
      await act(async () => { ui = create(render(1)) })
      await act(async () => { await vi.advanceTimersByTimeAsync(40) })
      await act(async () => { ui.update(render(2)) })
      await act(async () => { finish(); await Promise.resolve() })
      expect(reactionPreview.selections(target.id)).toEqual(['收到'])
      const chip = ui.root.findByProps({ 'aria-label': '取消我的收到' })
      for (let sequence = 3; sequence <= 12; sequence++) {
        await act(async () => { ui.update(render(sequence)) })
        expect(reactionPreview.selections(target.id)).toEqual(['收到'])
        expect(ui.root.findByProps({ 'aria-label': '取消我的收到' })).toBe(chip)
        await act(async () => { await vi.advanceTimersByTimeAsync(50) })
      }
      expect(reads).toBe(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(reads).toBe(2)
      const lastRead = spy.mock.calls.filter(([, input]) => input.action === 'query').at(-1)![1]
      expect(lastRead.action === 'query' && lastRead.targets[0]?.sourceRef).toBe('sequence-12')
      await act(async () => { ui.unmount() })
      await act(async () => { ui = create(render(13)) })
      expect(ui.root.findByProps({ 'aria-label': '取消我的收到' })).toBeDefined()
      expect(reads).toBe(2) // visible before the new watch's background read

    } finally {
      await act(async () => { ui?.unmount() })
      spy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('hides an already-open actor list as soon as current permissions stop exposing identities', async () => {
    reactionPreview.setScope('test:1')
    const target = { id: 'privacy', source: '世界', text: '正文', worldRecordRef: 'opaque' }
    const unwatch = reactionPreview.watch('test:1', target)
    await reactionPreview.refresh(); await reactionPreview.toggle('test:1', target, '收到')
    const current = reactionPreview.snapshot(target.id)!
    let visible = true
    const snapshot = vi.spyOn(reactionPreview, 'snapshot').mockImplementation(() => ({ ...current, groups: current.groups.map(group => ({ ...group, count: 2 })), actors_visible: visible }))
    const actors = vi.spyOn(reactionPreview, 'actors').mockResolvedValue({ items: [{userId:8,displayName:'不应再显示的用户'}],has_more:false })
    let ui!: ReturnType<typeof create>
    try {
      await act(async()=>{ui=create(<ArkmeReactionSelections scope="test:1" target={target} />)})
      await act(async()=>ui.root.findByProps({'aria-label':'查看 2 位表态者'}).props.onClick({stopPropagation(){}}))
      expect(ui.root.findAllByProps({'aria-label':'表态者'})).toHaveLength(1)
      visible=false
      await act(async()=>ui.update(<ArkmeReactionSelections scope="test:1" target={target} />))
      expect(ui.root.findAllByProps({'aria-label':'表态者'})).toHaveLength(0)
    } finally { await act(async()=>ui?.unmount()); snapshot.mockRestore(); actors.mockRestore(); unwatch() }
  })
  it('saves image-only compositions, restores them, reacts and cancels as one item', async () => {
    reactionPreview.setScope('test:1')
    let ui: ReturnType<typeof create>
    const target = { id: 'm', source: '群', text: '正文' }
    const render = () => <ArkmeReactionPreview scope="test:1" target={target}><ArkmeReactionSelections scope="test:1" target={target} /></ArkmeReactionPreview>
    await act(async () => { ui = create(render()) })
    const click = async (label: string) => await act(async () => ui!.root.findAllByType('button').find(b => b.props['aria-label'] === label)!.props.onClick({ stopPropagation() {} }))
    await click('表态'); await click('新建自定义短语')
    expect(ui!.root.findByProps({ type: 'submit' }).props.disabled).toBe(true)
    await click('选择短语表情'); await click('使用开心'); await click('搭配赞')
    expect(ui!.root.findByProps({ 'aria-label': '选择短语表情' }).findAllByType('img')).toHaveLength(2)
    await click('选择短语表情'); await click('使用惊讶')
    expect(ui!.root.findByProps({ 'aria-label': '搭配赞' }).props['aria-pressed']).toBe(true)
    await click('搭配赞')
    expect(ui!.root.findByProps({ 'aria-label': '选择短语表情' }).findAllByType('img')).toHaveLength(1)
    await click('搭配赞')
    expect(ui!.root.findByProps({ type: 'submit' }).props.disabled).toBe(false)
    await act(async () => ui!.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(reactionPreview.selections('m')).toEqual([])
    await act(async () => ui!.unmount())
    await act(async () => { ui = create(render()) })
    await click('表态'); await click('惊讶＋赞')
    expect(reactionPreview.selections('m')).toEqual(['[jm_combo:surprised_face:thumb_up]'])
    const chip = ui!.root.findByProps({ 'aria-label': '取消我的惊讶＋赞' })
    expect(chip.findAllByType('img').map(img => img.props.src)).toEqual(['surprised_face', 'thumb_up'].map(id => arkmeDefaultEmojis.find(e => e.id === id)!.assetUrl))
    await click('取消我的惊讶＋赞')
    expect(reactionPreview.selections('m')).toEqual([])
    await click('表态'); await click('新建自定义短语'); await click('选择短语表情'); await click('使用开心'); await click('搭配赞')
    await act(async () => ui!.root.findByProps({ 'aria-label': '自定义表态短语' }).props.onChange({ target: { value: '稳了' } }))
    await act(async () => ui!.root.findAllByType('button').find(b => b.children.includes('保存并表态'))!.props.onClick())
    expect(reactionPreview.selections('m')).toEqual(['[jm_combo:smiling_face:thumb_up] 稳了'])
    await act(async () => ui!.unmount())
  })
  it('keeps the picker open when a reaction is rejected', async () => {
    let ui: ReturnType<typeof create>
    await act(async () => { ui = create(<ArkmeReactionPreview scope="inactive" target={{ id: 'm', source: '我', text: '正文' }} />) })
    await act(async () => ui!.root.findByProps({ 'aria-label': '表态' }).props.onClick())
    await act(async () => ui!.root.findByProps({ 'aria-label': arkmeDefaultEmojis[0]!.label }).props.onClick())
    expect(ui!.root.findAllByProps({ 'aria-label': '表态面板' })).toHaveLength(1)
    expect(reactionPreview.selections('m')).toEqual([])
    await act(async () => ui!.unmount())
  })

  it('closes after selection and reanchors on reopening', async () => {
    vi.stubGlobal('window', { innerWidth: 900, innerHeight: 800, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('document', { body: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    reactionPreview.setScope('test:1')
    let triggerTop = 400
    const anchor = { focus() {}, getBoundingClientRect: () => ({ left: 200, top: triggerTop, bottom: triggerTop + 26 }) }
    const panel = { getBoundingClientRect: () => ({ width: 340 }) }
    let ui: ReturnType<typeof create>
    await act(async () => { ui = create(<ArkmeReactionPreview scope="test:1" target={{ id: 'm', source: '我', text: '正文' }} />, {
      createNodeMock: node => node.props['aria-label'] === '表态' ? anchor : node.props['aria-label'] === '表态面板' ? panel : null,
    }) })
    await act(async () => ui!.root.findByProps({ 'aria-label': '表态' }).props.onClick())
    const originalBottom = ui!.root.findByProps({ 'aria-label': '表态面板' }).props.style.bottom
    triggerTop = 450
    await act(async () => ui!.root.findByProps({ 'aria-label': arkmeDefaultEmojis[0]!.label }).props.onClick())
    expect(ui!.root.findAllByProps({ 'aria-label': '表态面板' })).toHaveLength(0)
    await act(async () => ui!.root.findByProps({ 'aria-label': '表态' }).props.onClick())
    expect(ui!.root.findByProps({ 'aria-label': '表态面板' }).props.style.bottom).not.toBe(originalBottom)
    await act(async () => ui!.unmount())
  })

  it('repositions the hover entry after bubble resize and releases its observer', async () => {
    vi.stubGlobal('window', { innerWidth: 1000 })
    let resize = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect = disconnect
    })
    let box = { left: 200, right: 600, bottom: 300 }
    const bubble = { getBoundingClientRect: () => box }
    const root = { querySelector: (selector: string) => selector === '[data-arkme-message-direction]' ? bubble : null, closest: () => null, getBoundingClientRect: () => ({ left: 100, top: 100 }) }
    let ui: ReturnType<typeof create>
    await act(async () => { ui = create(<ArkmeReactionPreview scope="test:1" isMe target={{ id: 'm', source: '我', text: '原文' }} />, {
      createNodeMock: element => element.props['data-arkme-reaction-preview'] === true ? root : null,
    }) })
    expect(ui!.root.findByProps({ className: 'arkme-reaction-hover-toolbar' }).props.style).toMatchObject({ left: 68, top: 174 })
    box = { left: 400, right: 600, bottom: 250 }
    await act(async () => resize())
    expect(ui!.root.findByProps({ className: 'arkme-reaction-hover-toolbar' }).props.style).toMatchObject({ left: 268, top: 124 })
    await act(async () => ui!.unmount())
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('opens actor details independently from canceling a reaction', async () => {
    reactionPreview.setScope('test:1')
    const target = { id: 'm', source: '群', text: '原文' }
    reactionPreview.watch('test:1', target)
    await reactionPreview.toggle('test:1', target, '👌 收到')
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    let ui: ReturnType<typeof create>
    await act(async () => { ui = create(<ArkmeReactionSelections scope="test:1" target={target} actorName="小陈" />) })
    await act(async () => ui!.root.findByProps({ 'aria-label': '查看小陈的资料' }).props.onClick({ stopPropagation() {} }))
    expect(ui!.root.findByProps({ role: 'dialog' }).props['aria-label']).toBe('小陈 的用户卡片')
    expect(reactionPreview.selections('m')).toEqual(['👌 收到'])
    await act(async () => ui!.root.findByProps({ 'aria-label': '取消我的👌 收到' }).props.onClick({ stopPropagation() {} }))
    expect(reactionPreview.selections('m')).toEqual([])
    await act(async () => ui!.unmount())
  })

  it('keeps the picker above the trigger with a bounded height and falls below only near the top edge', async () => {
    expect(reactionPanelPosition({ left: 300, top: 300, bottom: 326 }, 340, { width: 900, height: 800 }))
      .toEqual({ left: 300, bottom: 508, maxHeight: 284 })
    expect(reactionPanelPosition({ left: 800, top: 40, bottom: 66 }, 340, { width: 900, height: 800 }))
      .toEqual({ left: 552, top: 74, maxHeight: 718 })
  })
  it('anchors outgoing left and incoming right at the bottom without layout space', async () => {
    const box = { left: 200, right: 500, bottom: 300 }, parent = { left: 200, top: 100 }, edges = { left: 8, right: 900 }
    expect(reactionToolbarPosition(true, box, parent, edges)).toMatchObject({ left: -32, top: 174 })
    // Stay above the receipt and leave six pixels clear of the message bubble.
    expect(reactionToolbarPosition(true, box, parent, edges, { left: 182, right: 194, top: 288 })).toMatchObject({ left: -32, top: 156 })
    // When the receipt leaves no room beside it, use the space below the bubble.
    expect(reactionToolbarPosition(true, { ...box, left: 27 }, { ...parent, left: 9 }, edges, { left: 9, right: 15, top: 294 })).toMatchObject({ left: 18, top: 200 })
    expect(reactionToolbarPosition(false, box, parent, edges)).toMatchObject({ left: 300, top: 174 })
    expect(reactionToolbarPosition(true, { ...box, left: 10 }, { ...parent, left: 10 }, edges)).toMatchObject({ left: 0, top: 200 })
  })
  it('offers the entire existing emoji catalog and preserves distinct asset identities', async () => {
    reactionPreview.setScope('test:1')
    let ui: ReturnType<typeof create>
    await act(async () => { ui = create(<ArkmeReactionPreview scope="test:1" target={{ id: 'm', source: '群', text: '原文' }}><div data-arkme-message-direction="self"><span>原文</span><ArkmeReactionSelections scope="test:1" target={{ id: 'm', source: '群', text: '原文' }} /></div></ArkmeReactionPreview>) })
    await act(async () => ui!.root.findByProps({ 'aria-expanded': false }).props.onClick())
    const grid = ui!.root.findByProps({ role: 'group', 'aria-label': '全部表情' })
    expect(grid.findAllByType('button')).toHaveLength(arkmeDefaultEmojis.length)
    const first = arkmeDefaultEmojis.find(value => value.id === 'crying_face')!
    const second = arkmeDefaultEmojis.find(value => value.id === 'sobbing_face')!
    await act(async () => grid.findByProps({ 'aria-label': first.label }).props.onClick())
    await act(async () => ui!.root.findByProps({ 'aria-label': '表态' }).props.onClick())
    await act(async () => ui!.root.findByProps({ 'aria-label': second.label }).props.onClick())
    expect(reactionPreview.selections('m')).toEqual([first.token, second.token])
    const bubble = ui!.root.findByProps({ 'data-arkme-message-direction': 'self' })
    expect(bubble.findByProps({ alt: first.label }).props.src).toBe(first.assetUrl)
    expect(bubble.findAllByProps({ 'data-arkme-message-reactions': true })).toHaveLength(1)
    await act(async () => ui!.root.findByProps({ 'aria-label': '表态' }).props.onClick())
    await act(async () => ui!.root.findByProps({ 'aria-label': first.label }).props.onClick())
    expect(reactionPreview.selections('m')).toEqual([second.token])
    await act(async () => ui!.unmount())
  })
  it('toggles reactions from the real picker and preserves multiple choices', async () => {
    reactionPreview.setScope('test:1')
    let ui: ReturnType<typeof create>
    await act(async () => { ui = create(<ArkmeReactionPreview scope="test:1" target={{ id: 'm', source: '群', text: '核对报价单' }} />) })
    await act(async () => { ui!.root.findByProps({ 'aria-expanded': false }).props.onClick() })
    const panelHeight = ui!.root.findByProps({ 'aria-label': '表态面板' }).props.style.height
    expect(panelHeight).toBeUndefined()
    expect(ui!.root.findByProps({ role: 'group', 'aria-label': '全部表情' }).props.style.height).toBe(206)
    expect(ui!.root.findAllByProps({ 'aria-label': '关闭表态面板' })).toHaveLength(0)
    expect(ui!.root.findAllByProps({ role: 'tab' })).toHaveLength(0)
    expect(ui!.root.findByProps({ role: 'group', 'aria-label': '短语' })).toBeDefined()
    expect(ui!.root.findByProps({ role: 'group', 'aria-label': '全部表情' })).toBeDefined()
    expect(ui!.root.findByProps({ 'aria-label': '表态面板' }).props.style.height).toBe(panelHeight)
    const click = async (label: string) => {
      if (!ui!.root.findAllByProps({ 'aria-label': '表态面板' }).length) await act(async () => ui!.root.findByProps({ 'aria-label': '表态' }).props.onClick())
      await act(async () => { ui!.root.findAllByType('button').find(b => b.children.join('') === label)!.props.onClick() })
      expect(ui!.root.findAllByProps({ 'aria-label': '表态面板' })).toHaveLength(0)
    }
    await click('👌 收到'); await click('✅ 已完成')
    expect(reactionPreview.selections('m')).toEqual(['👌 收到', '✅ 已完成'])
    await click('👌 收到')
    expect(reactionFixture.history).toHaveLength(3)
    expect(reactionPreview.selections('m')).toEqual(['✅ 已完成'])
    await act(async () => { ui!.unmount() })
  })
  it('shows one editable phrase list with direct creation and confirmed deletion', async () => {
    reactionPreview.setScope('test:1')
    let ui: ReturnType<typeof create>
    const render = () => <ArkmeReactionPreview scope="test:1" target={{ id: 'm', source: '群', text: '原文' }} />
    await act(async () => { ui = create(render()) })
    const click = async (label: string) => await act(async () => ui!.root.findByProps({ 'aria-label': label }).props.onClick())
    await click('表态')
    expect(ui!.root.findAllByProps({ 'aria-label': '打开短语库' })).toHaveLength(0)
    expect(ui!.root.findByProps({ 'aria-label': '短语列表' }).props.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))')
    expect(ui!.root.findByProps({ 'aria-label': '👌 收到' }).props.title).toContain('拖动排序')
    await click('删除短语：👌 收到')
    expect(ui!.root.findByProps({ 'aria-label': '👌 收到' }).props.style.cursor).toBe('pointer')
    expect(ui!.root.findByProps({ className: 'arkme-phrase-delete-reveal' }).findAllByType('span').some(node => node.children.includes('确认删除'))).toBe(true)
    expect(ui!.root.findAllByProps({ 'aria-label': '删除短语：👌 收到' })).toHaveLength(0)
    await click('删除短语：⏳ 处理中')
    expect(ui!.root.findByProps({ 'aria-label': '👌 收到' }).children).toContain('👌 收到')
    expect(ui!.root.findByProps({ 'aria-label': '删除短语：👌 收到' })).toBeDefined()
    expect(ui!.root.findByProps({ 'aria-label': '⏳ 处理中' }).props.title).toBe('确认删除')
    expect(ui!.root.findAllByProps({ className: 'arkme-phrase-delete-reveal' })).toHaveLength(1)
    expect(reactionPreview.selections('m')).toEqual([])
    await click('删除短语：👌 收到')
    await click('取消删除')
    expect(ui!.root.findByProps({ 'aria-label': '👌 收到' }).children).toContain('👌 收到')
    await click('删除短语：👌 收到')
    await click('👌 收到')
    expect(reactionPreview.selections('m')).toEqual([])
    await click('新建自定义短语')
    await act(async () => ui!.root.findByProps({ 'aria-label': '自定义表态短语' }).props.onChange({ target: { value: '马上处理' } }))
    await act(async () => ui!.root.findAllByType('button').find(node => node.children.includes('保存并表态'))!.props.onClick())
    expect(reactionPreview.selections('m')).toEqual(['马上处理'])
    await click('表态')
    expect(ui!.root.findAllByProps({ 'aria-label': '👌 收到' })).toHaveLength(0)
    await click('马上处理')
    expect(reactionPreview.selections('m')).toEqual([])
    await act(async () => ui!.unmount())
    await act(async () => { ui = create(render()) })
    await click('表态')
    expect(ui!.root.findAllByProps({ 'aria-label': '👌 收到' })).toHaveLength(0)
    expect(ui!.root.findByProps({ 'aria-label': '马上处理' })).toBeDefined()
    await act(async () => ui!.unmount())
  })
  it('saves without reacting, keeps the picker layout, and discards a closed draft', async () => {
    reactionPreview.setScope('test:1')
    let ui: ReturnType<typeof create>
    await act(async () => { ui = create(<ArkmeReactionPreview scope="test:1" target={{ id: 'm', source: '群', text: '正文' }} />) })
    const click = async (label: string) => await act(async () => ui!.root.findByProps({ 'aria-label': label }).props.onClick())
    await click('表态'); await click('新建自定义短语')
    expect(ui!.root.findByType('dialog').props['aria-modal']).toBe('true')
    expect(ui!.root.findByProps({ 'aria-label': '选择短语表情' }).findAllByType('img')).toHaveLength(0)
    expect(ui!.root.findAllByProps({ 'aria-label': '移除已选表情' })).toHaveLength(0)
    expect(ui!.root.findByProps({ 'aria-label': '选择短语表情' }).props.title).toBe('添加表情（可选）')
    expect(ui!.root.findByProps({ 'aria-label': '全部表情' }).props.style.display).toBe('grid')
    await act(async () => ui!.root.findByProps({ 'aria-label': '自定义表态短语' }).props.onChange({ target: { value: '仅保存' } }))
    await act(async () => ui!.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(reactionPreview.selections('m')).toEqual([])
    expect(ui!.root.findAllByType('dialog')).toHaveLength(0)
    expect(ui!.root.findByProps({ 'aria-label': '仅保存' })).toBeDefined()
    await click('新建自定义短语')
    await act(async () => ui!.root.findByProps({ 'aria-label': '自定义表态短语' }).props.onChange({ target: { value: '不要保存' } }))
    await act(async () => ui!.root.findByType('dialog').props.onCancel({ preventDefault() {} }))
    expect(ui!.root.findAllByProps({ 'aria-label': '不要保存' })).toHaveLength(0)
    expect(ui!.root.findByProps({ 'aria-label': '表态面板' })).toBeDefined()
    await act(async () => ui!.unmount())
  })

  it('does not cancel an existing reaction when saving and reacting to the same phrase', async () => {
    reactionPreview.setScope('test:1')
    const target = { id: 'm', source: '群', text: '正文' }
    await reactionPreview.toggle('test:1', target, '已经表态')
    let ui: ReturnType<typeof create>
    await act(async () => { ui = create(<ArkmeReactionPreview scope="test:1" target={target} />) })
    await act(async () => ui!.root.findByProps({ 'aria-label': '表态' }).props.onClick())
    await act(async () => ui!.root.findByProps({ 'aria-label': '新建自定义短语' }).props.onClick())
    await act(async () => ui!.root.findByProps({ 'aria-label': '自定义表态短语' }).props.onChange({ target: { value: '已经表态' } }))
    await act(async () => ui!.root.findAllByType('button').find(node => node.children.includes('保存并表态'))!.props.onClick())
    expect(reactionPreview.selections('m')).toEqual(['已经表态'])
    expect(ui!.root.findAllByType('dialog')).toHaveLength(0)
    await act(async () => ui!.unmount())
  })

  it('cancels delete confirmation on blank space without deleting or reacting and releases the listener', async () => {
    const listeners = new Map<string, (event: unknown) => void>()
    const removeEventListener = vi.fn((name: string) => listeners.delete(name))
    vi.stubGlobal('document', { body: {}, addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener), removeEventListener })
    class Target { constructor(private button: boolean) {} closest() { return this.button ? {} : null } }
    vi.stubGlobal('Element', Target)
    reactionPreview.setScope('test:1')
    let ui: ReturnType<typeof create>
    await act(async () => { ui = create(<ArkmeReactionPreview scope="test:1" target={{ id: 'm', source: '群', text: '正文' }} />) })
    await act(async () => ui!.root.findByProps({ 'aria-label': '表态' }).props.onClick())
    await act(async () => ui!.root.findByProps({ 'aria-label': '删除短语：👌 收到' }).props.onClick())
    await act(async () => listeners.get('click')!({ target: new Target(true) }))
    expect(ui!.root.findAllByProps({ className: 'arkme-phrase-delete-reveal' })).toHaveLength(1)
    await act(async () => listeners.get('click')!({ target: new Target(false) }))
    expect(ui!.root.findAllByProps({ className: 'arkme-phrase-delete-reveal' })).toHaveLength(0)
    expect(ui!.root.findByProps({ 'aria-label': '👌 收到' })).toBeDefined()
    expect(ui!.root.findByProps({ 'aria-label': '新建自定义短语' })).toBeDefined()
    expect(reactionPreview.selections('m')).toEqual([])
    expect(listeners.has('click')).toBe(false)
    await act(async () => ui!.root.findByProps({ 'aria-label': '删除短语：👌 收到' }).props.onClick())
    await act(async () => ui!.unmount())
    expect(listeners.has('click')).toBe(false)
  })

  it('previews the chosen color, persists it and uses it on the emitted reaction', async () => {
    reactionPreview.setScope('test:1')
    const target = { id: 'm', source: '群', text: '正文' }
    const render = () => <><ArkmeReactionPreview scope="test:1" target={target} /><ArkmeReactionSelections scope="test:1" target={target} /></>
    let ui: ReturnType<typeof create>
    await act(async () => { ui = create(render()) })
    await act(async () => ui!.root.findByProps({ 'aria-label': '表态' }).props.onClick())
    await act(async () => ui!.root.findByProps({ 'aria-label': '新建自定义短语' }).props.onClick())
    await act(async () => ui!.root.findByProps({ 'aria-label': '玫瑰粉' }).props.onClick())
    await act(async () => ui!.root.findByProps({ 'aria-label': '自定义表态短语' }).props.onChange({ target: { value: '你好' } }))
    const previewColor = ui!.root.findByProps({ 'aria-label': '自定义表态短语' }).props.style.background
    expect(ui!.root.findByProps({ 'aria-label': '玫瑰粉' }).props['aria-pressed']).toBe(true)
    await act(async () => ui!.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(reactionPreview.selections('m')).toEqual([])
    expect(ui!.root.findByProps({ 'aria-label': '你好' }).props.style.background).toBe(previewColor)
    await act(async () => ui!.unmount())
    await act(async () => { ui = create(render()) })
    await act(async () => ui!.root.findByProps({ 'aria-label': '表态' }).props.onClick())
    expect(ui!.root.findByProps({ 'aria-label': '你好' }).props.style.background).toBe(previewColor)
    await act(async () => ui!.root.findByProps({ 'aria-label': '你好' }).props.onClick())
    const chip = ui!.root.findByProps({ 'aria-label': '取消我的你好' })
    expect(chip.props.style.background).toBe(previewColor)
    expect(chip.props['data-reaction-expression']).toBeUndefined()
    expect(chip.props.style.top).toBeUndefined()
    expect(chip.props.style.transform).toBeUndefined()
    await act(async () => ui!.unmount())
  })

  it('saves an emoji and text as one reusable, reversible colored reaction', async () => {
    reactionPreview.setScope('test:1')
    let ui: ReturnType<typeof create>
    await act(async () => { ui = create(<ArkmeReactionPreview scope="test:1" target={{ id: 'm', source: '群', text: '正文' }} />) })
    const click = async (label: string) => await act(async () => ui!.root.findByProps({ 'aria-label': label }).props.onClick())
    await click('表态'); await click('新建自定义短语'); await click('选择短语表情')
    expect(ui!.root.findByProps({ 'aria-label': '选择组合表情' }).findAllByType('img')).toHaveLength(arkmeDefaultEmojis.length)
    await click('使用开心')
    expect(ui!.root.findAllByProps({ 'aria-label': '选择组合表情' })).toHaveLength(0)
    await click('天空蓝')
    await act(async () => ui!.root.findByProps({ 'aria-label': '自定义表态短语' }).props.onChange({ target: { value: '包在我身上' } }))
    const color = ui!.root.findByProps({ 'aria-label': '自定义表态短语' }).props.style.background
    await act(async () => ui!.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(reactionPreview.selections('m')).toEqual([])
    expect(ui!.root.findByProps({ 'aria-label': '开心 包在我身上' }).props.style.background).toBe(color)
    expect(ui!.root.findByProps({ 'aria-label': '开心 包在我身上' }).findByType('img').props.src).toBe(arkmeDefaultEmojis.find(value => value.id === 'smiling_face')!.assetUrl)
    await click('开心 包在我身上')
    expect(reactionPreview.selections('m')).toEqual(['[jm_emoji:smiling_face] 包在我身上'])
    await click('表态'); await click('开心 包在我身上')
    expect(reactionPreview.selections('m')).toEqual([])
    await act(async () => ui!.unmount())
  })

  it('allows removing the chosen emoji and prevents truncating an overlength combination', async () => {
    reactionPreview.setScope('test:1')
    let ui: ReturnType<typeof create>
    await act(async () => { ui = create(<ArkmeReactionPreview scope="test:1" target={{ id: 'm', source: '群', text: '正文' }} />) })
    const click = async (label: string) => await act(async () => ui!.root.findByProps({ 'aria-label': label }).props.onClick())
    await click('表态'); await click('新建自定义短语')
    const text = '字'.repeat(20)
    await act(async () => ui!.root.findByProps({ 'aria-label': '自定义表态短语' }).props.onChange({ target: { value: text } }))
    await click('选择短语表情'); await click('使用开心')
    expect(ui!.root.findByProps({ type: 'submit' }).props.disabled).toBe(true)
    await act(async () => ui!.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(ui!.root.findByType('dialog')).toBeDefined()
    expect(reactionPreview.selections('m')).toEqual([])
    await click('选择短语表情')
    await click('移除已选表情')
    expect(ui!.root.findAllByProps({ 'aria-label': '移除已选表情' })).toHaveLength(0)
    expect(ui!.root.findByProps({ 'aria-label': '自定义表态短语' }).props.value).toBe(text)
    expect(ui!.root.findByProps({ type: 'submit' }).props.disabled).toBe(false)
    await act(async () => ui!.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(ui!.root.findByProps({ 'aria-label': text })).toBeDefined()
    await act(async () => ui!.unmount())
  })

  it('toggles the inline add picker closed on its second request and opens on the third', async () => {
    reactionPreview.setScope('test:1')
    let ui!: ReturnType<typeof create>
    const target = { id: 'toggle-picker', source: '群', text: '测试' }
    await act(async () => { ui = create(<ArkmeReactionPreview scope="test:1" target={target} />) })
    for (const expected of [1, 0, 1]) {
      await act(async () => { ui.update(<ArkmeReactionPreview scope="test:1" target={target} openRequested toggleRequested />) })
      expect(ui.root.findAllByProps({ 'aria-label': '表态面板' })).toHaveLength(expected)
      await act(async () => { ui.update(<ArkmeReactionPreview scope="test:1" target={target} />) })
    }
    await act(async () => ui.unmount())
  })
  it('opens the same picker from a menu request and accepts repeated requests', async () => {
    reactionPreview.setScope('test:1')
    let ui: ReturnType<typeof create>
    const target = { id: 'm', source: '群', text: '测试' }
    await act(async () => { ui = create(<ArkmeReactionPreview scope="test:1" target={target} />) })
    await act(async () => { ui!.update(<ArkmeReactionPreview scope="test:1" target={target} openRequested />) })
    expect(ui!.root.findByProps({ 'aria-label': '表态面板' })).toBeTruthy()
    await act(async () => { ui!.update(<ArkmeReactionPreview scope="test:1" target={target} />) })
    await act(async () => { ui!.root.findByProps({ 'aria-label': '表态面板' }).props.onKeyDown({ key: 'Escape' }) })
    await act(async () => { ui!.update(<ArkmeReactionPreview scope="test:1" target={target} openRequested />) })
    expect(ui!.root.findByProps({ 'aria-expanded': true })).toBeTruthy()
    await act(async () => { ui!.unmount() })
  })
})

it('shows both actor names inline from either account instead of only a count', async () => {
 vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
 const target={id:'two-actors',source:'聊天',text:'正文'}
 const current={target_id:target.id,mine:{revision:0,selections:[]},groups:[{key:'a'.repeat(64),expression:{text:'收到'},count:2,actors:[{userId:7,displayName:'小陈'},{userId:8,displayName:'小何'}]}],actors_visible:true,private:false,has_more:false}
 const snapshot=vi.spyOn(reactionPreview,'snapshot').mockReturnValue(current)
 let ui!:ReturnType<typeof create>
 try {
  for(const scope of ['test:7','test:8']) {
   reactionPreview.setScope(scope)
   await act(async()=>{ui=create(<ArkmeReactionSelections scope={scope} target={target} actorName={scope==='test:7'?'小陈':'小何'} />)})
   expect(ui.root.findByProps({ 'aria-label': '查看小陈的资料' }).children).toEqual(['小陈'])
   expect(ui.root.findByProps({ 'aria-label': '查看小何的资料' }).children).toEqual(['小何'])
   await act(async () => ui.root.findByProps({ 'aria-label': '查看小何的资料' }).props.onClick({ stopPropagation() {} }))
   expect(ui.root.findByType(ArkmeReactionActorCard).props.actor.userId).toBe(8)
   await act(async()=>ui.unmount())
  }
 } finally {snapshot.mockRestore()}
})

 it('keeps the current profile name while the confirmed actor list arrives', async () => {
  reactionPreview.setScope('test:7')
  const target = { id: 'own-name-arrival', source: '聊天', text: '正文' }
  const expression = { text: '收到' }
  let displayName = '我'
  const snapshot = vi.spyOn(reactionPreview, 'snapshot').mockImplementation(() => ({ target_id: target.id, mine: { revision: 1, selections: [{ key: 'key', expression, at: 1 }] }, groups: [{ key: 'key', expression, count: 1, actors: [{ userId: 7, displayName }] }], actors_visible: true, private: false, has_more: false }))
  let ui!: ReturnType<typeof create>
  try {
   await act(async () => { ui = create(<ArkmeReactionSelections scope="test:7" target={target} actorName="兔老大" />) })
   const name = ui.root.findByProps({ 'aria-label': '查看兔老大的资料' })
   displayName = '兔老大'
   await act(async () => { ui.update(<ArkmeReactionSelections scope="test:7" target={target} actorName="兔老大" />) })
   expect(ui.root.findByProps({ 'aria-label': '查看兔老大的资料' })).toBe(name)
   expect(name.children).toEqual(['兔老大'])
  } finally { await act(async () => ui.unmount()); snapshot.mockRestore() }
 })

 it('does not override a fresh own name or darken selected phrase borders', async () => {
  reactionPreview.setScope('test:7')
  const target = { id: 'fresh-name', source: '聊天', text: '正文' }
  const expression = { text: '收到', color: 'blue' }
  let mine = false
  const snapshot = vi.spyOn(reactionPreview, 'snapshot').mockImplementation(() => ({ target_id: target.id, mine: { revision: 1, selections: mine ? [{ key: 'key', expression, at: 1 }] : [] }, groups: [{ key: 'key', expression, count: 1, actors: [{ userId: 7, displayName: '兔老大' }] }], actors_visible: true, private: false, has_more: false }))
  let ui!: ReturnType<typeof create>
  try {
   await act(async () => { ui = create(<ArkmeReactionSelections scope="test:7" target={target} actorName="旧名字" />) })
   const style = ui.root.findByProps({ 'aria-label': '添加收到' }).props.style
   mine = true
   await act(async () => { ui.update(<ArkmeReactionSelections scope="test:7" target={target} actorName="旧名字" />) })
   expect(ui.root.findByProps({ 'aria-label': '取消我的收到' }).props.style).toEqual(style)
   expect(ui.root.findByProps({ 'aria-label': '查看兔老大的资料' })).toBeTruthy()
  } finally { await act(async () => ui.unmount()); snapshot.mockRestore() }
 })

it('removes immediately while persistence is pending and restores on failure', async () => {
 reactionLibrary.setScope('test:1')
 vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
 let finishAnimation!: () => void
 const finished = new Promise<void>(resolve => { finishAnimation = resolve })
 const animate = vi.fn(() => ({ finished, cancel: vi.fn() }))
 const tile = { dataset: { reactionSort: expressionIdentity(labelExpression('👌 收到')) }, getBoundingClientRect: () => ({ left: 0, top: 0 }), animate }
 let ui!: ReturnType<typeof create>
 await act(async () => { ui = create(<ArkmeReactionPhrases scope="test:1" selected={[]} onUse={async () => true} />, { createNodeMock: element => element.props['data-reaction-sort-grid'] !== undefined ? { querySelectorAll: () => [tile], getBoundingClientRect: () => ({ left: 0, top: 0 }) } : null }) })
 let rejectSave!: (error: Error) => void
 const save = vi.spyOn(reactionLibrary, 'save').mockImplementation(() => new Promise((_resolve, reject) => { rejectSave = reject }))
 try {
  await act(async () => ui.root.findByProps({ 'aria-label': '删除短语：👌 收到' }).props.onClick())
  await act(async () => ui.root.findByProps({ 'aria-label': '👌 收到' }).props.onClick())
  expect(animate).toHaveBeenCalledTimes(1)
  expect(ui.root.findByProps({ 'aria-label': '👌 收到' })).toBeTruthy()
  await act(async () => { finishAnimation() })
  expect(ui.root.findAllByProps({ 'aria-label': '👌 收到' })).toHaveLength(0)
  expect(ui.root.findByProps({ 'aria-label': '短语列表' }).props['aria-busy']).toBe(true)
  expect(save).toHaveBeenCalledTimes(1)
  await act(async () => { rejectSave(new Error('网络失败，请重试')) })
  expect(ui.root.findByProps({ 'aria-label': '👌 收到' })).toBeTruthy()
  expect(ui.root.findByProps({ 'aria-label': '短语列表' }).props['aria-busy']).toBe(false)
  expect(ui.root.findByProps({ role: 'alert' }).children.filter(child => typeof child === 'string').join('')).toContain('网络失败')
 } finally { save.mockRestore(); await act(async () => ui.unmount()) }
})

it('creates same-text colors separately and reuses only an exact duplicate', async () => {
 reactionLibrary.setScope('test:1')
 const onUse = vi.fn(async () => true)
 const onNotice = vi.fn()
 let ui!: ReturnType<typeof create>
 await act(async () => { ui = create(<ArkmeReactionPhrases scope="test:1" selected={[]} onUse={onUse} onNotice={onNotice} />) })
 const click = async (label: string) => { await act(async () => ui.root.findByProps({ 'aria-label': label }).props.onClick()) }
 const add = async (color: string, react: boolean) => {
  await click('新建自定义短语')
  await act(async () => ui.root.findByProps({ 'aria-label': '自定义表态短语' }).props.onChange({ target: { value: '同词测试' } }))
  await click(color)
  if (react) await act(async () => ui.root.findAllByType('button').find(button => button.children.includes('保存并表态'))!.props.onClick())
  else await act(async () => ui.root.findByType('form').props.onSubmit({ preventDefault() {} }))
 }
 try {
  await add('天空蓝', false)
  expect(onUse).not.toHaveBeenCalled()
  await add('玫瑰粉', true)
  expect(onUse).toHaveBeenLastCalledWith('同词测试', { text: '同词测试', color: 'rose' })
  expect(ui.root.findAllByProps({ 'aria-label': '同词测试' })).toHaveLength(2)
  const revision = reactionLibrary.read('test:1')?.revision
  await add('天空蓝', false)
  expect(ui.root.findByProps({ role: 'status' }).children).toEqual(['已有相同短语，无需重复保存'])
  expect(reactionLibrary.read('test:1')?.revision).toBe(revision)
  await act(async () => ui.root.findAllByType('button').find(button => button.children.includes('保存并表态'))!.props.onClick())
  expect(onNotice).toHaveBeenLastCalledWith('短语已存在，已使用它表态')
  expect(onUse).toHaveBeenLastCalledWith('同词测试', { text: '同词测试', color: 'blue' })
  expect(reactionLibrary.read('test:1')?.revision).toBe(revision)
  const calls = onUse.mock.calls.length
  await act(async () => ui.update(<ArkmeReactionPhrases scope="test:1" selected={[{ text: '同词测试', color: 'blue' }]} onUse={onUse} onNotice={onNotice} />))
  await act(async () => ui.root.findAllByType('button').find(button => button.children.includes('保存并表态'))!.props.onClick())
  expect(onUse).toHaveBeenCalledTimes(calls)
  expect(ui.root.findByProps({ role: 'status' }).children).toEqual(['已有相同短语，你已添加过这个表态'])
  expect(ui.root.findAllByProps({ 'aria-label': '同词测试' })).toHaveLength(2)
  expect(reactionLibrary.read('test:1')?.items.filter(item => item.text === '同词测试').map(item => item.color)).toEqual(['blue', 'rose'])
 } finally { await act(async () => ui.unmount()) }
})

it('keeps the drop position while the reordered library is saving', async () => {
 reactionLibrary.setScope('test:1')
 let ui!: ReturnType<typeof create>
 await act(async () => { ui = create(<ArkmeReactionPhrases scope="test:1" selected={[]} onUse={async () => true} />) })
 const ids = ui.root.findAll(node => node.props['data-reaction-sort'] !== undefined).map(node => node.props['data-reaction-sort'])
 const box = { left: 0, top: 0, right: 100, bottom: 28, width: 100, height: 28 }
 const grid = { setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {}, querySelectorAll: () => ids.map((id, i) => ({ dataset: { reactionSort: id }, getBoundingClientRect: () => ({ ...box, left: i * 110, right: i * 110 + 100 }) })) }
 const node = { closest: () => grid, getBoundingClientRect: () => box }
 let finish!: () => void
 const save = vi.spyOn(reactionLibrary, 'save').mockImplementation(() => new Promise(resolve => { finish = () => resolve({ revision: 1, items: [] }) }))
 try {
  await act(async () => ui.root.findByProps({ 'aria-label': '👌 收到' }).props.onPointerDown({ button: 0, clientX: 10, clientY: 10, pointerId: 1, currentTarget: node }))
  await act(async () => ui.root.findByProps({ 'aria-label': '短语列表' }).props.onPointerMove({ pointerId: 1, clientX: 230, clientY: 10, preventDefault() {} }))
  const preview = ui.root.findAll(node => node.props['data-reaction-sort'] !== undefined).map(node => node.props['data-reaction-sort'])
  await act(async () => ui.root.findByProps({ 'aria-label': '短语列表' }).props.onPointerUp())
  const dropped = () => ui.root.findAll(node => node.props['data-reaction-sort'] !== undefined).map(node => node.props['data-reaction-sort'])
  expect(dropped()).toEqual(preview)
  expect(dropped().slice(0, 3)).toEqual([ids[1], ids[2], ids[0]])
  await act(async () => finish())
  expect(dropped()).toEqual(preview)
 } finally { save.mockRestore(); await act(async () => ui.unmount()) }
})
