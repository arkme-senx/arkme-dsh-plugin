import { describe, expect, it } from 'vitest'
import {
  applyConversationVisibilityQueryFailure,
  applyConversationVisibilityQuerySuccess,
  conversationBotActivityEvidence,
  conversationSourceActivityEvidence,
  conversationVisibilityActivityAdvanced,
  conversationVisibilityKey,
  conversationVisibilityScope,
  dismissConversationVisibilityEntry,
  emptyConversationVisibilityOverlay,
  markConversationVisibilityScopeHydrated,
} from '../src/client/conversation-directory-visibility-overlay.js'
import type { ArkmeBotSummary, ArkmeSourceItem } from '../src/types.js'

const source = (sourceRef: string, sourceKey = 'stable-source') => ({
  sourceRef,
  sourceKey,
  kind: 'private_chat' as const,
  displayName: '联系人',
  activeAtMillis: 100,
  unreadCount: 0,
}) satisfies ArkmeSourceItem

const bot = (botRef: string, directoryKey = 'stable-bot') => ({
  botRef,
  directoryKey,
  name: 'Bot',
  provider: 'openclaw' as const,
  description: '',
  status: 'online' as const,
  directChatAvailable: true,
}) satisfies ArkmeBotSummary

describe('conversation directory visibility overlay', () => {
  it('withholds newly loaded rows until their owner visibility query settles', () => {
    const first = conversationVisibilityScope([source('source-ref-a', 'source-a')], [])
    const second = conversationVisibilityScope([], [bot('bot-ref-b', 'bot-b')])
    let hydrated = markConversationVisibilityScopeHydrated(new Set(), first)

    expect(hydrated.has(conversationVisibilityKey('source', 'source-a'))).toBe(true)
    expect(hydrated.has(conversationVisibilityKey('bot', 'bot-b'))).toBe(false)

    hydrated = markConversationVisibilityScopeHydrated(hydrated, second)
    expect(hydrated.has(conversationVisibilityKey('source', 'source-a'))).toBe(true)
    expect(hydrated.has(conversationVisibilityKey('bot', 'bot-b'))).toBe(true)
  })

  it('retains confirmed hidden rows while a refresh is pending and across rotating refs', () => {
    const first = conversationVisibilityScope([source('source-ref-v1')], [bot('bot-ref-v1')])
    let overlay = applyConversationVisibilityQuerySuccess(emptyConversationVisibilityOverlay(), first, {
      items: [
        { entryKind: 'source', entryRef: 'source-ref-v1', hidden: true },
        { entryKind: 'bot', entryRef: 'bot-ref-v1', hidden: true },
      ],
    })
    const next = conversationVisibilityScope([source('source-ref-v2')], [bot('bot-ref-v2')])

    expect(overlay.has(conversationVisibilityKey('source', 'stable-source'))).toBe(true)
    expect(overlay.has(conversationVisibilityKey('bot', 'stable-bot'))).toBe(true)
    expect(next.sourceRefs).toEqual(['source-ref-v2'])
    expect(next.botRefs).toEqual(['bot-ref-v2'])
    expect(overlay.has(conversationVisibilityKey('source', 'stable-source'))).toBe(true)
    expect(overlay.has(conversationVisibilityKey('bot', 'stable-bot'))).toBe(true)

    overlay = applyConversationVisibilityQuerySuccess(overlay, next, {
      items: [
        { entryKind: 'source', entryRef: 'source-ref-v2', hidden: true },
        { entryKind: 'bot', entryRef: 'bot-ref-v2', hidden: true },
      ],
    })
    expect(overlay.has(conversationVisibilityKey('source', 'stable-source'))).toBe(true)
    expect(overlay.has(conversationVisibilityKey('bot', 'stable-bot'))).toBe(true)
  })

  it('fails open for the affected scope when a refresh fails outside a local dismissal', () => {
    const first = conversationVisibilityScope([source('source-ref-a', 'source-a')], [bot('bot-ref-a', 'bot-a')])
    const second = conversationVisibilityScope([source('source-ref-b', 'source-b')], [bot('bot-ref-b', 'bot-b')])
    let overlay = emptyConversationVisibilityOverlay()
    overlay = dismissConversationVisibilityEntry(overlay, 'source', 'source-a')
    overlay = dismissConversationVisibilityEntry(overlay, 'source', 'source-b')
    overlay = dismissConversationVisibilityEntry(overlay, 'bot', 'bot-a')
    overlay = dismissConversationVisibilityEntry(overlay, 'bot', 'bot-b')

    overlay = applyConversationVisibilityQueryFailure(overlay, first)

    expect([...overlay]).toEqual([
      conversationVisibilityKey('source', 'source-b'),
      conversationVisibilityKey('bot', 'bot-b'),
    ])
    expect(second.sourceRefs).toEqual(['source-ref-b'])
  })

  it('does not let a failed query started during dismissal clear the later accepted overlay', () => {
    const scope = conversationVisibilityScope([source('source-ref')], [bot('bot-ref')])
    const protectedSource = conversationVisibilityKey('source', 'stable-source')
    const hiddenBot = conversationVisibilityKey('bot', 'stable-bot')
    const overlay = applyConversationVisibilityQueryFailure(
      new Set([protectedSource, hiddenBot]),
      scope,
      new Set([protectedSource]),
    )

    expect([...overlay]).toEqual([protectedSource, hiddenBot])
  })

  it('keeps earlier confirmed hidden rows when the refresh after another dismissal fails', () => {
    const scope = conversationVisibilityScope([
      source('source-ref-a', 'source-a'),
      source('source-ref-b', 'source-b'),
      source('source-ref-c', 'source-c'),
    ], [])
    const protectedSource = conversationVisibilityKey('source', 'source-c')
    let overlay = applyConversationVisibilityQueryFailure(
      new Set([
        conversationVisibilityKey('source', 'source-a'),
        conversationVisibilityKey('source', 'source-b'),
      ]),
      scope,
      new Set([protectedSource]),
    )

    overlay = dismissConversationVisibilityEntry(overlay, 'source', 'source-c')

    expect([...overlay]).toEqual([
      conversationVisibilityKey('source', 'source-a'),
      conversationVisibilityKey('source', 'source-b'),
      protectedSource,
    ])
  })

  it('adds the stable presentation identity only after an accepted local dismissal', () => {
    let overlay = emptyConversationVisibilityOverlay()
    overlay = dismissConversationVisibilityEntry(overlay, 'source', 'stable-source')
    overlay = dismissConversationVisibilityEntry(overlay, 'bot', 'stable-bot')

    expect([...overlay]).toEqual([
      conversationVisibilityKey('source', 'stable-source'),
      conversationVisibilityKey('bot', 'stable-bot'),
    ])
  })

  it('keeps accepted source-device feedback visible while a realtime query converges', () => {
    const scope = conversationVisibilityScope([source('source-ref')], [bot('bot-ref')])
    const protectedKeys = new Set([
      conversationVisibilityKey('source', 'stable-source'),
      conversationVisibilityKey('bot', 'stable-bot'),
    ])
    const overlay = applyConversationVisibilityQuerySuccess(
      emptyConversationVisibilityOverlay(),
      scope,
      { items: [
        { entryKind: 'source', entryRef: 'source-ref', hidden: true },
        { entryKind: 'bot', entryRef: 'bot-ref', hidden: true },
      ] },
      protectedKeys,
    )

    expect([...overlay]).toEqual([])
  })

  it('does not let a query started during dismissal overwrite the later accepted overlay', () => {
    const scope = conversationVisibilityScope([source('source-ref')], [bot('bot-ref')])
    const protectedSource = conversationVisibilityKey('source', 'stable-source')
    const overlay = applyConversationVisibilityQuerySuccess(
      new Set([protectedSource]),
      scope,
      { items: [
        { entryKind: 'source', entryRef: 'source-ref', hidden: false },
        { entryKind: 'bot', entryRef: 'bot-ref', hidden: true },
      ] },
      new Set([protectedSource]),
    )

    expect([...overlay]).toEqual([
      protectedSource,
      conversationVisibilityKey('bot', 'stable-bot'),
    ])
  })

  it('detects owner activity that advances while accepted-removal feedback is still visible', () => {
    const beforeSource = conversationSourceActivityEvidence(source('source-ref'))
    const afterSource = conversationSourceActivityEvidence({
      ...source('source-ref'), activeAtMillis: 101, latestSequence: 2,
    })
    const beforeBot = conversationBotActivityEvidence({
      ...bot('bot-ref'), createdAtMillis: 100, conversationListActivityAtMillis: 100,
    })
    const afterBot = conversationBotActivityEvidence({
      ...bot('bot-ref'), createdAtMillis: 100, conversationListActivityAtMillis: 101,
    })

    expect(conversationVisibilityActivityAdvanced(beforeSource, afterSource)).toBe(true)
    expect(conversationVisibilityActivityAdvanced(beforeBot, afterBot)).toBe(true)
    expect(conversationVisibilityActivityAdvanced(afterBot, beforeBot)).toBe(false)
  })
})
