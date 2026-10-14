function assert(value: unknown): asserts value { if (!value) throw new Error('Assertion failed') }
import { createArkmeSdk, recordingImportBatchID, type RecordingWorkflowPage } from '@senguoyun/dsh-arkme/sdk'
const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
const page: RecordingWorkflowPage = { supported: true, accountKey: 'test:42', items: [], total: 0, unreadCount: 0, readThrough: '', nextCursor: '' }
const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
  const call = JSON.parse(String(init?.body)); calls.push(call)
  const value = call.operation === 'provider.capabilities' ? { contractVersion: 1, features: { recordingWorkflowV2: true } } : call.params?.operation === 'capabilities' ? { supported: true } : call.params?.operation === 'query' ? page : undefined
  return new Response(JSON.stringify({ ok: true, value }), { headers: { 'Content-Type': 'application/json' } })
} })
assert((await sdk.recordingNotifications()).accountKey === 'test:42')
await sdk.readRecordingNotifications({ accountKey: 'test:42', readThrough: '0123456789abcdef01234567:3' })
assert(calls.some(call => call.params?.operation === 'read' && call.params?.readThrough === '0123456789abcdef01234567:3'))
console.log('public recording workflow consumer: passed')

await sdk.readRecordingNotifications({ accountKey: 'test:42', items: [{ id: '0123456789abcdef01234567', sequence: '3' }] })
assert(calls.some(call => call.params?.operation === 'read' && Array.isArray(call.params?.items)))

assert(/^[0-9a-f]{8}-[0-9a-f]{4}-7/.test(recordingImportBatchID()))
