import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const source = async (relativePath: string) => await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8')

describe('native World integration', () => {
  it('adds a first-party world UI mode and controller transition', async () => {
    const controller = await source('src/client/ui-controller.ts')

    expect(controller).toContain("| 'world'")
    expect(controller).toContain("showWorld(scope: 'all' | 'mine' = 'all'): void")
    expect(controller).toContain("mode: 'world'")
  })

  it('groups World under Explore in the product navigation', async () => {
    const productNavigation = await source('src/client/ArkmeProductNavigation.tsx')

    expect(productNavigation).toMatch(/id: 'calendar'[\s\S]*id: 'explore'[\s\S]*id: 'extensions'/)
    expect(productNavigation).toContain('<ExploreNavigation')
    const explore = await source('src/client/explore/ExploreNavigation.tsx')
    expect(explore).toContain("...EXPLORE_MODULES,'location' as const,'world' as const]")
    expect(explore).toContain("module==='world'?arkmeUi.showWorld()")
  })

  it('renders World as a full native utility surface like recordings', async () => {
    const sidebar = await source('src/client/ArkmeSidebar.tsx')
    const clientIndex = await source('src/client/index.tsx')

    expect(sidebar).toContain("import { ArkmeWorldSurface } from './ArkmeWorldSurface.js'")
    expect(sidebar).toContain("ui.mode === 'world' ? '世界'")
    expect(sidebar).toContain("ui.mode === 'world'")
    expect(sidebar).toContain('<ArkmeWorldSurface')
    expect(sidebar).toContain('ui.worldTarget === undefined ? {} : { target: ui.worldTarget }')
    expect(sidebar).toContain('onBackToWorld={() => { arkmeUi.backFromWorld() }}')
    expect(clientIndex).toContain("export { ArkmeWorldSurface } from './ArkmeWorldSurface.js'")
  })

  it('routes My World through the canonical Provider and Host contract', async () => {
    const api = await source('src/client/api.ts')
    const types = await source('src/types.ts')
    const host = await source('src/host-api.ts')
    const world = await source('src/client/ArkmeWorldSurface.tsx')

    expect(api).not.toContain("| 'world.mine'")
    expect(types).toContain("| 'world.mine'")
    expect(types).toContain("| 'world.user'")
    expect(host).toContain("case 'world.mine': return await service.listMyWorldFeed")
    expect(host).toContain("case 'world.user'")
    expect(world).toContain("callArkme<ArkmeWorldFeedPage>('world.user'")
  })

  it('clears the previous World scope underline when the selected scope changes', async () => {
    const world = await source('src/client/ArkmeWorldSurface.tsx')

    expect(world).toContain("borderBottom: '2px solid transparent'")
    expect(world).toContain('tabActive: { borderBottom: `2px solid ${arkmeTheme.accent}`')
    expect(world).not.toContain('tabActive: { borderBottomColor:')
  })

  it('wires publishing only through supported Host operations and the existing upload SDK', async () => {
    const api = await source('src/client/api.ts')
    const entry = await source('src/index.ts')
    const types = await source('src/types.ts')
    const host = await source('src/host-api.ts')
    const world = await source('src/client/ArkmeWorldSurface.tsx')

    for (const operation of ['world.publish-text', 'world.publish-file-assets']) {
      expect(types).toContain(`| '${operation}'`)
      expect(host).toContain(`case '${operation}'`)
    }
    expect(types).toContain('worldPublish?: true')
    expect(entry).toContain('ArkmeWorldPublishFileAssetsInput')
    expect(entry).toContain('ArkmeWorldPublishTextInput')
    expect(world).toContain('createArkmeSdk')
    expect(world).toContain('.upload(file')
    expect(world).toContain('.publishWorldText(')
    expect(world).toContain('.publishWorldFileAssets(')
    expect(world).toContain('mutationIdRef')
    expect(world).toContain('if (item.asset) return item.asset')
    expect(world).toContain('setAttachments(current => current.map')
    expect(world).toContain('mutationIdRef.current')
    const publishHost = await source('src/client/WorldPublishHost.tsx')
    expect(publishHost).toContain("result.visibility === 'pending_review'")
    expect(publishHost).toContain('已提交审核')
    expect(world).toContain('result.worldPublished')
    expect(api).not.toContain('world.upload-image-data')
    expect(api).not.toContain('world.publish-rich')
    expect(world).not.toContain('fileBase64')
    expect(world).not.toContain('world.upload-image-data')
    expect(world).not.toContain('world.publish-rich')
    expect(world).toContain('草稿已保留')
    expect(world).toContain('<WorldPublishGuide')
  })
})
