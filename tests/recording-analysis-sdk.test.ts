import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { recordingAnalysisTools } from '../src/tools/business/recordings/analysis.js'
const success = (value: unknown) => new Response(JSON.stringify({ ok: true, value }))
it('detects old providers and exposes exact scene and frozen-task commands through one Host route', async () => {
 const calls: unknown[] = []
 const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
  const body = JSON.parse(String(init?.body)); calls.push(body)
  return success(body.operation === 'provider.capabilities' ? { contractVersion: 1, features: { recordingAnalysisV1: true } } : { accountScope: 'test:42' })
 } })
 await sdk.recordingAnalysis({ action: 'models', kind: 'timeline' })
 const binding = { catalogReleaseId: '11', offeringRevisionId: '22', publicModelCode: 'selected' }
 await sdk.recordingAnalysis({ action: 'generate', kind: 'timeline', accountScope: 'test:42', routeKey: 'dashscope/selected', dateStamp: 1790006400000, binding })
 expect(calls).toContainEqual({ operation: 'recordings.analysis', params: { action: 'generate', kind: 'timeline', accountScope: 'test:42', routeKey: 'dashscope/selected', dateStamp: 1790006400000, binding } })
 await sdk.recordingAnalysis({ action: 'generate', kind: 'summary', accountScope: 'test:42', routeKey: 'user-api/owned', dateStamp: 1790006400000 })
 expect(calls).toContainEqual({ operation: 'recordings.analysis', params: { action: 'generate', kind: 'summary', accountScope: 'test:42', routeKey: 'user-api/owned', dateStamp: 1790006400000 } })
 await sdk.recordingAnalysis({ action: 'continue', kind: 'timeline', accountScope: 'test:42', dateStamp: 1790006400000, versionId: '0123456789abcdef01234567' })
 expect(calls).toContainEqual({ operation: 'recordings.analysis', params: { action: 'continue', kind: 'timeline', accountScope: 'test:42', dateStamp: 1790006400000, versionId: '0123456789abcdef01234567' } })
 const fetchImpl = vi.fn(async () => success({ contractVersion: 1, features: {} }))
 await expect(createArkmeSdk({ fetchImpl }).recordingAnalysis({ action: 'models', kind: 'summary' })).rejects.toMatchObject({ body: { code: 'CAPABILITY_UNSUPPORTED' } })
 expect(fetchImpl).toHaveBeenCalledOnce()
})
it('keeps model query separate from user-authorized paid commands in the formal Tool registry', () => {
 expect(recordingAnalysisTools.map(module => module.meta)).toMatchObject([
  { toolName: 'arkme_recording_analysis_models', effect: 'read' },
  { toolName: 'arkme_recording_analysis', effect: 'write', grant: 'explicit-user-write' },
 ])
})
