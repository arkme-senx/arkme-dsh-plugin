import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeExtensionManager } from '../../src/extensions/manager.js'
import { ArkmeExtensionInstallStore } from '../../src/extensions/install-store.js'
import { ExtensionPublishClient } from '../../src/extensions/publish-client.js'
import { ArkmePluginError, ArkmeUpstreamResponseError } from '../../src/services/service.js'
import { publishFailure } from '../../src/extensions/publish-failure.js'
import { materializeCordisBundle } from '../../src/extensions/bundle-materializer.js'
import { packLocalNativeBundleDirectoryV3 } from '../../src/extensions/bundle-artifact.js'

const receipt = { publish_session_id: 'pub_recovery', extension_id: 'ext_recovery', version: '1.0.0', status: 'validating' as const, execution_state: 'failed' as const, error_code: 'audit_model_unavailable', error_message: '审核模型不可用', can_resume: true }

describe('publish failure receipts and explicit recovery', () => {
  it.each(['publish', 'bundle', 'native'] as const)('%s preserves completion evidence when the recovery read fails', async (entry) => {
    const root = mkdtempSync(join(tmpdir(), 'publish-recovery-'))
    const store = new ArkmeExtensionInstallStore(join(root, 'state'))
    const outcome = { ...receipt, status: 'audit_rejected' as const, execution_state: 'interrupted' as const }
    let completionError: Error = new ArkmeUpstreamResponseError('audit-error', '审核中断', true, 503, { ...outcome, token: 'SECRET' })
    let recovered = false
    const client = new ExtensionPublishClient(async <T>(path: string): Promise<T> => {
      if (path.endsWith('/create')) return { ...receipt, status: 'validating' } as T
      if (path.endsWith('/complete')) throw completionError
      if (path.endsWith('/status') && recovered) return { ...receipt, status: 'published', execution_state: 'published' } as T
      throw new Error('status unavailable')
    })
    const manager = new ArkmeExtensionManager(client, store, {
      inspectPackage: (_agent, pluginId, packageId) => ({ pluginId, packageId, name: '示例', purpose: '示例', code: { host: 'return { name: "x", apply() {} }' } }),
      define: () => { throw new Error('unused') }, run: async () => { throw new Error('unused') },
    }, { artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}' })
    const input = { name: '示例', description: '示例', version: '1.0.0', visibility: 'private' as const, idempotencyKey: 'same-session' }
    const source = materializeCordisBundle({ packageName: '@example/recovery', ...input, hostCode: 'return { name: "x", apply() {} }' })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@example/recovery', version: '1.0.0', files: ['cordis.patch.yml'], dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    writeFileSync(join(root, 'cordis.patch.yml'), '- id: compaction-basic\n  disabled: true\n')
    const nativeSource = packLocalNativeBundleDirectoryV3(root)
    const publish = () => entry === 'publish'
      ? manager.publish({ ...input, agent: {}, pluginId: 'plug-1', packageId: 'pkg-1' })
      : entry === 'bundle' ? manager.publishBundleSource({ ...input, source })
        : manager.publishNativeBundleSource({ ...input, source: nativeSource })
    try {
      await expect(publish()).rejects.toMatchObject({ publishReceipt: outcome, retryable: false })
      await publish().catch(error => expect(JSON.stringify(error.publishReceipt)).not.toContain('SECRET'))
      recovered = true
      await expect(publish()).resolves.toMatchObject({ status: 'published', execution_state: 'published' })
      recovered = false
      completionError = new Error('response lost')
      await expect(publish()).rejects.toMatchObject({ message: 'response lost', publishReceipt: { publish_session_id: receipt.publish_session_id, status: 'validating', execution_state: 'unknown' } })
    } finally { store.close(); rmSync(root, { recursive: true, force: true }) }
  })

  it('retains the audit failure when status still says validating', async () => {
    const root = mkdtempSync(join(tmpdir(), 'publish-recovery-'))
    const store = new ArkmeExtensionInstallStore(root)
    const client = new ExtensionPublishClient(async <T>(path: string): Promise<T> => {
      if (path.endsWith('/create')) return { ...receipt, status: 'validating' } as T
      if (path.endsWith('/complete')) throw new ArkmeUpstreamResponseError('arkme-code-50341', '审核模型不可用', true, 503, { ...receipt, upload_url: 'SECRET', audit_evidence: ['PRIVATE SOURCE'] })
      if (path.endsWith('/status')) return receipt as T
      throw new Error(path)
    })
    const manager = new ArkmeExtensionManager(client, store, {
      inspectPackage: (_agent, pluginId, packageId) => ({ pluginId, packageId, name: '示例', purpose: '示例', code: { host: 'return { name: "x", apply() {} }' } }),
      define: () => { throw new Error('unused') }, run: async () => { throw new Error('unused') },
    }, { artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}' })
    try {
      await expect(manager.publish({ agent: { id: 'session-1' }, pluginId: 'plug-1', packageId: 'pkg-1', name: '示例', description: '示例', version: '1.0.0', visibility: 'private', idempotencyKey: 'same-session' })).rejects.toMatchObject({ message: '审核模型不可用', retryable: false, publishReceipt: receipt })
    } finally { store.close(); rmSync(root, { recursive: true, force: true }) }
  })

  it('projects only safe receipt fields and preserves diagnostics across older status responses', () => {
    const first = publishFailure(new ArkmeUpstreamResponseError('code', '原始错误', true, 503, { ...receipt, token: 'SECRET', source_files: ['PRIVATE'] }))
    const second = publishFailure(first, { publish_session_id: receipt.publish_session_id, extension_id: receipt.extension_id, version: receipt.version, status: 'validating' })
    expect(second.publishReceipt).toMatchObject(receipt)
    expect(JSON.stringify(second.publishReceipt)).not.toMatch(/SECRET|PRIVATE/)
    expect(second.retryable).toBe(false)
  })

  it('does not issue recovery writes to an older publication service', async () => {
    const post = vi.fn(async <T>(_path: string): Promise<T> => ({ items: [], total: 0 }) as T)
    const client = new ExtensionPublishClient(post)
    await expect(client.resumePublishSession(receipt.publish_session_id)).rejects.toMatchObject({ code: 'capability-unsupported' })
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0]?.[0]).toBe('/api/v1/extensions/my-list')
  })

  it('performs exactly one resume and preserves a failure receipt', async () => {
    const calls: string[] = []
    const client = new ExtensionPublishClient(async <T>(path: string): Promise<T> => {
      calls.push(path)
      if (path.endsWith('/my-list')) return { items: [], total: 0, publication_capabilities: { publish_recovery: true } } as T
      throw new ArkmeUpstreamResponseError('code', '失败', true, 503, receipt)
    })
    await expect(client.resumePublishSession(receipt.publish_session_id)).rejects.toBeInstanceOf(ArkmePluginError)
    expect(calls).toEqual(['/api/v1/extensions/my-list', '/api/v1/extensions/publish-session/resume'])
  })

  it('retains the session identity when recovery loses its HTTP response', async () => {
    const root = mkdtempSync(join(tmpdir(), 'publish-recovery-'))
    const store = new ArkmeExtensionInstallStore(root)
    const client = new ExtensionPublishClient(async <T>(path: string): Promise<T> => {
      if (path.endsWith('/status')) return receipt as T
      if (path.endsWith('/my-list')) return { items: [], publication_capabilities: { publish_recovery: true } } as T
      throw new Error('连接中断，请查询状态')
    })
    const manager = new ArkmeExtensionManager(client, store, {} as never, { artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}' })
    try {
      await expect(manager.resumePublish(receipt.publish_session_id)).rejects.toMatchObject({ message: '连接中断，请查询状态', retryable: false, publishReceipt: { publish_session_id: receipt.publish_session_id, extension_id: receipt.extension_id, version: '1.0.0' } })
    } finally { store.close(); rmSync(root, { recursive: true, force: true }) }
  })
  it('polls accepted attempts with reads only and returns the durable terminal result', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const client = new ExtensionPublishClient(async <T>(path: string): Promise<T> => {
      calls.push(path)
      if (path.endsWith('/complete')) return { ...receipt, execution_state: 'running', can_resume: false } as T
      if (path.endsWith('/status')) return { ...receipt, status: 'published', execution_state: 'published' } as T
      throw new Error(path)
    })
    try {
      const pending = client.completePublishSession(receipt.publish_session_id)
      await vi.advanceTimersByTimeAsync(2_000)
      await expect(pending).resolves.toMatchObject({ status: 'published' })
      expect(calls).toEqual(['/api/v1/extensions/publish-session/complete', '/api/v1/extensions/publish-session/status'])
    } finally { vi.useRealTimers() }
  })

  it('preserves a later audit failure and never resubmits an accepted write', async () => {
    vi.useFakeTimers()
    const post = vi.fn(async <T>(path: string): Promise<T> => (path.endsWith('/complete') ? { ...receipt, execution_state: 'running' } : receipt) as T)
    const client = new ExtensionPublishClient(post)
    try {
      const pending = expect(client.completePublishSession(receipt.publish_session_id)).rejects.toMatchObject({ message: receipt.error_message, publishReceipt: receipt })
      await vi.advanceTimersByTimeAsync(2_000)
      await pending
      expect(post).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

})
