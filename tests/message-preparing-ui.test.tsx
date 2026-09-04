import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeMessagePreparingIndicator } from '../src/client/ArkmeMessagePreparingIndicator.js'
import { useMessagePreparing } from '../src/client/use-message-preparing.js'
import { arkmeMessagePreparing } from '../src/client/message-preparing-store.js'
import type { ArkmeMessagePreparingTransport } from '../src/client/message-preparing-reporter.js'
import type { ArkmeSourceItem } from '../src/types.js'
import { callArkme } from '../src/client/api.js'
import { ArkmeComposerDraftStore, arkmeSourceComposerDraftKey } from '../src/client/composer-draft-store.js'
import { arkmeDefaultEmojis } from '../src/client/arkme-emoji.js'

vi.mock('../src/client/ArkmeAvatar.js', () => ({ ArkmeUserAvatar: (props: object) => <span data-avatar {...props} /> }))
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn(async () => null) }))
const source: ArkmeSourceItem = {
  kind: 'group_chat', sourceRef: 'source-ref', sourceKey: 'source-key', displayName: '群聊',
  activeAtMillis: 0, unreadCount: 0,
}
let renderer: ReactTestRenderer | undefined
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); arkmeMessagePreparing.activateAccount('prod:1') })
afterEach(() => {
  act(() => { renderer?.unmount() }); renderer = undefined
  arkmeMessagePreparing.activateAccount(undefined)
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks()
})
function publish(actorKey = 'actor') {
  arkmeMessagePreparing.apply({ type: 'message-preparing', revision: 1, sourceKey: 'source-key', actorKey,
    avatarRef: `image-${actorKey}`, prepareAtMillis: 100_000, expireAtMillis: 105_000,
    preparingState: 1, stateVersion: 100_000, eventAtMillis: 100_000 })
}

