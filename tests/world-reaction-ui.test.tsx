import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeClientError } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeWorldReactions } from '../src/client/ArkmeWorldReactions.js'
import { ArkmeReactionPreview, ArkmeReactionSelections } from '../src/client/ArkmeReactionPreview.js'
import { worldReactionContexts, worldCloudReactionPreview as worldReactionPreview } from '../src/client/world-reactions.js'
import { reactionLibrary } from '../src/client/reaction-library.js'
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
    if (operation === 'world.reactions.prepare') return { items: [{ recordRef: item.recordRef, target: { id: 'world-target', worldRecordRef: 'cloud-version' }, visibility: 'published' }], unavailableRecordRefs: [] }
    if (!['world.reactions', 'reactions'].includes(operation)) throw new Error('Unexpected transport')
    return await reactionFixture.call(operation, input)
  })
})
afterEach(async () => {
  await act(async () => { ui?.unmount() }); ui = undefined
  worldReactionPreview.setScope(undefined); worldReactionContexts.setScope(undefined); reactionLibrary.setScope(undefined); vi.unstubAllGlobals(); vi.useRealTimers()
})
async function mount() { await act(async () => { ui = create(<ArkmeWorldReactions item={item} onUnavailable={() => {}}><button>评论 3</button></ArkmeWorldReactions>); await vi.advanceTimersByTimeAsync(100) }) }
const click = async () => { await act(async () => { ui!.root.findByProps({ 'aria-label': '表态' }).props.onClick() }) }
describe('World cloud reaction controls', () => {
  it('uses the authoritative context and shared phrase library after preparation', async () => {
    await mount()
    expect(JSON.stringify(ui!.toJSON())).not.toContain('仅本机保存 · 未云同步')
    await click()
    expect(ui!.root.findByProps({ 'aria-label': '表态面板' })).toBeDefined()
    expect(ui!.root.findByType(ArkmeReactionPreview).props.store).toBe(worldReactionPreview)
    expect(ui!.root.findByType(ArkmeReactionPreview).props.library).toBe(reactionLibrary)
    expect(JSON.stringify(ui!.toJSON())).not.toContain('仅本机保存 · 未云同步')
    expect(ui!.root.findAllByType('button').some(node => node.children.includes('评论 3'))).toBe(true)
    await click()
    expect(JSON.stringify(ui!.toJSON())).not.toContain('仅本机保存 · 未云同步')
  })
  it('adds and cancels through cloud transport and never reads or uploads old local state', async () => {
    await mount(); await click()
    await act(async () => { await ui!.root.findByProps({ 'aria-label': arkmeDefaultEmojis[0]!.label }).props.onClick() })
    expect(ui!.root.findByProps({ 'aria-label': '取消我的生气' })).toBeDefined()
    await act(async () => ui!.unmount()); ui = undefined
    worldReactionPreview.setScope(undefined)
    await mount(); await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(ui!.root.findByProps({ 'aria-label': '取消我的生气' })).toBeDefined()
    await act(async () => { ui!.root.findByProps({ 'aria-label': '取消我的生气' }).props.onClick({ stopPropagation() {} }) })
    expect(worldReactionPreview.selections('world-target')).toEqual([])
    expect(transport.call.mock.calls.some(([operation]) => operation === 'world.reactions.local')).toBe(false)
    expect(transport.call.mock.calls.filter(([, input]) => input?.action === 'set').every(([operation, input]) => operation === 'world.reactions' && input.target.worldRecordRef === 'cloud-version')).toBe(true)
  })
  it('keeps failed saves unselected and presents the error', async () => {
    await mount(); await click()
    const original = transport.call.getMockImplementation()!
    transport.call.mockImplementation(async (operation, input) => {
      if (input.action === 'set') throw new ArkmeClientError({ code: 'local-save-failed', message: '云端保存失败，请重试', retryable: false })
      return await original(operation, input)
    })
    await act(async () => { await ui!.root.findByProps({ 'aria-label': arkmeDefaultEmojis[0]!.label }).props.onClick() })
    expect(worldReactionPreview.selections('world-target')).toEqual([])
    expect(JSON.stringify(ui!.toJSON())).toContain('云端保存失败')
  })
  it('shares the account phrase library without changing old local expressions', async () => {
    await mount(); await click()
    await reactionLibrary.save('test:1', [{ text: '共同短语', color: 'purple' }])
    expect(reactionFixture.library.items).toEqual([{ text: '共同短语', color: 'purple' }])
    expect(transport.call.mock.calls.some(([op, input]) => op === 'reactions' && input.action === 'library-set')).toBe(true)
    expect(ui!.root.findByType(ArkmeReactionSelections).props.store).toBe(worldReactionPreview)
  })
})
