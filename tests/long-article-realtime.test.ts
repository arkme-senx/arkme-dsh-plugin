import { afterEach, expect, it, vi } from 'vitest'
import { connectLongArticleRealtime } from '../src/client/long-article-realtime.js'
import { subscribeMessageQuoteInvalidations } from '../src/client/message-quote-invalidations.js'
const transport = vi.hoisted(() => ({ connect: vi.fn(), close: vi.fn() }))
vi.mock('../src/client/realtime-connection.js', () => ({ connectArkmeRealtime: transport.connect }))
afterEach(() => vi.clearAllMocks())
it('delivers native permission hints, reconciles reconnects and drops callbacks after account change/dispose', () => {
  transport.connect.mockReturnValue({ close: transport.close })
  const changes = vi.fn(), stopChanges = subscribeMessageQuoteInvalidations(changes)
  let current = true
  const stop = connectLongArticleRealtime(() => current)
  const callbacks = transport.connect.mock.calls[0]![0]
  callbacks.onOpen(); expect(changes).not.toHaveBeenCalled()
  const send = (value: unknown) => callbacks.onMessage({ data: JSON.stringify(value) })
  send({ type: 'timeline-changed', sourceKey: 'group-a' })
  expect(changes).toHaveBeenLastCalledWith('group-a')
  for (const type of ['chat-policy-invalidated', 'reconcile']) send({ type })
  send({ type: 'projection-invalidated', projection: 'record' })
  expect(changes).toHaveBeenCalledTimes(4)
  send({ type: 'message-notification' }); send({ type: 'read-receipts-invalidated' })
  send({ type: 'projection-invalidated', projection: 'message_annotations' })
  callbacks.onMessage({ data: '{' }); send(null)
  expect(changes).toHaveBeenCalledTimes(4)
  callbacks.onOpen(); expect(changes).toHaveBeenCalledTimes(5)
  current = false; send({ type: 'chat-policy-invalidated' }); expect(changes).toHaveBeenCalledTimes(5)
  current = true; stop(); send({ type: 'chat-policy-invalidated' }); callbacks.onOpen()
  expect(changes).toHaveBeenCalledTimes(5); expect(transport.close).toHaveBeenCalledOnce()
  stopChanges()
})
