import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmePluginError } from '../../src/arkme-service.js'
import { ArkmeExtensionInstallStore } from '../../src/extensions/install-store.js'
import { ArkmeExtensionManager } from '../../src/extensions/manager.js'
import { ExtensionPublishClient } from '../../src/extensions/publish-client.js'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

function managerWith(post: ConstructorParameters<typeof ExtensionPublishClient>[0]): ArkmeExtensionManager {
  const root = mkdtempSync(join(tmpdir(), 'arkme-extension-metadata-'))
  directories.push(root)
  return new ArkmeExtensionManager(
    new ExtensionPublishClient(post),
    new ArkmeExtensionInstallStore(join(root, 'store')),
    {} as never,
    { artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}' },
  )
}

const input = {
  extensionId: 'ext-1',
  name: '  新名称  ',
  description: '  新说明  ',
  visibility: 'private' as const,
  clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
}

describe('extension metadata Host owner', () => {
  it('normalizes editable metadata and returns the registry safe projection', async () => {
    const post = vi.fn(async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
      expect(path).toBe('/api/v1/extensions/metadata/update')
      expect(body).toEqual({
        extension_id: 'ext-1',
        name: '新名称',
        description: '新说明',
        visibility: 'private',
        client_mutation_id: '9f445b4f-55aa-45c1-9250-25161832d432',
      })
      return { extension: {
        extension_id: 'ext-1', name: '新名称', description: '新说明', visibility: 'private',
        status: 'active', latest_stable_version: '1.0.0', updated_at: 1_780_000_000_000,
      } } as T
    })

    await expect(managerWith(post).updateMetadata(input)).resolves.toEqual({
      extension_id: 'ext-1', name: '新名称', description: '新说明', visibility: 'private',
      status: 'active', latest_stable_version: '1.0.0', updated_at: 1_780_000_000_000,
    })
    expect(post).toHaveBeenCalledOnce()
  })

  it.each([
    [{ ...input, name: '   ' }, 'extension-metadata-invalid'],
    [{ ...input, visibility: 'unlisted' as never }, 'extension-metadata-invalid'],
    [{ ...input, clientMutationId: 'not-a-uuid' }, 'extension-metadata-invalid'],
  ])('rejects invalid Browser-safe input before registry transport', async (invalid, code) => {
    const post = vi.fn()
    await expect(managerWith(post).updateMetadata(invalid)).rejects.toMatchObject({ code })
    expect(post).not.toHaveBeenCalled()
  })

  it.each([
    ['arkme-code-40021', 400, 'extension-metadata-invalid'],
    ['arkme-code-40321', 403, 'extension-metadata-owner-forbidden'],
    ['arkme-code-40421', 404, 'extension-not-found'],
    ['arkme-code-40921', 409, 'extension-metadata-idempotency-conflict'],
    ['arkme-code-50321', 503, 'extension-metadata-update-failed'],
  ])('maps registry metadata envelope %s to %s', async (upstreamCode, status, expectedCode) => {
    const manager = managerWith(async () => {
      throw new ArkmePluginError(upstreamCode, 'registry rejected', status >= 500, status, { upstreamStatus: status })
    })
    await expect(manager.updateMetadata(input)).rejects.toMatchObject({ code: expectedCode })
  })

  it('distinguishes an unsupported old route from a real missing extension', async () => {
    const manager = managerWith(async () => {
      throw new ArkmePluginError('arkme-http-error', 'HTTP 404', false, 404, { upstreamStatus: 404 })
    })
    await expect(manager.updateMetadata(input)).rejects.toMatchObject({
      code: 'extension-metadata-update-unsupported', retryable: false,
    })
  })

  it('rejects a registry response for a different extension identity', async () => {
    const manager = managerWith(async <T>() => ({ extension: {
      extension_id: 'ext-other', name: '新名称', description: '新说明', visibility: 'private', updated_at: 1,
    } } as T))
    await expect(manager.updateMetadata(input)).rejects.toMatchObject({ code: 'extension-metadata-contract-invalid' })
  })
})