describe('preparing UI and lifecycle integration', () => {
  it('accepts a focused atomic edit before React focus state commits and clears a removed final mention', async () => {
    const transport: ArkmeMessagePreparingTransport = { report: vi.fn(async () => {}), cancel: vi.fn(async () => {}) }
    let controls!: ReturnType<typeof useMessagePreparing>
    function Harness() {
      controls = useMessagePreparing({ source, accountScope: 'prod:1', enabled: true, focused: false, transport })
      return null
    }
    act(() => { renderer = create(<Harness />) })
    const drafts = new ArkmeComposerDraftStore()
    const key = arkmeSourceComposerDraftKey(1, source)
    drafts.insertEmoji(key, arkmeDefaultEmojis[0]!, 0)
    controls.focus(true)
    controls.input(drafts.get(key).text)
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(transport.report).toHaveBeenCalledOnce()
    drafts.setText(key, '')
    const caret = drafts.insertMention(key, 'mention-ref', '小林', 0)!
    controls.input(drafts.get(key).text)
    expect(drafts.deleteMentionAtSelection(key, caret - 1, caret - 1, 'backward')).toBe(0)
    controls.input(drafts.get(key).text)
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(transport.cancel).toHaveBeenCalledOnce()
  })
  it('the default adapter sends capability/time only and failures never escape into composer actions', async () => {
    let controls!: ReturnType<typeof useMessagePreparing>
    function Harness() {
      controls = useMessagePreparing({ source, accountScope: 'prod:1', enabled: true, focused: true })
      return null
    }
    act(() => { renderer = create(<Harness />) })
    vi.mocked(callArkme).mockRejectedValueOnce(new Error('offline'))
    controls.input('private draft never sent'); await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(callArkme).toHaveBeenCalledWith('source.message-preparing.report',
      { sourceRef: 'source-ref', prepareAtMillis: 100_600 }, expect.any(AbortSignal))
    controls.stop(); await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(callArkme).toHaveBeenLastCalledWith('source.message-preparing.cancel',
      { sourceRef: 'source-ref', cancelAtMillis: 100_601 }, expect.any(AbortSignal))
    expect(JSON.stringify(vi.mocked(callArkme).mock.calls)).not.toContain('private draft')
  })

  it.each(['account', 'source', 'capability', 'disabled'] as const)('cancels the captured target on %s changes without reporting restored drafts', async change => {
    const transport: ArkmeMessagePreparingTransport = { report: vi.fn(async () => {}), cancel: vi.fn(async () => {}) }
    let controls!: ReturnType<typeof useMessagePreparing>
    function Harness({ changed = false }: { changed?: boolean }) {
      controls = useMessagePreparing({
        source: changed && change === 'source' ? { ...source, sourceRef: 'other-ref', sourceKey: 'other-key' }
          : changed && change === 'capability' ? { ...source, sourceRef: 'rotated-ref' } : source,
        accountScope: changed && change === 'account' ? 'prod:2' : 'prod:1',
        enabled: !(changed && change === 'disabled'), focused: true, transport,
      })
      return null
    }
    act(() => { renderer = create(<Harness />) })
    controls.input('editing'); await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    act(() => { renderer!.update(<Harness changed />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(transport.cancel).toHaveBeenCalledOnce()
    expect(vi.mocked(transport.cancel).mock.calls[0]![0]).toEqual({ accountScope: 'prod:1', sourceKey: 'source-key', sourceRef: 'source-ref' })
    expect(transport.report).toHaveBeenCalledOnce()
  })

  it.each(['blur', 'pagehide'])('cancels on window %s and does not report again merely on focus', async eventName => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => true })
    const win = new EventTarget()
    vi.stubGlobal('document', doc); vi.stubGlobal('window', win)
    const transport: ArkmeMessagePreparingTransport = { report: vi.fn(async () => {}), cancel: vi.fn(async () => {}) }
    let controls!: ReturnType<typeof useMessagePreparing>
    function Harness() {
      controls = useMessagePreparing({ source, accountScope: 'prod:1', enabled: true, focused: true, transport })
      return null
    }
    act(() => { renderer = create(<Harness />) })
    controls.input('editing'); await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    act(() => { win.dispatchEvent(new Event(eventName)) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(transport.cancel).toHaveBeenCalledOnce()
    act(() => { win.dispatchEvent(new Event('focus')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(transport.report).toHaveBeenCalledOnce()
    controls.input('new activity'); await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(transport.report).toHaveBeenCalledTimes(2)
  })

  it('shows scoped avatars and dots, expires, and never adds interactive controls', async () => {
    act(() => { renderer = create(<ArkmeMessagePreparingIndicator sourceKey="source-key" accountScope="prod:1" />) })
    expect(renderer!.toJSON()).toBeNull()
    act(() => { for (let i = 0; i < 9; i++) publish(`actor-${i}`) })
    expect(renderer!.root.findAllByProps({ 'data-avatar': true })).toHaveLength(7)
    expect(renderer!.root.findAllByProps({ 'data-arkme-preparing-dot': true })).toHaveLength(3)
    expect(renderer!.root.findAllByType('button')).toHaveLength(0)
    expect(renderer!.root.findByProps({ role: 'status' }).props['aria-label']).toBe('正在输入')
    expect(renderer!.root.findByType('style').children.join('')).toContain('prefers-reduced-motion')
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(renderer!.toJSON()).toBeNull()
  })
  it('never flashes the old account projection before effects run', () => {
    publish()
    act(() => { renderer = create(<ArkmeMessagePreparingIndicator sourceKey="source-key" accountScope="test:1" />) })
    expect(renderer!.toJSON()).toBeNull()
  })
  it('reports edits only in live chats; hidden windows and unmount cancel', async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => true })
    const win = new EventTarget()
    vi.stubGlobal('document', doc); vi.stubGlobal('window', win)
    const transport: ArkmeMessagePreparingTransport = { report: vi.fn(async () => {}), cancel: vi.fn(async () => {}) }
    let controls!: ReturnType<typeof useMessagePreparing>
    function Harness({ selected = source, enabled = true }: { selected?: ArkmeSourceItem; enabled?: boolean }) {
      controls = useMessagePreparing({ source: selected, accountScope: 'prod:1', enabled, focused: true, transport })
      return null
    }
    act(() => { renderer = create(<Harness />) })
    controls.input('hello'); await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(transport.report).toHaveBeenCalledOnce()
    doc.visibilityState = 'hidden'; act(() => { doc.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(transport.cancel).toHaveBeenCalledOnce()
    controls.input('hidden'); await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(transport.report).toHaveBeenCalledOnce()
    doc.visibilityState = 'visible'; act(() => { doc.dispatchEvent(new Event('visibilitychange')) })
    controls.input('new'); await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(transport.report).toHaveBeenCalledTimes(2)
    act(() => { renderer!.unmount(); renderer = undefined })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(transport.cancel).toHaveBeenCalledTimes(2)
    act(() => { renderer = create(<Harness selected={{ ...source, kind: 'send_to_self' }} />) })
    controls.input('personal'); await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(transport.report).toHaveBeenCalledTimes(2)
  })
})
