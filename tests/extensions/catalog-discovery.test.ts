import { describe, expect, it, vi } from 'vitest'
import { ExtensionPublishClient } from '../../src/extensions/publish-client.js'
import { extensionCatalogPageLimit } from '../../src/extensions/manager.js'

describe('extension marketplace discovery client', () => {
  it('forwards sorting and AI category composition to their public endpoints', async () => {
    const post = vi.fn(async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
      if (path.endsWith('/classification/tree')) {
        return { status: 'ready', categories: [], total_extensions: 0, total_categories: 0 } as T
      }
      if (path.endsWith('/classification/items')) {
        return { category_id: 'cat_tools', items: [], total: 0, limit: 20, offset: 0 } as T
      }
      return { items: [], total: 0, capabilities: { sorts: ['rating', 'comments', 'opens', 'created_at'], cursor: true } } as T
    })
    const client = new ExtensionPublishClient(post)

    await client.list({
      query: '翻译', sort: 'rating', cursor: 'next', limit: 20,
      owner_user_id: 77, exclude_extension_id: 'ext-current',
    })
    await client.classificationTree(50)
    await client.classificationItems({
      category_id: 'cat_tools', query: '翻译', sort: 'opens', cursor: '20', limit: 20,
    })

    expect(post).toHaveBeenNthCalledWith(1, '/api/public/v1/extensions/list', {
      query: '翻译', sort: 'rating', cursor: 'next', limit: 20,
      owner_user_id: 77, exclude_extension_id: 'ext-current',
    }, undefined)
    expect(post).toHaveBeenNthCalledWith(2, '/api/public/v1/extensions/classification/tree', { limit: 50 }, undefined)
    expect(post).toHaveBeenNthCalledWith(3, '/api/public/v1/extensions/classification/items', {
      category_id: 'cat_tools', query: '翻译', sort: 'opens', cursor: '20', limit: 20,
    }, undefined)
  })

  it('allows the shared Host owner to request a 70-item marketplace page', async () => {
    expect(extensionCatalogPageLimit(70)).toBe(70)
    expect(extensionCatalogPageLimit(500)).toBe(100)
    expect(extensionCatalogPageLimit(0)).toBe(1)
    expect(extensionCatalogPageLimit()).toBe(20)
  })
})
