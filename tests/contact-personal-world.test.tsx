// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import * as api from '../src/client/api.js'
import { ArkmeWorldContent, ArkmeWorldSurface } from '../src/client/ArkmeWorldSurface.js'
import { arkmeUi } from '../src/client/ui-controller.js'

it('shares the personal feed and public plugin shelf between contacts and marketplace', async () => {
  const request = vi.spyOn(api, 'callArkme').mockImplementation(async operation => {
    if (operation === 'extensions.catalog.list') return { items: [
      { extension_id: 'public-a', name: '公开插件 A', description: '插件说明', visibility: 'public', status: 'published' },
      { extension_id: 'private-a', name: '私有插件', visibility: 'private', status: 'published' },
    ], total: 8 }
    return { items: [], total: 21, hasMore: true, nextOffset: 20 }
  })
  const openPlugin = vi.spyOn(arkmeUi, 'showExtensionDetail').mockImplementation(() => {})
  const openAll = vi.spyOn(arkmeUi, 'showAuthorExtensions').mockImplementation(() => {})
  let renderer!: ReactTestRenderer
  try {
    for (const target of [
      { userId: 88, displayName: 'Lucis', contactRef: 'contact-a' },
      { userId: 88, displayName: 'Lucis' },
    ]) {
      request.mockClear()
      await act(async () => { renderer = create(<ArkmeWorldSurface target={target} />) })
      expect(request).toHaveBeenCalledWith('world.user', { userId: 88, limit: 20, offset: 0 }, expect.any(AbortSignal))
      expect(request).toHaveBeenCalledWith('extensions.catalog.list', { ownerUserId: 88, limit: 6 }, expect.any(AbortSignal))
      const content = renderer.root.findByType(ArkmeWorldContent)
      expect(content.props.catalogOwnerUserId).toBe(88)
      const rendered = JSON.stringify(renderer.toJSON())
      expect(rendered).toContain('公开插件 A')
      expect(rendered).not.toContain('私有插件')
      await act(async () => { content.props.onLoadMore() })
      expect(request).toHaveBeenLastCalledWith('world.user', { userId: 88, limit: 20, offset: 20 }, expect.any(AbortSignal))
      await act(async () => { content.props.onRefresh() })
      expect(request).toHaveBeenLastCalledWith('world.user', { userId: 88, limit: 20, offset: 0 }, expect.any(AbortSignal))
      await act(async () => { content.props.onOpenExtension('public-a'); content.props.onOpenAllExtensions(88, 'Lucis') })
      expect(openPlugin).toHaveBeenCalledWith('public-a')
      expect(openAll).toHaveBeenCalledWith(88, 'Lucis')
      await act(async () => { renderer.unmount() })
    }
    await act(async () => { renderer = create(<ArkmeWorldSurface target={{ userId: 88, contactRef: 'contact-a', displayName: 'Lucis' }} />) })
    request.mockClear()
    await act(async () => { renderer.update(<ArkmeWorldSurface target={{ userId: 89, contactRef: 'contact-b', displayName: 'Lucis' }} />) })
    expect(request).toHaveBeenCalledWith('world.user', { userId: 89, limit: 20, offset: 0 }, expect.any(AbortSignal))
    expect(request).toHaveBeenCalledWith('extensions.catalog.list', { ownerUserId: 89, limit: 6 }, expect.any(AbortSignal))
  } finally {
    await act(async () => { renderer?.unmount() })
    request.mockRestore()
    openPlugin.mockRestore()
    openAll.mockRestore()
  }
})
