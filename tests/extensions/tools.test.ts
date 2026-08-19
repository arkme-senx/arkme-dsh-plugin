import { describe, expect, it, vi } from 'vitest'
import { registerArkmeExtensionTools } from '../../src/tools/extensions/index.js'

describe('Arkme extension tools', () => {
  it('registers the exact MVP surface only for business profiles and asks before writes', async () => {
    const definitions: Array<{ name: string; description?: string; parameters?: Record<string, unknown> }> = []
    let guard: ((exec: { name: string; arguments: Record<string, unknown> }, next: () => Promise<{ kind: string }>) => Promise<unknown>) | undefined
    const context = {
      tools: { register: vi.fn(definition => { definitions.push(definition) }) },
      on: vi.fn((_event, listener) => { guard = listener }),
    }
    registerArkmeExtensionTools(context as never, {} as never, 'business')

    expect(definitions.map(item => item.name)).toEqual([
      'arkme_extension_publish', 'arkme_extension_delete', 'arkme_extension_search', 'arkme_extension_inspect', 'arkme_extension_apply',
    ])
    const publish = definitions.find(item => item.name === 'arkme_extension_publish')
    expect(publish?.parameters).not.toHaveProperty('permissions')
    expect(publish?.description).toContain('exact returned validation message')
    expect(publish?.description).toContain('do not retry the unchanged package')
    const deleteTool = definitions.find(item => item.name === 'arkme_extension_delete')
    expect(deleteTool?.parameters).toEqual({
      type: 'object',
      properties: {
        extension_id: { type: 'string', description: 'Exact extension_id owned by the current Arkme user.' },
      },
      required: ['extension_id'],
    })
    expect(deleteTool?.description).toContain('explicitly asks to delete it')
    await expect(guard!(
      { name: 'arkme_extension_publish', arguments: {
        plugin_id: 'plug-1', package_id: 'pkg-1', name: '天气', version: '1.0.0', visibility: 'public',
      } },
      async () => ({ kind: 'allow' }),
    )).resolves.toEqual({
      kind: 'ask',
      reason: '确认将 Dynamic Cordis plug-1/pkg-1 作为“天气” 1.0.0 发布到扩展市场吗？可见范围：public。',
    })
    await expect(guard!(
      { name: 'arkme_extension_delete', arguments: { extension_id: 'ext-1' } },
      async () => ({ kind: 'allow' }),
    )).resolves.toEqual({
      kind: 'ask',
      reason: '确认软删除扩展 ext-1 吗？删除后将从扩展市场隐藏、禁止新安装和继续发版，并向已安装用户标记撤销；服务端记录和制品会保留。',
    })
    await expect(guard!(
      { name: 'arkme_extension_search', arguments: {} },
      async () => ({ kind: 'allow' }),
    )).resolves.toEqual({ kind: 'allow' })
  })

  it('does not expose extension writes in atomic or disabled profiles', () => {
    for (const profile of ['atomic', 'disabled'] as const) {
      const register = vi.fn()
      registerArkmeExtensionTools({ tools: { register }, on: vi.fn() } as never, {} as never, profile)
      expect(register).not.toHaveBeenCalled()
    }
  })
})
