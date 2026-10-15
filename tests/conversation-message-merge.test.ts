import { describe, expect, it } from 'vitest'
import type { ArkmeSourceSendResult, ArkmeTimelineItem } from '../src/types.js'
import type { ArkmeUnifiedTimelineWindow } from '../src/unified-chat-timeline.js'
import { ArkmeConversationMessageMergeOwner, conversationMessageRenderKey, conversationMessageSendFailure, mergeConversationMessages } from '../src/client/conversation-message-merge.js'
import { unifiedTimelineSendOverlay } from '../src/client/unified-timeline-send-overlay.js'

const source = 'chat:one'
const pending = (id = 'local'): ArkmeTimelineItem => ({ itemUid: id, isMe: true, senderName: '我', textContent: id,
  sendAtMillis: 10, status: 0 })
const canonical = (id = 'local', sequence = 9, version = 1): ArkmeTimelineItem => ({ ...pending(id), status: 1, sequence,
  timelineEventId: `event:${id}`, timelineItemKey: `key:${id}`, timelineOrderTie: `relation:${id}`, messageActionRef: `action:${version}`,
  recordVersion: version, textContent: `canonical ${version}` })
const ack = (id = 'local'): ArkmeSourceSendResult => ({ sourceRef: source, itemUid: id, status: 1, sequence: 9, localState: 'synced' })
function page(items: ArkmeTimelineItem[]): ArkmeUnifiedTimelineWindow {
  return { protocolVersion: 1, complete: true, hasMore: false, olderHasMore: false, newerHasMore: false, windowTokens: ['window'],
    sources: [{ source: 'messages', status: 'ready', itemCount: items.length }],
    events: items.map(item => ({ kind: 'message', eventId: item.timelineEventId!, item, source: 'messages',
      occurredAtMillis: item.sendAtMillis, orderTie: item.timelineOrderTie!, contentStatus: 'available', windowToken: 'window' })) }
}

