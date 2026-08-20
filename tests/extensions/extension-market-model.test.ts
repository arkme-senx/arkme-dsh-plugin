import { describe, expect, it } from 'vitest'
import {
  extensionOwnerVisibilityBadge,
  extensionTabSelection,
  mergeExtensionDiscoverItems,
} from '../../src/client/extension-market-model.js'

describe('extension market discovery projection', () => {
  it('merges owner-private extensions, deduplicates public ownership, and hides unlisted history', () => {
    const publicItems = [{
      extension_id: 'ext-public', name: '公开目录名称', description: '目录说明', visibility: 'public' as const,
      updated_at: 10, rating_summary: { average: 5, count: 1, histogram: [0, 0, 0, 0, 1] as [number, number, number, number, number] },
    }]
    const ownedItems = [
      {
        extension_id: 'ext-private', name: '私有扩展', description: '', visibility: 'private' as const,
        latest_stable_version: '1.0.0', updated_at: 20, owner_name: '我',
      },
      {
        extension_id: 'ext-public', name: '旧名称', description: '旧说明', visibility: 'public' as const,
        latest_stable_version: '1.0.0', updated_at: 10, owner_name: '我',
      },
      {
        extension_id: 'ext-unlisted', name: '历史不公开', description: '', visibility: 'unlisted' as const,
        latest_stable_version: '1.0.0', updated_at: 30,
      },
      {
        extension_id: 'ext-incomplete', name: '未完成发布', description: '', visibility: 'private' as const,
        updated_at: 40,
      },
    ]
    const result = mergeExtensionDiscoverItems(publicItems, ownedItems)

    expect(result.map(item => item.extension_id)).toEqual(['ext-private', 'ext-public'])
    expect(result[1]).toMatchObject({
      name: '公开目录名称', description: '目录说明', owner_name: '我',
      rating_summary: { average: 5, count: 1 },
    })
    expect(publicItems[0]).not.toHaveProperty('owner_name')
  })

  it('sorts equal update times by extension identity for a stable projection', () => {
    const result = mergeExtensionDiscoverItems([], [
      { extension_id: 'ext-b', name: 'B', description: '', visibility: 'private', latest_stable_version: '1.0.0', updated_at: 8 },
      { extension_id: 'ext-a', name: 'A', description: '', visibility: 'private', latest_stable_version: '1.0.0', updated_at: 8 },
    ])
    expect(result.map(item => item.extension_id)).toEqual(['ext-a', 'ext-b'])
  })

  it('labels only owner-private discovery entries', () => {
    expect(extensionOwnerVisibilityBadge({ visibility: 'private' })).toBe('仅自己')
    expect(extensionOwnerVisibilityBadge({ visibility: 'public' })).toBeUndefined()
    expect(extensionOwnerVisibilityBadge({ visibility: 'unlisted' })).toBeUndefined()
  })

  it('refreshes an active tab without changing selection', () => {
    expect(extensionTabSelection('discover', 'discover', new Set(['discover'])))
      .toEqual({ changed: false, mode: 'refresh' })
    expect(extensionTabSelection('discover', 'mine', new Set(['discover'])))
      .toEqual({ changed: true, mode: 'initial' })
  })
})
