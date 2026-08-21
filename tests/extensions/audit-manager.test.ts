import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeExtensionManager } from '../../src/extensions/manager.js'

describe('Arkme extension audit owner', () => {
  it('delegates one-click audit to the extension publish service owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-extension-audit-'))
    try {
      const auditExtension = vi.fn(async () => ({
        extension_id: 'ext-1', version: '1.0.0', trigger: 'market_detail',
        verdict: 'review', risk_level: 'medium', summary: '需要复核', reasons: ['records.search'],
        recommendations: [], source_reviewed: false, source_scope: 'public_detail_only', audited_at_millis: 1,
      }))
      const manager = new ArkmeExtensionManager(
        { auditExtension } as never,
        {} as never,
        {} as never,
        { artifactDirectory: root, trustedSigningKeys: '{}' },
      )

      await expect(manager.auditExtension({ extensionId: ' ext-1 ', trigger: 'market_detail' }))
        .resolves.toMatchObject({ extension_id: 'ext-1', version: '1.0.0', verdict: 'review' })
      expect(auditExtension).toHaveBeenCalledWith('ext-1', 'market_detail', undefined)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
