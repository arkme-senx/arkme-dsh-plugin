import { describe, expect, it } from 'vitest'
import {
  arkmeMessageActionCopyText,
  arkmeMessageActionConversationRef,
  arkmeMessageActionSelection,
  arkmeMessageActionStableRequestIds,
  arkmeToggleMessageActionSelection,
  type ArkmeMessageActionViewItem,
} from '../src/client/ArkmeMessageActions.js'

const item = (id: string, overrides: Partial<ArkmeMessageActionViewItem> = {}): ArkmeMessageActionViewItem => ({
  id,
  actionRef: `action-${id}`,
  conversationRef: 'conversation-one',
  copyText: `text-${id}`,
  copyLinkAvailable: true,
  forwardAvailable: true,
  ...overrides,
})

describe('Arkme shared message action selection', () => {
  it('keeps timeline order and drops stale or unavailable selection members', () => {
    expect(arkmeMessageActionSelection(
      [item('first'), item('pending', { actionRef: '' }), item('second')],
      new Set(['second', 'missing', 'pending', 'first']),
    ).map(value => value.id)).toEqual(['first', 'second'])
  })

  it('caps selection at 100 and exits when the last item is toggled off', () => {
    const selected = new Set(Array.from({ length: 100 }, (_, index) => `message-${String(index)}`))
    expect(arkmeToggleMessageActionSelection(selected, 'overflow', 100)).toEqual(selected)
    expect(arkmeToggleMessageActionSelection(new Set(['only']), 'only', 100)).toBeUndefined()
  })

  it('copies only user-visible final text and never reasoning', () => {
    expect(arkmeMessageActionCopyText(item('assistant', { copyText: '最终正文' }))).toBe('最终正文')
    expect(arkmeMessageActionCopyText(item('blank', { copyText: '   ' }))).toBe('')
  })

  it('uses each Agent message session capability and rejects a cross-session batch', () => {
    expect(arkmeMessageActionConversationRef([
      item('one', { conversationRef: 'agent-session-one' }),
    ])).toBe('agent-session-one')
    expect(arkmeMessageActionConversationRef([
      item('one', { conversationRef: 'agent-session-one' }),
      item('two', { conversationRef: 'agent-session-two' }),
    ])).toBeUndefined()
  })

  it('reuses per-target request identities while the selection key is unchanged', () => {
    const first = arkmeMessageActionStableRequestIds(undefined, 'conversation\u0000a,b', ['target-a', 'target-b'])
    const retry = arkmeMessageActionStableRequestIds(first, 'conversation\u0000a,b', ['target-b', 'target-a'])
    const changed = arkmeMessageActionStableRequestIds(first, 'conversation\u0000a,c', ['target-a'])

    expect(retry.ids).toEqual(first.ids)
    expect(changed.ids['target-a']).not.toBe(first.ids['target-a'])
    expect(retry.ids['target-a']?.sendAtMillis).toBe(first.ids['target-a']?.sendAtMillis)
  })
})
