import { describe, expect, it, vi } from 'vitest'
import { ExtensionPublishClient } from '../../src/extensions/publish-client.js'

describe('Extension publish audit client', () => {
  it('calls the publish-service user audit endpoint with the entry trigger', async () => {
    const post = vi.fn(async () => ({
      extension_id: 'ext-1',
      version: '1.0.0',
      trigger: 'tool',
      verdict: 'pass',
      risk_level: 'low',
      summary: '未发现明显风险',
      reasons: [],
      recommendations: [],
      source_reviewed: false,
      source_scope: 'public_detail_only',
      audited_at_millis: 1,
    }))
    const client = new ExtensionPublishClient(post)

    await expect(client.auditExtension('ext-1', 'tool')).resolves.toMatchObject({
      extension_id: 'ext-1',
      trigger: 'tool',
      verdict: 'pass',
    })
    expect(post).toHaveBeenCalledWith('/api/v1/extensions/audit/check', {
      extension_id: 'ext-1',
      trigger: 'tool',
    }, undefined)
  })
})
