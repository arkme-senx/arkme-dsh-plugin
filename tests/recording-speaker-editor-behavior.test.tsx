import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn(), recommendation: vi.fn(), cached: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: (operation: string, ...args: unknown[]) => operation === 'recordings.speaker.cached-options' ? mocks.cached(...args) : operation === 'recordings.speaker.recommendation' ? mocks.recommendation(...args) : mocks.callArkme(operation, ...args) }))

import { arkmeAuthStore } from '../src/client/auth-store.js'

import { ArkmeRecordingSpeakerEditor } from '../src/client/recordings/ArkmeRecordingSpeakerEditor.js'

const tick = async () => { await Promise.resolve(); await Promise.resolve() }

describe('recording speaker editor failure recovery', () => {
  let renderer: ReactTestRenderer

  beforeEach(() => {
    mocks.cached.mockReset().mockResolvedValue(null)
    mocks.recommendation.mockReset().mockResolvedValue({})
    mocks.callArkme.mockReset()
    arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  })
  afterEach(async () => {
    await act(async () => { renderer?.unmount(); await tick() })
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })


  it('opens without programmatic focus and preserves manual input through candidate refresh', async () => {
    const focus = vi.fn()
    let resolveOptions!: (value: unknown[]) => void
    mocks.callArkme.mockImplementation(() => new Promise(resolve => { resolveOptions = resolve }))
    await act(async () => {
      renderer = create(<ArkmeRecordingSpeakerEditor item={{
        itemId: 'focus-item', itemRef: 'focus-ref', speakerLabel: '说话人', speakerColorIndex: 1,
        speakerNumber: 1, speakerKey: 'focus-key', sameSpeakerItemCount: 1,
        text: '内容', startAtMillis: 1_000, endAtMillis: 2_000, isBackground: false, isSelf: false,
      }} onUpdated={() => {}} onClose={() => {}} />, {
        createNodeMock: element => element.type === 'input' && element.props['aria-label'] === '说话人名称' ? { focus } : null,
      })
      await tick()
    })
    const input = renderer.root.findByProps({ 'aria-label': '说话人名称' })
    expect(input.props.autoFocus).toBeUndefined()
    expect(focus).not.toHaveBeenCalled()
    await act(async () => { input.props.onChange({ target: { value: '新名称' } }); await tick() })
    await act(async () => { resolveOptions([]); await tick() })
    expect(focus).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ 'aria-label': '说话人名称' }).props.value).toBe('新名称')
    await act(async () => { renderer.unmount(); await tick() })
    expect(focus).not.toHaveBeenCalled()
  })

  it('lets Tab enter the popover from its trigger without intercepting other keyboard navigation', async () => {
    const trigger = {}
    const focus = vi.fn()
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    vi.stubGlobal('document', { activeElement: trigger, addEventListener, removeEventListener })
    mocks.callArkme.mockResolvedValue([])
    const onClose = vi.fn()
    await act(async () => {
      renderer = create(<ArkmeRecordingSpeakerEditor item={{
        itemId: 'keyboard-item', itemRef: 'keyboard-ref', speakerLabel: '说话人', speakerColorIndex: 1,
        speakerNumber: 1, speakerKey: 'keyboard-key', sameSpeakerItemCount: 1,
        text: '内容', startAtMillis: 1_000, endAtMillis: 2_000, isBackground: false, isSelf: false,
      }} onUpdated={() => {}} onClose={onClose} />, {
        createNodeMock: element => element.type === 'input' && element.props['aria-label'] === '说话人名称' ? { focus } : null,
      })
      await tick()
    })
    const keydown = addEventListener.mock.calls.filter(([type]) => type === 'keydown').at(-1)![1]
    const preventDefault = vi.fn()
    expect(focus).not.toHaveBeenCalled()
    keydown({ key: 'Tab', target: {}, preventDefault })
    keydown({ key: 'Tab', target: trigger, shiftKey: true, preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
    keydown({ key: 'Tab', target: trigger, preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true })
    keydown({ key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    await act(async () => { renderer.unmount(); await tick() })
    expect(removeEventListener).toHaveBeenCalledWith('keydown', keydown)
  })

  it('shows persisted candidates on the first opening before remote loading completes', async () => {
    mocks.cached.mockResolvedValue([{ optionKey: 'saved', speakerRef: 'ref', label: '本地说话人', kind: 'speaker', isCurrentUser: false }])
    mocks.callArkme.mockImplementation(() => new Promise(() => {}))
    await act(async () => {
      renderer = create(<ArkmeRecordingSpeakerEditor item={{
        itemId: 'item', itemRef: 'ref', assignedSpeakerOptionKey: 'other', speakerLabel: '本地说话人', speakerColorIndex: 1,
        speakerNumber: 1, speakerKey: 'key', sameSpeakerItemCount: 1,
        text: '内容', startAtMillis: 1_000, endAtMillis: 2_000, isBackground: false, isSelf: false,
      }} onUpdated={() => {}} onClose={() => {}} />)
      await tick()
    })
    const candidate = renderer.root.findAll(node => node.type === 'button' && node.findAll(child => child.type === 'span' && child.children.includes('本地说话人')).length > 0)[0]!
    await act(async () => { candidate.props.onClick(); await tick() })
    expect(JSON.stringify(renderer.toJSON())).toContain('本地说话人')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('正在读取候选')
    expect(renderer.root.findAll(node => node.type === 'button' && node.children.join('') === '确认')[0]!.props.disabled).toBe(false)
  })

  it('shares cached candidates with another item while refresh is pending', async () => {
    const option = { optionKey: 'key-speaker-1', speakerRef: 'speaker-1', kind: 'speaker', label: '缓存说话人', recommended: false, currentAssignment: true, isCurrentUser: false }
    mocks.callArkme.mockResolvedValueOnce([option])
    const editor = <ArkmeRecordingSpeakerEditor item={{
      itemId: 'item-1', itemRef: 'sealed-item', assignedSpeakerOptionKey: 'key-speaker-1', speakerLabel: '说话人 1', speakerColorIndex: 1,
      speakerNumber: 1, speakerKey: 'speaker-opaque', sameSpeakerItemCount: 3,
      text: '内容', startAtMillis: 1_000, endAtMillis: 2_000, isBackground: false, isSelf: false,
    }} onUpdated={() => {}} onClose={() => {}} />
    await act(async () => { renderer = create(editor); await tick() })
    await act(async () => { renderer.unmount(); await tick() })
    mocks.callArkme.mockImplementationOnce(() => new Promise(() => {}))
    await act(async () => { renderer = create(<ArkmeRecordingSpeakerEditor {...editor.props} item={{ ...editor.props.item, itemRef: 'another-item' }} />); await tick() })
    expect(JSON.stringify(renderer.toJSON())).toContain('缓存说话人')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('正在读取候选')
  })

  it('keeps the user selection during background refresh and clears the cache after saving', async () => {
    const options = [
      { optionKey: 'key-speaker-1', speakerRef: 'speaker-1', kind: 'speaker', label: '甲', recommended: false, currentAssignment: true, isCurrentUser: false },
      { optionKey: 'key-speaker-2', speakerRef: 'speaker-2', kind: 'speaker', label: '乙', recommended: false, currentAssignment: false, isCurrentUser: false },
    ]
    mocks.callArkme.mockResolvedValueOnce(options)
    const onUpdated = vi.fn()
    const onClose = vi.fn()
    const editor = <ArkmeRecordingSpeakerEditor item={{
      itemId: 'item-1', itemRef: 'sealed-item', assignedSpeakerOptionKey: 'key-speaker-1', speakerLabel: '说话人 1', speakerColorIndex: 1,
      speakerNumber: 1, speakerKey: 'speaker-opaque', sameSpeakerItemCount: 3,
      text: '内容', startAtMillis: 1_000, endAtMillis: 2_000, isBackground: false, isSelf: false,
    }} onUpdated={onUpdated} onClose={onClose} />
    await act(async () => { renderer = create(editor); await tick() })
    await act(async () => { renderer.unmount(); await tick() })
    let finish!: (value: typeof options) => void
    mocks.callArkme.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await act(async () => { renderer = create(editor); await tick() })
    const second = renderer.root.findAll(node => node.type === 'button' && node.findAll(child => child.type === 'span' && child.children.includes('乙')).length > 0)[0]!
    await act(async () => { second.props.onClick(); await tick() })
    expect(renderer.root.findAll(node => node.type === 'button' && node.children.join('') === '确认')[0]!.props.disabled).toBe(false)
    await act(async () => { finish(options.map(option => ({ ...option, speakerRef: `${option.speakerRef}-renewed` }))); await tick() })
    mocks.callArkme.mockResolvedValueOnce({ day: { dateStamp: 1 } })
    const confirm = renderer.root.findAll(node => node.type === 'button' && node.children.join('') === '确认')[0]!
    expect(confirm.props.disabled).toBe(false)
    await act(async () => { confirm.props.onClick(); confirm.props.onClick(); await tick() })
    const writes = mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.speaker.assign-item')
    expect(writes).toHaveLength(1)
    expect(writes[0]![1]).toMatchObject({ speakerRef: 'speaker-2-renewed' })
    expect(onUpdated).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
    await act(async () => { renderer.unmount(); await tick() })
    mocks.callArkme.mockImplementationOnce(() => new Promise(() => {}))
    await act(async () => { renderer = create(editor); await tick() })
    expect(JSON.stringify(renderer.toJSON())).toContain('正在读取候选')
  })

  it('retains cached rows but blocks saving after a failed background refresh', async () => {
    const options = [{ optionKey: 'key-speaker-1', speakerRef: 'speaker-1', kind: 'speaker', label: '已缓存候选', recommended: false, currentAssignment: false, isCurrentUser: false }]
    mocks.callArkme.mockResolvedValueOnce(options)
    const editor = <ArkmeRecordingSpeakerEditor item={{
      itemId: 'item-1', itemRef: 'sealed-item', assignedSpeakerOptionKey: 'key-speaker-1', speakerLabel: '说话人 1', speakerColorIndex: 1,
      speakerNumber: 1, speakerKey: 'speaker-opaque', sameSpeakerItemCount: 3,
      text: '内容', startAtMillis: 1_000, endAtMillis: 2_000, isBackground: false, isSelf: false,
    }} onUpdated={() => {}} onClose={() => {}} />
    await act(async () => { renderer = create(editor); await tick() })
    await act(async () => { renderer.unmount(); await tick() })
    mocks.callArkme.mockRejectedValueOnce(new Error('刷新失败'))
    await act(async () => { renderer = create(editor); await tick() })
    expect(JSON.stringify(renderer.toJSON())).toContain('已缓存候选')
    expect(renderer.root.findByProps({ 'aria-label': '重试读取说话人候选' })).toBeDefined()
    const confirm = renderer.root.findAll(node => node.type === 'button' && node.children.join('') === '确认')[0]!
    expect(confirm.props.disabled).toBe(true)
  })

  it('fails closed when candidate loading fails and allows an explicit retry', async () => {
    mocks.callArkme.mockRejectedValueOnce(new Error('候选不可用')).mockResolvedValueOnce([])
    await act(async () => {
      renderer = create(<ArkmeRecordingSpeakerEditor item={{
        itemId: 'item-1', itemRef: 'sealed-item', assignedSpeakerOptionKey: 'key-speaker-1', speakerLabel: '说话人 1', speakerColorIndex: 1,
        speakerNumber: 1, speakerKey: 'speaker-opaque', sameSpeakerItemCount: 3,
        text: '内容', startAtMillis: 1_000, endAtMillis: 2_000, isBackground: false, isSelf: false,
      }} onUpdated={() => {}} onClose={() => {}} />)
      await tick()
    })

    const input = renderer.root.findByProps({ 'aria-label': '说话人名称' })
    await act(async () => { input.props.onChange({ target: { value: '新说话人' } }); await tick() })
    const add = renderer.root.findByProps({ 'aria-label': '添加新说话人' })
    expect(add.props.disabled).toBe(true)
    expect(renderer.root.findByProps({ 'aria-label': '重试读取说话人候选' })).toBeDefined()
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.speaker.assign-item'))
      .toHaveLength(0)

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '重试读取说话人候选' }).props.onClick()
      await tick()
    })

    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.speaker.options'))
      .toHaveLength(2)
    expect(renderer.root.findAllByProps({ 'aria-label': '重试读取说话人候选' })).toHaveLength(0)
  })

  it('does not create a duplicate speaker when the typed name exactly matches an existing option', async () => {
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.speaker.options') return [{
        optionKey: 'key-sealed-speaker', speakerRef: 'sealed-speaker',
        kind: 'speaker',
        label: '林老师',
        recommended: false,
        currentAssignment: false,
        isCurrentUser: false,
      }]
      if (operation === 'recordings.speaker.assign-item') throw new Error('must not mutate')
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await act(async () => {
      renderer = create(<ArkmeRecordingSpeakerEditor item={{
        itemId: 'item-1', itemRef: 'sealed-item', assignedSpeakerOptionKey: 'key-speaker-1', speakerLabel: '说话人 1', speakerColorIndex: 1,
        speakerNumber: 1, speakerKey: 'speaker-opaque', sameSpeakerItemCount: 3,
        text: '内容', startAtMillis: 1_000, endAtMillis: 2_000, isBackground: false, isSelf: false,
      }} onUpdated={() => {}} onClose={() => {}} />)
      await tick()
    })

    const input = renderer.root.findByProps({ 'aria-label': '说话人名称' })
    await act(async () => { input.props.onChange({ target: { value: '林老师' } }); await tick() })
    const confirm = renderer.root.findAll(node => node.type === 'button' && node.children.join('') === '确认')[0]!

    expect(confirm.props.disabled).toBe(true)
    await act(async () => { confirm.props.onClick(); await tick() })
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.speaker.assign-item'))
      .toHaveLength(0)
  })

  it('uses the desktop identity category name for candidate users', async () => {
    mocks.callArkme.mockResolvedValueOnce([{
      optionKey: 'key-candidate-user', speakerRef: 'candidate-user',
      kind: 'arkme-user',
      label: '小王',
      recommended: false,
      currentAssignment: false,
      isCurrentUser: true,
    }])
    await act(async () => {
      renderer = create(<ArkmeRecordingSpeakerEditor item={{
        itemId: 'item-1', itemRef: 'sealed-item', assignedSpeakerOptionKey: 'key-speaker-1', speakerLabel: '说话人 1', speakerColorIndex: 1,
        speakerNumber: 1, speakerKey: 'speaker-opaque', sameSpeakerItemCount: 1,
        text: '内容', startAtMillis: 1_000, endAtMillis: 2_000, isBackground: false, isSelf: false,
      }} onUpdated={() => {}} onClose={() => {}} />)
      await tick()
    })

    const markup = JSON.stringify(renderer.toJSON())
    expect(markup).toContain('Arkme 用户')
    expect(markup).not.toContain('即我用户')
  })
})
