import { expect, it, vi } from 'vitest'
import { SourceForwardAttempt } from '../src/client/source-forward-attempt.js'
import type { ForwardTarget } from '../src/client/unified-forward-targets.js'

const target = (kind: 'source' | 'team'): ForwardTarget => kind === 'team'
  ? { kind: 'team', conversation: { key: 'team-key', ref: 'scoped-team-ref' } } as ForwardTarget
  : { kind: 'source', source: { kind: 'private_chat', sourceKey: 'chat-key', sourceRef: 'scoped-chat-ref' } } as ForwardTarget
it('uses the real Team destination and freezes retry identity, source selection and comment', async () => {
  const sender = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValue({ itemUid: 'accepted', localState: 'synced' })
  const refs = ['saved-action']
  const attempt = new SourceForwardAttempt('source-ref', refs, 11, sender)
  refs.push('later-action')
  await expect(attempt.send(target('team'), ' comment ', new AbortController().signal)).rejects.toThrow('response lost')
  await attempt.send(target('team'), 'changed', new AbortController().signal)
  expect(sender.mock.calls[0]![0]).toEqual(sender.mock.calls[1]![0])
  expect(sender.mock.calls[0]![0]).toMatchObject({ sourceRef: 'source-ref', actionRefs: ['saved-action'], expectedUserId: 11,
    targetConversationRef: 'scoped-team-ref', commentText: 'comment' })
  expect(sender.mock.calls[0]![0]).not.toHaveProperty('targetSourceRef')
  await attempt.send(target('team'), 'changed again', new AbortController().signal)
  expect(sender).toHaveBeenCalledTimes(2)
})
it('retains partial comments, keeps independent ordinary destination identity and aborts before IO', async () => {
  const sender = vi.fn().mockResolvedValueOnce({ itemUid: 'accepted', localState: 'synced', warningText: 'comment unknown' })
    .mockResolvedValue({ itemUid: 'accepted', localState: 'synced' })
  const attempt = new SourceForwardAttempt('source-ref', ['action'], 11, sender)
  await attempt.send(target('source'), 'comment', new AbortController().signal)
  await attempt.send(target('source'), 'comment', new AbortController().signal)
  expect(sender.mock.calls[0]![0]).toEqual(sender.mock.calls[1]![0])
  await attempt.send(target('team'), 'comment', new AbortController().signal)
  expect(sender.mock.calls[2]![0].recordUid).not.toBe(sender.mock.calls[0]![0].recordUid)
  const cancelled = new AbortController(); cancelled.abort()
  await expect(attempt.send(target('team'), '', cancelled.signal)).rejects.toBeTruthy()
  expect(sender).toHaveBeenCalledTimes(3)
})