describe('conversation message merge ownership', () => {
  it.each([
    ['ack', 'live', 'read'], ['ack', 'read', 'live'], ['live', 'ack', 'read'],
    ['live', 'read', 'ack'], ['read', 'ack', 'live'], ['read', 'live', 'ack'],
  ])('keeps one stable message across %s / %s / %s', (...events) => {
    const owner = new ArkmeConversationMessageMergeOwner()
    const local = owner.begin(source, pending(), 'relation:local')
    let rows = [local]
    for (const event of events) {
      rows = event === 'ack' ? owner.confirm(source, 'local', ack(), local, rows)
        : owner.merge(source, event === 'live' ? [canonical()] : [], Date.now(), rows, event === 'read' ? page([]) : undefined)
      expect(rows).toHaveLength(1)
      expect(conversationMessageRenderKey(rows[0]!)).toBe('message:local')
    }
    rows = owner.merge(source, [canonical()], Date.now(), rows, page([canonical()]))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 1, sequence: 9, timelineEventId: 'event:local' })
    expect(conversationMessageRenderKey(rows[0]!)).toBe('message:local')
  })

  it('upserts an ACK after the current view lost its candidate and maps a returned ID in place', () => {
    const owner = new ArkmeConversationMessageMergeOwner()
    const local = owner.begin(source, pending(), 'relation:local')
    let rows = owner.confirm(source, 'local', ack('server-id'), local, [])
    expect(rows.map(item => item.itemUid)).toEqual(['server-id'])
    expect(conversationMessageRenderKey(rows[0]!)).toBe('message:local')
    const remote = { ...canonical('server-id'), timelineOrderTie: 'relation:local' }
    rows = owner.merge(source, [remote], Date.now(), rows, page([remote]))
    expect(rows).toHaveLength(1)
    expect(conversationMessageRenderKey(rows[0]!)).toBe('message:local')
  })

  it('never rolls a newer live record back when an older read or ACK arrives', () => {
    const owner = new ArkmeConversationMessageMergeOwner()
    const local = owner.begin(source, pending(), 'relation:local')
    let rows = owner.merge(source, [canonical('local', 9, 3)])
    rows = owner.confirm(source, 'local', ack(), local, rows)
    rows = owner.merge(source, [canonical('local', 9, 1)], Date.now(), rows)
    expect(rows[0]).toMatchObject({ recordVersion: 3, textContent: 'canonical 3', messageActionRef: 'action:3' })
  })

  it('keeps separate occurrences of the same record and assigns the send identity only to its relation', () => {
    const owner = new ArkmeConversationMessageMergeOwner()
    owner.begin(source, pending(), 'relation:local')
    const repeated = { ...canonical(), timelineEventId: 'second-occurrence', timelineOrderTie: 'other-relation' }
    const rows = owner.merge(source, [canonical(), repeated])
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map(conversationMessageRenderKey)).size).toBe(2)
    expect(conversationMessageRenderKey(rows.find(item => item.timelineEventId === 'event:local')!)).toBe('message:local')
  })

  it('does not revive an explicitly removed local send or an omission proven by complete coverage', () => {
    const owner = new ArkmeConversationMessageMergeOwner()
    const local = owner.begin(source, pending(), 'relation:local')
    owner.confirm(source, 'local', ack(), local, [])
    owner.merge(source, [canonical()])
    owner.removeOccurrences(source, new Set(['key:local']))
    expect(owner.merge(source, [])).toEqual([])
    const next = owner.begin(source, pending('next'))
    owner.confirm(source, 'next', ack('next'), next, [])
    const coverage = [canonical('older', 8), canonical('newer', 10)]
    owner.merge(source, coverage, Date.now(), [], page(coverage))
    expect(owner.merge(source, [])).toEqual([])
  })

  it('retains a stale-tail send without injecting it into an unrelated older window', () => {
    const owner = new ArkmeConversationMessageMergeOwner()
    const local = owner.begin(source, pending())
    owner.confirm(source, 'local', ack(), local, [])
    const stale = page([canonical('older', 8)])
    expect(unifiedTimelineSendOverlay(stale, owner.merge(source, [canonical('older', 8)], Date.now(), [], stale)))
      .toHaveLength(1)
    const newer = page([canonical('newer', 20)])
    expect(unifiedTimelineSendOverlay(newer, owner.merge(source, [canonical('newer', 20)], Date.now(), [], newer)))
      .toEqual([])
  })

  it.each([false, true])('retains failure (uncertain=%s) through reads and clears it on an in-place retry', uncertain => {
    const owner = new ArkmeConversationMessageMergeOwner()
    const local = owner.begin(source, pending())
    let rows = owner.fail(source, 'local', 'offline', uncertain, [local])
    rows = owner.merge(source, [], Date.now(), rows, page([]))
    expect(rows).toHaveLength(1)
    expect(conversationMessageSendFailure(rows[0]!)).toEqual({ state: uncertain ? 'uncertain' : 'failed', message: 'offline' })
    const retry = owner.begin(source, pending())
    rows = mergeConversationMessages(rows, [retry])
    expect(conversationMessageSendFailure(rows[0]!)).toBeUndefined()
    expect(conversationMessageRenderKey(rows[0]!)).toBe(conversationMessageRenderKey(local))
    rows = owner.confirm(source, 'local', ack(), retry, rows)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe(1)
  })

  it('keeps live success when the HTTP response fails and accepts later confirmation of an uncertain send', () => {
    const owner = new ArkmeConversationMessageMergeOwner()
    owner.begin(source, pending())
    owner.merge(source, [canonical()])
    expect(conversationMessageSendFailure(owner.fail(source, 'local', 'timeout', true, [])[0]!)).toBeUndefined()
    owner.begin(source, pending('second'))
    owner.fail(source, 'second', 'timeout', true, [])
    const rows = owner.merge(source, [canonical('second')])
    expect(conversationMessageSendFailure(rows.find(item => item.itemUid === 'second')!)).toBeUndefined()
  })

  it('does not resurrect a live message deleted before its delayed ACK', () => {
    const owner = new ArkmeConversationMessageMergeOwner()
    const local = owner.begin(source, pending())
    owner.merge(source, [canonical()])
    owner.removeOccurrences(source, new Set(['key:local']))
    expect(owner.confirm(source, 'local', ack(), local, [])).toEqual([])
    expect(owner.merge(source, [])).toEqual([])
  })

  it('preserves a newer live polish and capture metadata after a late ACK and stale refresh', () => {
    const owner = new ArkmeConversationMessageMergeOwner()
    const local = owner.begin(source, pending())
    const live = { ...canonical('local', 9, 3), aiPolish: { state: 'polished' as const, originalText: 'original', polishedText: 'new polish' }, textContent: 'new polish' }
    owner.merge(source, [live])
    owner.confirm(source, 'local', { ...ack(), aiPolish: { state: 'polished', originalText: 'original', polishedText: 'old polish' } }, { ...local, recordDurationMillis: 300 }, [])
    const rows = owner.merge(source, [canonical('local', 9, 1)])
    expect(rows[0]).toMatchObject({ textContent: 'new polish', recordVersion: 3, recordDurationMillis: 300, aiPolish: live.aiPolish })
  })

  it('isolates conversations, clears account state, and releases a failed or transferred submission', () => {
    const owner = new ArkmeConversationMessageMergeOwner()
    owner.begin(source, pending())
    expect(owner.merge('chat:other', [])).toEqual([])
    owner.releasePending(source, 'local')
    expect(owner.merge(source, [])).toEqual([])
    owner.begin(source, pending())
    owner.clear()
    expect(owner.merge(source, [])).toEqual([])
  })

  it('bounds retained sends without evicting in-flight requests and keeps presentation after retention expires', () => {
    const owner = new ArkmeConversationMessageMergeOwner(2)
    const one = owner.begin(source, pending('one'))
    owner.begin(source, pending('two'))
    expect(() => owner.assertCanBegin()).toThrow('正在发送的消息较多')
    expect(owner.merge(source, [], Date.now() + 120_000)).toHaveLength(2)
    owner.confirm(source, 'one', ack('one'), one, [])
    let rows = owner.merge(source, [canonical('one')])
    const renderKey = conversationMessageRenderKey(rows.find(item => item.itemUid === 'one')!)
    rows = owner.merge(source, [canonical('one')], Date.now() + 120_000, rows)
    expect(conversationMessageRenderKey(rows.find(item => item.itemUid === 'one')!)).toBe(renderKey)
    owner.begin(source, pending('three'))
    expect(owner.merge(source, []).map(item => item.itemUid)).toEqual(expect.arrayContaining(['two', 'three']))
  })
})
