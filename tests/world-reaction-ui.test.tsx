import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeClientError } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeWorldReactions } from '../src/client/ArkmeWorldReactions.js'
import { ArkmeReactionPreview, ArkmeReactionSelections } from '../src/client/ArkmeReactionPreview.js'
import { worldReactionContexts, worldReactionPreview } from '../src/client/world-reactions.js'
import { WORLD_REACTION_PENDING } from '../src/world-reaction-contract.js'
import { reactionFixture } from './reaction-fixture.js'
import { arkmeDefaultEmojis } from '../src/client/arkme-emoji.js'
import { WorldCard } from '../src/client/ArkmeWorldSurface.js'
import type { ArkmeWorldFeedItem } from '../src/types.js'

const transport = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<object>(), callArkme: (...args: unknown[]) => transport.call(...args) }))
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }))
const item: ArkmeWorldFeedItem = { recordRef: 'world-ref', authorName: '公开作者', headline: '', textContent: '公开正文', imageRefs: [], imageCount: 0, videoCount: 0, voiceCount: 0, extendCount: 0, tags: [], templateKind: 0, createdAtMillis: 1, publishedAtMillis: 1 }
let ui: ReturnType<typeof create> | undefined
beforeEach(() => {
  vi.useFakeTimers(); reactionFixture.reset(); transport.call.mockReset()
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 1 })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
  transport.call.mockImplementation(async (operation: string, input: never) => {
    if (operation === 'world.reactions.prepare') return { items: [{ recordRef: 'world-ref', target: { id: 'world-target', worldRecordRef: 'opaque-version' }, visibility: 'published' }], unavailableRecordRefs: [] }
    return await reactionFixture.call(operation, input)
  })
})
afterEach(async () => {
  await act(async () => { ui?.unmount() }); ui = undefined
  worldReactionContexts.setScope(undefined); worldReactionPreview.setScope(undefined)
  vi.unstubAllGlobals(); vi.useRealTimers()
})
async function mount(onUnavailable = vi.fn()) {
  await act(async () => { ui = create(<ArkmeWorldReactions item={item} onUnavailable={onUnavailable}><button>评论 3</button></ArkmeWorldReactions>) })
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
}
describe('World shared reaction controls', () => {
  it('reuses the shared panel and chips and keeps comments available', async () => {
    await mount()
    expect(ui!.root.findByType(ArkmeReactionPreview).props.store).toBe(worldReactionPreview)
    expect(ui!.root.findByType(ArkmeReactionSelections).props.store).toBe(worldReactionPreview)
    expect(ui!.root.findAllByType('button').some(node => node.children.includes('评论 3'))).toBe(true)
    expect(transport.call.mock.calls.some(([operation, input]) => operation === 'world.reactions' && input.action === 'query')).toBe(true)
    await act(async () => { ui!.root.findByProps({ 'aria-label': '表态' }).props.onClick() })
    expect(ui!.root.findByProps({ 'aria-label': '表态面板' })).toBeDefined()
    await act(async () => { await ui!.root.findByProps({ 'aria-label': arkmeDefaultEmojis[0]!.label }).props.onClick() })
    const writes = transport.call.mock.calls.filter(([operation, input]) => operation === 'world.reactions' && input.action === 'set')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.[1].target).toMatchObject({ worldRecordRef: 'opaque-version' })
    expect(writes[0]?.[1].target).not.toHaveProperty('sourceRef')
  })
  it('shows the explicit backend message and never writes or polls the legacy route', async () => {
    transport.call.mockRejectedValue(new ArkmeClientError({ code: 'world-reactions-unavailable', message: WORLD_REACTION_PENDING, retryable: false }))
    await mount()
    await act(async () => { ui!.root.findByProps({ 'aria-label': '表态' }).props.onClick() })
    expect(JSON.stringify(ui!.toJSON())).toContain(WORLD_REACTION_PENDING)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(transport.call).toHaveBeenCalledTimes(1)
    expect(ui!.root.findAllByType(ArkmeReactionPreview)).toHaveLength(0)
  })
  it('removes the public reaction identity and tells its card to hide content after revocation', async () => {
    const revoked = vi.fn()
    await mount(revoked)
    await act(async () => worldReactionContexts.unavailable('test:1', 'world-target'))
    expect(revoked).toHaveBeenCalledTimes(1)
    expect(ui!.root.findAllByType(ArkmeReactionPreview)).toHaveLength(0)
  })
  it('hides the actual post body, comments and controls after public access is revoked', async () => {
    const noop = () => {}
    await act(async () => { ui = create(<WorldCard item={item} playable={false} voiceprintActive={false} voiceprintLoading={false} interactionsOpen={false} onOpenInteractions={noop} onInteractionCreated={noop} onToggleVoiceprint={noop} />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(JSON.stringify(ui!.toJSON())).toContain('公开正文')
    await act(async () => worldReactionContexts.unavailable('test:1', 'world-target'))
    expect(JSON.stringify(ui!.toJSON())).not.toContain('公开正文')
    expect(ui!.root.findAllByProps({ 'aria-label': '表态' })).toHaveLength(0)
    expect(JSON.stringify(ui!.toJSON())).toContain('不再公开')
  })
  it('renders owner archives read-only without creating a fake private-chat target', async () => {
    const original = transport.call.getMockImplementation()!
    transport.call.mockImplementation(async (operation, input) => operation === 'world.reactions.prepare'
      ? { items: [{ recordRef: 'world-ref', target: { id: 'world-target', worldRecordRef: 'opaque-version' }, visibility: 'unpublished' }], unavailableRecordRefs: [] }
      : await original(operation, input))
    await mount()
    expect(ui!.root.findByType(ArkmeReactionPreview).props.readOnly).toBe(true)
    expect(ui!.root.findByType(ArkmeReactionSelections).props.readOnly).toBe(true)
    expect(JSON.stringify(ui!.toJSON())).toContain('仅你可查看')
  })
})
