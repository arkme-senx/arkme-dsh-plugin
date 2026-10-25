import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeClientError } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeWorldReactions } from '../src/client/ArkmeWorldReactions.js'
import { ArkmeReactionPreview, ArkmeReactionSelections } from '../src/client/ArkmeReactionPreview.js'
import { worldLocalReactionLibrary, worldReactionPreview } from '../src/client/world-reactions.js'
import { reactionFixture } from './reaction-fixture.js'
import { arkmeDefaultEmojis } from '../src/client/arkme-emoji.js'
import type { ArkmeWorldFeedItem } from '../src/types.js'
const transport = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<object>(), callArkme: (...args: unknown[]) => transport.call(...args) }))
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }))
const item: ArkmeWorldFeedItem = { recordRef: 'world-ref', localReactionTarget: { id: 'world-target', worldRecordRef: 'opaque-local-version' }, authorName: '公开作者', headline: '', textContent: '公开正文', imageRefs: [], imageCount: 0, videoCount: 0, voiceCount: 0, extendCount: 0, tags: [], templateKind: 0, createdAtMillis: 1, publishedAtMillis: 1 }
let ui: ReturnType<typeof create> | undefined
beforeEach(() => {
  vi.useFakeTimers(); reactionFixture.reset(); transport.call.mockReset()
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 1 })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
  transport.call.mockImplementation(async (operation: string, input: never) => {
    if (operation !== 'world.reactions.local') throw new Error('Cloud requests are forbidden in this test')
    return await reactionFixture.call(operation, input)
  })
})
afterEach(async () => {
  await act(async () => { ui?.unmount() }); ui = undefined
  worldReactionPreview.setScope(undefined); vi.unstubAllGlobals(); vi.useRealTimers()
})
async function mount() { await act(async () => { ui = create(<ArkmeWorldReactions item={item} onUnavailable={() => {}}><button>评论 3</button></ArkmeWorldReactions>) }) }
const click = async () => { await act(async () => { ui!.root.findByProps({ 'aria-label': '表态' }).props.onClick() }) }
describe('World private local reaction controls', () => {
  it('opens the shared panel immediately before any initial query finishes', async () => {
    await mount()
    expect(JSON.stringify(ui!.toJSON())).not.toContain('仅本机保存 · 未云同步')
    await click()
    expect(ui!.root.findByProps({ 'aria-label': '表态面板' })).toBeDefined()
    expect(ui!.root.findByType(ArkmeReactionPreview).props.store).toBe(worldReactionPreview)
    expect(ui!.root.findByType(ArkmeReactionPreview).props.library).toBe(worldLocalReactionLibrary)
    expect(ui!.root.findByProps({ 'aria-label': '表态面板' }).findAllByType('p').some(node => node.children.includes('仅本机保存 · 未云同步'))).toBe(true)
    expect(ui!.root.findAllByType('button').some(node => node.children.includes('评论 3'))).toBe(true)
    await click()
    expect(JSON.stringify(ui!.toJSON())).not.toContain('仅本机保存 · 未云同步')
  })
  it('adds and cancels expressions only through local transport and restores them on remount', async () => {
    await mount(); await click()
    await act(async () => { await ui!.root.findByProps({ 'aria-label': arkmeDefaultEmojis[0]!.label }).props.onClick() })
    expect(ui!.root.findByProps({ 'aria-label': '取消我的生气' })).toBeDefined()
    await act(async () => ui!.unmount()); ui = undefined
    worldReactionPreview.setScope(undefined)
    await mount(); await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(ui!.root.findByProps({ 'aria-label': '取消我的生气' })).toBeDefined()
    await act(async () => { ui!.root.findByProps({ 'aria-label': '取消我的生气' }).props.onClick({ stopPropagation() {} }) })
    expect(worldReactionPreview.selections('world-target')).toEqual([])
    expect(transport.call.mock.calls.every(([operation]) => operation === 'world.reactions.local')).toBe(true)
  })
  it('keeps failed saves unselected and presents the error', async () => {
    await mount(); await click()
    const original = transport.call.getMockImplementation()!
    transport.call.mockImplementation(async (operation, input) => {
      if (input.action === 'set') throw new ArkmeClientError({ code: 'local-save-failed', message: '本机保存失败，请重试', retryable: false })
      return await original(operation, input)
    })
    await act(async () => { await ui!.root.findByProps({ 'aria-label': arkmeDefaultEmojis[0]!.label }).props.onClick() })
    expect(worldReactionPreview.selections('world-target')).toEqual([])
    expect(JSON.stringify(ui!.toJSON())).toContain('本机保存失败')
  })
  it('loads and saves the custom phrase library locally', async () => {
    await mount(); await click()
    await worldLocalReactionLibrary.save('test:1', [{ text: '只存本机', color: 'purple' }])
    expect(reactionFixture.library.items).toEqual([{ text: '只存本机', color: 'purple' }])
    expect(transport.call.mock.calls.some(([op, input]) => op === 'world.reactions.local' && input.action === 'library-set')).toBe(true)
    expect(ui!.root.findByType(ArkmeReactionSelections).props.store).toBe(worldReactionPreview)
  })
})
