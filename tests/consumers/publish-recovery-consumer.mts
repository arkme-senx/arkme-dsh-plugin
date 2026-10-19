import { createArkmeSdk, ArkmeClientError, ARKME_PROVIDER_CONTRACT_VERSION, type ArkmeExtensionPublishPage, type ArkmeExtensionPublishResult } from '@senguoyun/dsh-arkme/sdk'

function check(value: unknown): asserts value { if (!value) throw new Error('Publication consumer assertion failed') }
const receipt: ArkmeExtensionPublishResult = { publish_session_id: 'pub_consumer', extension_id: 'ext_consumer', version: '1.0.0', status: 'validating', execution_state: 'failed', error_code: 'audit_model_unavailable', error_message: '审核模型不可用', can_resume: true }
const page: ArkmeExtensionPublishPage = { items: [receipt], limit: 20, offset: 0, has_more: false }
const calls: string[] = []
const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
  if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const request = JSON.parse(String(init?.body)); calls.push(request.operation)
  if (request.operation === 'extensions.publish.resume') return new Response(JSON.stringify({ ok: false, error: { code: 'audit_model_unavailable', message: receipt.error_message, retryable: false, publishReceipt: receipt } }), { status: 503 })
  return new Response(JSON.stringify({ ok: true, value: request.operation === 'provider.capabilities' ? { contractVersion: ARKME_PROVIDER_CONTRACT_VERSION, features: { extensionPublishRecovery: true } } : request.operation === 'extensions.publish.list' ? page : receipt }))
} })
check((await sdk.extensionPublishSessions()).items[0]?.publish_session_id === receipt.publish_session_id)
check((await sdk.extensionPublishStatus('pub_consumer')).execution_state === 'failed')
check(!calls.includes('extensions.publish.resume'))
try { await sdk.resumeExtensionPublish('pub_consumer'); throw new Error('expected failure') }
catch (error) { check(error instanceof ArkmeClientError && error.body.publishReceipt?.publish_session_id === 'pub_consumer') }
check(calls.filter(call => call === 'extensions.publish.resume').length === 1)
const abort = new AbortController(); abort.abort()
try { await sdk.extensionPublishStatus('pub_consumer', abort.signal); throw new Error('expected abort') }
catch (error) { check(error instanceof DOMException && error.name === 'AbortError') }
console.log('Packed public SDK publication consumer passed: types, read-only status, receipt, no automatic write retry, abort')
