import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { recordingWorkflowTools } from '../src/tools/business/recordings/workflow.js'
const success = (value: unknown) => new Response(JSON.stringify({ ok: true, value }), { headers: { 'Content-Type': 'application/json' } })
it('exports capability, account-scoped pagination, read watermark and exact version through the same Host', async () => {
  const calls: unknown[] = []
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); calls.push(body)
    return success(body.operation === 'provider.capabilities' ? { contractVersion: 1, features: { recordingWorkflowV1: true } } : body.params.operation === 'capabilities' ? { supported: true } : {})
  } })
  await sdk.recordingNotifications('next')
  await sdk.readRecordingNotifications({ accountKey: 'test:42', throughSequence: '12' })
  await sdk.recordingNotificationVersion('0123456789abcdef01234567', 'summary')
  expect(calls).toContainEqual({ operation: 'recordings.workflow', params: { operation: 'query', cursor: 'next' } })
  expect(calls).toContainEqual({ operation: 'recordings.workflow', params: { operation: 'read', accountKey: 'test:42', throughSequence: '12' } })
  expect(calls).toContainEqual({ operation: 'recordings.workflow', params: { operation: 'version', versionId: '0123456789abcdef01234567', kind: 'summary' } })
})
it('detects an older provider before issuing business calls', async () => {
  const fetchImpl = vi.fn(async () => success({ contractVersion: 1, features: {} }))
  expect(await createArkmeSdk({ fetchImpl }).recordingWorkflowCapabilities()).toEqual({ supported: false })
  expect(fetchImpl).toHaveBeenCalledOnce()
})
it('keeps read and mutation Tool grants separate', () => {
  expect(recordingWorkflowTools.map(module => module.meta)).toMatchObject([
    { toolName: 'arkme_recording_notifications', effect: 'read' },
    { toolName: 'arkme_recording_notifications_read', effect: 'write', grant: 'explicit-user-write' },
  ])
})
