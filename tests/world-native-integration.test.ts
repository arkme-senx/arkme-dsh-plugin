import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const source = async (relativePath: string) => await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8')

describe('native World integration', () => {
  it('adds a first-party world UI mode and controller transition', async () => {
    const controller = await source('src/client/ui-controller.ts')

    expect(controller).toContain("| 'world'")
    expect(controller).toContain('showWorld(): void')
    expect(controller).toContain("mode: 'world'")
  })

  it('places World immediately below Calendar in the product navigation', async () => {
    const productNavigation = await source('src/client/ArkmeProductNavigation.tsx')

    expect(productNavigation).toMatch(/id: 'calendar'[\s\S]*id: 'world'[\s\S]*id: 'extensions'/)
    expect(productNavigation).toContain("if (id === 'world') arkmeUi.showWorld()")
  })

  it('renders World as a full native utility surface like recordings', async () => {
    const sidebar = await source('src/client/ArkmeSidebar.tsx')
    const clientIndex = await source('src/client/index.tsx')

    expect(sidebar).toContain("import { ArkmeWorldSurface } from './ArkmeWorldSurface.js'")
    expect(sidebar).toContain("ui.mode === 'world' ? '世界'")
    expect(sidebar).toContain("ui.mode === 'world'")
    expect(sidebar).toContain('<ArkmeWorldSurface')
    expect(sidebar).toContain('ui.worldTarget === undefined ? {} : { target: ui.worldTarget }')
    expect(sidebar).toContain('onBackToWorld={() => { arkmeUi.showWorld() }}')
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
    expect(world).toContain("tabActive: { borderBottom: '2px solid #20232d'")
    expect(world).not.toContain('tabActive: { borderBottomColor:')
  })

  it('keeps the remaining currently unsupported controls wired to their real operations', async () => {
    const api = await source('src/client/api.ts')
    const world = await source('src/client/ArkmeWorldSurface.tsx')

    for (const operation of ['world.upload-image-data', 'world.publish-rich', 'world.publish-text', 'world.voiceprint.invite']) {
      expect(api).toContain(`| '${operation}'`)
      expect(world).toContain(`'${operation}'`)
    }
    expect(world).toContain('草稿不会被清空')
  })
})
