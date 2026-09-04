import { describe, expect, it, vi } from 'vitest'
import {
  ConversationDirectoryVisibilityService,
  type ConversationDirectoryVisibilityInvalidationPort,
} from '../../src/services/conversation-directory-visibility-service.js'
import type {
  ConversationListPreferenceEntry,
  ConversationListPreferencePort,
  ConversationListPreferenceRef,
  ConversationListPreferenceSnapshot,
} from '../../src/services/conversation-list-preference-service.js'

const chatRef = { entityKind: 1 as const, entityUid: 'same' }
const botRef = { entityKind: 2 as const, entityUid: 'same' }

describe('ConversationDirectoryVisibilityService', () => {
  it.each([
    {
      name: 'keeps equal raw UIDs in different owner kinds independent',
      snapshots: [snapshot(chatRef, 2, 4, 100), snapshot(botRef, 1, 0, 0)],
      source: entry(chatRef, 4, 100),
      bot: entry(botRef, 0, 100),
      expected: [true, false],
    },
    {
      name: 'uses the newest evidence shared by a Chat-backed Bot and source row',
      snapshots: [snapshot(chatRef, 2, 4, 100)],
      source: entry(chatRef, 5, 101),
      bot: entry(chatRef, 4, 100),
      expected: [false, false],
    },
    {
      name: 'fails open when activity evidence is unavailable',
      snapshots: [snapshot(chatRef, 2, 4, 100)],
      source: entry(chatRef, 0, 0),
      bot: entry(botRef, 0, 0),
      expected: [false, false],
    },
  ])('$name', async ({ snapshots, source, bot, expected }) => {
    const service = createService(preferencePort(snapshots), source, bot)
    const result = await service.query(['source-ref'], ['bot-ref'])
    expect(result.items.map(item => item.hidden)).toEqual(expected)
  })

  it('shows newer activity immediately and clears only the stale owner revision', async () => {
    const preference = preferencePort([snapshot(chatRef, 2, 4, 100)])
    const service = createService(
      preference,
      entry(chatRef, 5, 101),
      entry(botRef, 0, 0),
    )

    await expect(service.query(['source-ref'], ['bot-ref'])).resolves.toEqual({ items: [
      { entryKind: 'source', entryRef: 'source-ref', hidden: false },
      { entryKind: 'bot', entryRef: 'bot-ref', hidden: false },
    ] })
    await vi.waitFor(() => {
      expect(preference.restoreIfUnchanged).toHaveBeenCalledWith(
        [snapshot(chatRef, 2, 4, 100)],
        { ownerUserId: 42 },
      )
    })
  })

  it('isolates one unmappable row while retaining valid owner results', async () => {
    const preference = preferencePort([snapshot(chatRef, 2, 4, 100)])
    const service = new ConversationDirectoryVisibilityService(
      preference,
      { chatConversationListPreferenceEntry: vi.fn(async () => entry(chatRef, 4, 100)) },
      {
        botConversationListPreferenceEntry: vi.fn(async () => { throw new Error('ambiguous') }),
        openBotChat: vi.fn(async () => { throw new Error('not used') }),
      },
      invalidationPort(),
    )

    await expect(service.query(['source-ref'], ['bot-ref'])).resolves.toEqual({ items: [
      { entryKind: 'source', entryRef: 'source-ref', hidden: true },
      { entryKind: 'bot', entryRef: 'bot-ref', hidden: false },
    ] })
    expect(preference.query).toHaveBeenCalledWith([chatRef], { ownerUserId: 42 })
  })

  it.each([
    new DOMException('The operation was aborted', 'AbortError'),
    Object.assign(new Error('account changed'), { code: 'login-context-changed' }),
  ])('propagates fatal resolution error %#', async fatal => {
    const preference = preferencePort([])
    const service = new ConversationDirectoryVisibilityService(
      preference,
      { chatConversationListPreferenceEntry: vi.fn(async () => { throw fatal }) },
      {
        botConversationListPreferenceEntry: vi.fn(async () => entry(botRef, 0, 100)),
        openBotChat: vi.fn(async () => { throw new Error('not used') }),
      },
      invalidationPort(),
    )

    await expect(service.query(['source-ref'], ['bot-ref'])).rejects.toBe(fatal)
    expect(preference.query).not.toHaveBeenCalled()
  })

  it('maps mutations, contact restore, and Bot owner handoff to exact typed identities', async () => {
    const preference = preferencePort([])
    const invalidation = invalidationPort()
    const service = createService(
      preference,
      entry({ entityKind: 1, entityUid: 'chat-1' }, 7, 101),
      entry({ entityKind: 2, entityUid: 'bot-1' }, 0, 100),
      invalidation,
    )

    await service.setVisibility('source', 'source-ref', true)
    await service.setVisibility('bot', 'bot-ref', false)
    await service.restoreSource({ sourceRef: 'source-ref' } as never)
    await service.restoreBotConversation(
      entry({ entityKind: 2, entityUid: 'bot-1' }, 0, 100),
      { sourceRef: 'source-ref' } as never,
    )

    expect(preference.dismiss).toHaveBeenCalledWith(
      { entityKind: 1, entityUid: 'chat-1' },
      { sequence: 7, activityAtMillis: 101 },
      { ownerUserId: 42 },
    )
    expect(preference.restore).toHaveBeenNthCalledWith(
      1,
      [{ entityKind: 2, entityUid: 'bot-1' }],
      { ownerUserId: 42 },
    )
    expect(preference.restore).toHaveBeenNthCalledWith(
      2,
      [{ entityKind: 1, entityUid: 'chat-1' }],
      { ownerUserId: 42 },
    )
    expect(preference.restore).toHaveBeenNthCalledWith(
      3,
      [
        { entityKind: 2, entityUid: 'bot-1' },
        { entityKind: 1, entityUid: 'chat-1' },
      ],
      { ownerUserId: 42 },
    )
    expect(invalidation.invalidateConversationListPreferenceForCurrentSession).toHaveBeenCalledTimes(4)
  })

  it('rejects a Bot owner handoff across login owners before mutating preferences', async () => {
    const preference = preferencePort([])
    const service = createService(
      preference,
      entry({ entityKind: 1, entityUid: 'chat-1' }, 7, 101),
      entry({ entityKind: 2, entityUid: 'bot-1' }, 0, 100),
    )

    await expect(service.restoreBotConversation(
      { ...entry({ entityKind: 2, entityUid: 'bot-1' }, 0, 100), ownerUserId: 99 },
      { sourceRef: 'source-ref' } as never,
    )).rejects.toMatchObject({ code: 'login-context-changed' })
    expect(preference.restore).not.toHaveBeenCalled()
  })

  it('rejects a Bot handoff between unrelated Chat identities', async () => {
    const preference = preferencePort([])
    const service = createService(
      preference,
      entry({ entityKind: 1, entityUid: 'chat-current' }, 7, 101),
      entry({ entityKind: 2, entityUid: 'bot-1' }, 0, 100),
    )

    await expect(service.restoreBotConversation(
      entry({ entityKind: 1, entityUid: 'chat-previous' }, 6, 100),
      { sourceRef: 'source-ref' } as never,
    )).rejects.toMatchObject({ code: 'bot-conversation-preference-identity-changed' })
    expect(preference.restore).not.toHaveBeenCalled()
  })

  it('does not turn accepted owner state into failure when local invalidation fails', async () => {
    const preference = preferencePort([])
    const service = createService(
      preference,
      entry(chatRef, 7, 101),
      entry(botRef, 0, 100),
      { invalidateConversationListPreferenceForCurrentSession: vi.fn(async () => {
        throw new Error('local invalidation unavailable')
      }) },
    )

    await expect(service.setVisibility('source', 'source-ref', true)).resolves.toBeUndefined()
    expect(preference.dismiss).toHaveBeenCalledOnce()
  })
})

