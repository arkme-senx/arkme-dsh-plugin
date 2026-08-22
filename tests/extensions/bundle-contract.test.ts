import { describe, expect, it } from 'vitest'
import { verifyBundleResolutionSignature, verifyNativeBundleResolutionSignature } from '../../src/extensions/signature.js'

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

describe('Native Bundle v3 cross-language signature contract', () => {
  it('verifies the fixed Go Ed25519 vector and rejects capability tampering', () => {
    const resolution = {
      artifact_contract_version: 3 as const,
      artifact_kind: 'dsh-native-package-tgz' as const,
      extension_id: 'ext_native_vector',
      package_name: '@example/native-vector',
      version: '2.0.0',
      execution_model: 'dsh-native' as const,
      bundle_sha256: 'd'.repeat(64),
      package_json_sha256: 'e'.repeat(64),
      source_sha256: 'f'.repeat(64),
      native_capabilities: ['bin', 'lifecycle_scripts', 'runtime_dependencies'] as const,
      published_at: 1_780_000_000_999,
      signing_key_id: 'test-key-v3',
      signature: 'wIFX8W1mgSAua6J9Hv+XGp5etUn/jLQG1iKcLLgjVDrAE+5OQvLf2WMHd/VjtU2as2sQnvpT1u+FpIwl7RfYCg==',
    }
    const keys = new Map([['test-key-v3', 'MYjXfeWcnqgSrWCgDzGLJiiMYz1RGuA/dbkm+TK027c=']])

    expect(() => verifyNativeBundleResolutionSignature({
      ...resolution, native_capabilities: [...resolution.native_capabilities],
    }, keys)).not.toThrow()
    expect(() => verifyNativeBundleResolutionSignature({
      ...resolution, native_capabilities: ['bin', 'runtime_dependencies'],
    }, keys)).toThrow('签名验证失败')
  })

  it('verifies the Go empty-capability vector with the canonical field omitted', () => {
    const resolution = {
      artifact_contract_version: 3 as const,
      artifact_kind: 'dsh-native-package-tgz' as const,
      extension_id: 'ext_native_empty_vector',
      package_name: '@example/native-empty',
      version: '2.0.0',
      execution_model: 'dsh-native' as const,
      bundle_sha256: 'd'.repeat(64),
      package_json_sha256: 'e'.repeat(64),
      source_sha256: 'f'.repeat(64),
      native_capabilities: [],
      published_at: 1_780_000_001_999,
      signing_key_id: 'test-key-v3-empty',
      signature: '+9EIKMHLt7jVJDjt/vG7v5QwruQbCSeJDPOjl62ERss6/E2r06TBjZ1bzaRL0X3EihzdRctgbEP8awO7mM/lCA==',
    }
    const keys = new Map([['test-key-v3-empty', 'MYjXfeWcnqgSrWCgDzGLJiiMYz1RGuA/dbkm+TK027c=']])

    expect(() => verifyNativeBundleResolutionSignature(resolution, keys)).not.toThrow()
  })
})
