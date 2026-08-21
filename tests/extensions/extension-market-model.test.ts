import { describe, expect, it } from 'vitest'
import {
  appendExtensionDiscoverPage,
  extensionTabSelection,
  mergeExtensionDiscoverItems,
} from '../../src/client/extension-market-model.js'

describe('extension market discovery projection', () => {
  it('uses only the public catalog and never supplements owner-private extensions', () => {
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

    expect(result.map(item => item.extension_id)).toEqual(['ext-public'])
    expect(result[0]).toMatchObject({
      name: '公开目录名称', description: '目录说明',
      rating_summary: { average: 5, count: 1 },
    })
    expect(result[0]).not.toHaveProperty('owner_name')
  })

  it('does not reveal private owned extensions when the public catalog is empty', () => {
    const result = mergeExtensionDiscoverItems([], [
      { extension_id: 'ext-b', name: 'B', description: '', visibility: 'private', latest_stable_version: '1.0.0', updated_at: 8 },
      { extension_id: 'ext-a', name: 'A', description: '', visibility: 'private', latest_stable_version: '1.0.0', updated_at: 8 },
    ])
    expect(result).toEqual([])
  })

  it('appends a cursor page in server order without duplicating extensions', () => {
    const first = [
      { extension_id: 'ext-a', name: 'A', description: '', visibility: 'public' as const },
      { extension_id: 'ext-b', name: 'B', description: '', visibility: 'public' as const },
    ]
    const next = [
      { extension_id: 'ext-b', name: 'B duplicate', description: '', visibility: 'public' as const },
      { extension_id: 'ext-c', name: 'C', description: '', visibility: 'public' as const },
    ]

    expect(appendExtensionDiscoverPage(first, next).map(item => item.extension_id))
      .toEqual(['ext-a', 'ext-b', 'ext-c'])
  })

  it('refreshes an active tab without changing selection', () => {
    expect(extensionTabSelection('discover', 'discover', new Set(['discover'])))
      .toEqual({ changed: false, mode: 'refresh' })
    expect(extensionTabSelection('discover', 'mine', new Set(['discover'])))
      .toEqual({ changed: true, mode: 'initial' })
  })
})