function createService(
  preference: ReturnType<typeof preferencePort>,
  sourceEntry: ConversationListPreferenceEntry,
  botEntry: ConversationListPreferenceEntry,
  invalidation = invalidationPort(),
): ConversationDirectoryVisibilityService {
  return new ConversationDirectoryVisibilityService(
    preference,
    { chatConversationListPreferenceEntry: vi.fn(async () => sourceEntry) },
    {
      botConversationListPreferenceEntry: vi.fn(async () => botEntry),
      openBotChat: vi.fn(async () => { throw new Error('not used') }),
    },
    invalidation,
  )
}

function invalidationPort() {
  return {
    invalidateConversationListPreferenceForCurrentSession: vi.fn(async () => undefined),
  } satisfies ConversationDirectoryVisibilityInvalidationPort
}

function preferencePort(snapshots: ConversationListPreferenceSnapshot[]) {
  return {
    query: vi.fn(async () => snapshots),
    dismiss: vi.fn(async () => snapshots[0]!),
    restore: vi.fn(async () => undefined),
    restoreIfUnchanged: vi.fn(async () => undefined),
  } satisfies ConversationListPreferencePort
}

function entry(
  ref: ConversationListPreferenceRef,
  sequence: number,
  activityAtMillis: number,
): ConversationListPreferenceEntry {
  return { ownerUserId: 42, ref, evidence: { sequence, activityAtMillis } }
}

function snapshot(
  ref: ConversationListPreferenceRef,
  visibilityState: 1 | 2,
  sequence: number,
  activityAtMillis: number,
): ConversationListPreferenceSnapshot {
  return {
    ref,
    visibilityState,
    dismissedThroughSequence: sequence,
    dismissedThroughActivityAtMillis: activityAtMillis,
    revision: 1,
    updatedAtMillis: 110,
  }
}
