import { expect, it } from 'vitest'
import { dshRemoteOutboundPayloads } from '../src/dsh-remote/transport-fragment.js'

it('keeps empty arrays distinct from objects through legacy Redis JSON relays', () => {
  const envelope = { operation: 'session.history', body: { entries: [
    { event: { type: 'agent/inbox/spliced', seq: 31, data: { inserted: [], metadata: {} } } },
  ] } }
  const frames = dshRemoteOutboundPayloads(envelope, 'event-31')
  expect(frames).toHaveLength(2)
  const values = frames.map(frame => frame.value as Record<string, unknown>)
  expect(values[0]).toMatchObject({ protocol: 'dsh.remote-fragment', fragment_count: 2 })
  // Redis cjson changes empty arrays anywhere in an object payload into {}.
  const relayed = JSON.parse(JSON.stringify(values, (_key, value: unknown) =>
    Array.isArray(value) && value.length === 0 ? {} : value)) as typeof values
  expect(JSON.parse(Buffer.concat(relayed.map(frame => Buffer.from(String(frame.chunk), 'base64url'))).toString())).toEqual(envelope)
  const ordinary = { body: { text: 'reply', metadata: {} } }
  expect(dshRemoteOutboundPayloads(ordinary, 'ordinary')).toEqual([{ value: ordinary }])
})
