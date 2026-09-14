import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BetaCommunityWelcomeStore, welcomeDraft, welcomeMatchesSource } from '../src/client/beta-community-welcome.js'
import { ArkmeBetaCommunityWelcome } from '../src/client/ArkmeBetaCommunityWelcome.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import type { ArkmeDSHBetaCommunityJoinResult } from '../src/dsh-beta-community.js'

const joined = { status: 'joined', source: { kind: 'group_chat', sourceRef: 'opaque-group', sourceKey: 'stable-group', displayName: 'DSH 内测群1号群' } } as ArkmeDSHBetaCommunityJoinResult
describe('private beta community welcome', () => {
  it('keeps the welcome after directory refresh changes the signed reference and group name', () => {
    const store = new BetaCommunityWelcomeStore()
    store.joined(joined, 'test:1', 'test:1')
    const refreshed = { ...joined.source, sourceRef: 'new-reference-with-latest-activity', displayName: '改名后的群' }
    expect(welcomeMatchesSource(store.getSnapshot(), 'test:1', refreshed)).toBe(true)
    expect(welcomeMatchesSource(store.getSnapshot(), 'test:2', refreshed)).toBe(false)
    expect(welcomeMatchesSource(store.getSnapshot(), 'prod:1', refreshed)).toBe(false)
    expect(welcomeMatchesSource(store.getSnapshot(), 'test:1', { ...refreshed, sourceKey: 'another-group' })).toBe(false)
    expect(welcomeMatchesSource(store.getSnapshot(), 'test:1', { ...refreshed, kind: 'private_chat' })).toBe(false)
  })
  it('repairs the saved legacy join without joining again and ignores stale resolution', () => {
    const legacy = { accountKey: 'test:1', sourceRef: 'original-ref', title: '群', occurredAtMillis: 123 }
    const persist = vi.fn()
    const store = new BetaCommunityWelcomeStore(legacy, persist)
    store.resolveLegacySource(legacy, joined.source)
    expect(welcomeMatchesSource(store.getSnapshot(), 'test:1', joined.source)).toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()?.occurredAtMillis).toBe(123)
    store.joined(joined, 'test:2', 'test:2')
    store.resolveLegacySource(legacy, { ...joined.source, sourceKey: 'stale' })
    expect(store.getSnapshot()?.sourceKey).toBe('stable-group')
  })
  it('ignores existing members, logged out users and stale responses after account/environment changes', () => {
    const store = new BetaCommunityWelcomeStore()
    store.joined({ ...joined, status: 'already_member' }, 'prod:1', 'prod:1')
    store.joined(joined, undefined, undefined)
    store.joined(joined, 'prod:1', 'test:1')
    store.joined(joined, 'prod:1', 'prod:2')
    expect(store.getSnapshot()).toBeUndefined()
  })
  it('retains one local presentation record and releases subscriptions', () => {
    const save = vi.fn()
    const store = new BetaCommunityWelcomeStore(undefined, save)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.joined(joined, 'test:1', 'test:1')
    expect(store.getSnapshot()).toMatchObject({ accountKey: 'test:1', sourceRef: 'opaque-group' })
    expect(save).toHaveBeenCalledTimes(1)
    unsubscribe()
    store.joined(joined, 'test:2', 'test:2')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()?.accountKey).toBe('test:2')
    const restored = new BetaCommunityWelcomeStore(store.getSnapshot())
    expect(restored.getSnapshot()).toEqual(store.getSnapshot())
  })
  it('keeps the welcome available when storage fails', () => {
    const store = new BetaCommunityWelcomeStore(undefined, () => { throw new Error('storage unavailable') })
    expect(() => store.joined(joined, 'test:1', 'test:1')).not.toThrow()
    expect(store.getSnapshot()).toBeDefined()
  })
  it('preserves edited drafts while allowing a different unchanged suggestion', () => {
    expect(welcomeDraft('', undefined, '我想问一下，')).toBe('我想问一下，')
    expect(welcomeDraft('我想问一下，', '我想问一下，', '大家好')).toBe('大家好')
    expect(welcomeDraft('我想问一下，怎么登录？', '我想问一下，', '大家好')).toBe('我想问一下，怎么登录？')
  })
  it('presents a system card, not a bot message, and only emits draft choices', () => {
    const choose = vi.fn()
    let view!: ReturnType<typeof create>
    act(() => { view = create(<ArkmeBetaCommunityWelcome title="DSH 内测群1号群" onChoose={choose} />) })
    const buttons = view.root.findAllByType('button')
    act(() => { buttons[4]!.props.onClick() })
    expect(choose).toHaveBeenCalledWith('我想问一下，')
    expect(buttons).toHaveLength(6)
    act(() => { buttons[0]!.props.onClick() })
    expect(arkmeUi.getSnapshot().mode).toBe('extensions')
    act(() => { buttons[1]!.props.onClick() })
    expect(arkmeUi.getSnapshot().mode).toBe('world')
    act(() => { buttons[2]!.props.onClick() })
    expect(arkmeUi.getSnapshot().mode).toBe('source')
    expect(arkmeUi.getSnapshot().selectedSource).toBeUndefined()
    expect(choose).toHaveBeenCalledTimes(1)
    const html = renderToStaticMarkup(<ArkmeBetaCommunityWelcome title="DSH 内测群1号群" disabled onChoose={choose} />)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('role="dialog"')
    expect(html).toContain('你的想法，或许会成为 Arkme 的下一次改变。')
    expect(html.match(/disabled=""/g)).toHaveLength(3)
    act(() => view.unmount())
  })
})
