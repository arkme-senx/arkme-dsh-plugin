import { describe, expect, it } from 'vitest'
import { verifyBundleResolutionSignature } from '../../src/extensions/signature.js'

describe('Bundle v2 cross-language signature contract', () => {
  it('verifies the fixed Go Ed25519 vector and rejects execution tampering', () => {
    const resolution = {
      artifact_contract_version: 2 as const,
      artifact_kind: 'dsh-bundle-tgz' as const,
      extension_id: 'ext_vector',
      package_name: '@example/vector',
      version: '1.2.3',
      execution_model: 'arkme-sandboxed' as const,
      bundle_sha256: 'a'.repeat(64),
      package_json_sha256: 'b'.repeat(64),
      source_sha256: 'c'.repeat(64),
      published_at: 1_780_000_000_000,
      signing_key_id: 'test-key-v2',
      signature: 'pMjXFbNirXQk1ku7k7VzU0cvVZHcQO5OSe/8ww5gOn0LTL6pbqD6l05uVh9krtmXiffo0CdjWkvDSva3yFpuAg==',
    }
    const keys = new Map([['test-key-v2', 'MYjXfeWcnqgSrWCgDzGLJiiMYz1RGuA/dbkm+TK027c=']])

    expect(() => verifyBundleResolutionSignature(resolution, keys)).not.toThrow()
    expect(() => verifyBundleResolutionSignature({ ...resolution, execution_model: 'dsh-native' }, keys))
      .toThrow('签名验证失败')
  })
})
