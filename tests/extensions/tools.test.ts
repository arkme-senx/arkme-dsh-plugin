import { describe, expect, it, vi } from 'vitest'
import { registerArkmeExtensionTools } from '../../src/tools/extensions/index.js'

describe('Arkme extension tools', () => {
  it('registers the exact MVP surface only for business profiles and asks before writes', async () => {
    const definitions: Array<{
      name: string
      description?: string
      parameters?: Record<string, unknown>
      execute?: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown>
    }> = []
    let guard: ((exec: { name: string; arguments: Record<string, unknown> }, next: () => Promise<{ kind: string }>) => Promise<unknown>) | undefined
    const context = {
      tools: { register: vi.fn(definition => { definitions.push(definition) }) },
      on: vi.fn((_event, listener) => { guard = listener }),
    }
    const previewInstall = vi.fn(async () => ({
      extension_id: 'ext-native', version: '1.0.0', execution_model: 'dsh-native',
      package_name: '@example/native', manifest: { permissions: [] }, revoked: false,
    }))
    const setEnabled = vi.fn(async () => ({
      extension_id: 'ext-1', installed: true, enabled: false, active: false,
      restart_required: true, message: '已关闭',
    }))
    registerArkmeExtensionTools(context as never, { previewInstall, setEnabled } as never, {} as never, 'business')

    expect(definitions.map(item => item.name)).toEqual([
      'arkme_extension_publish', 'arkme_extension_delete', 'arkme_extension_search', 'arkme_extension_inspect', 'arkme_extension_apply',
      'arkme_extension_list_mine', 'arkme_extension_set_enabled',
    ])
    const listMine = definitions.find(item => item.name === 'arkme_extension_list_mine')
    expect(listMine?.description).toContain('current Arkme user')
    expect(listMine?.description).toContain('untrusted')
    const publish = definitions.find(item => item.name === 'arkme_extension_publish')
    expect(publish?.parameters).not.toHaveProperty('permissions')
    expect(publish?.parameters).toHaveProperty('properties.owned_ref')
    expect(publish?.parameters).not.toHaveProperty('properties.plugin_id')
    expect(publish?.parameters).not.toHaveProperty('properties.package_id')
    expect(publish?.description).toContain('exact returned validation message')
    expect(publish?.description).toContain('do not retry unchanged bytes')
    expect(publish?.description).toContain('arkme_extension_list_mine')
    expect(publish?.description).toContain('Profile-local DSH Bundle')
    const deleteTool = definitions.find(item => item.name === 'arkme_extension_delete')
    expect(deleteTool?.parameters).toEqual({
      type: 'object',
      properties: {
        extension_id: { type: 'string', description: 'Exact extension_id owned by the current Arkme user.' },
      },
      required: ['extension_id'],
    })
    expect(deleteTool?.description).toContain('explicitly asks to delete it')
    const enabledTool = definitions.find(item => item.name === 'arkme_extension_set_enabled')
    await expect(enabledTool?.execute?.(
      { extension_id: 'ext-1', enabled: false },
      { agent: { id: 'session-1' } },
    )).resolves.toContain('"enabled": false')
    expect(setEnabled).toHaveBeenCalledWith({
      agent: { id: 'session-1' }, extensionId: 'ext-1', enabled: false,
    })
    await expect(guard!(
      { name: 'arkme_extension_publish', arguments: {
        owned_ref: 'owned-ref', name: '天气', version: '1.0.0', visibility: 'public',
      } },
      async () => ({ kind: 'allow' }),
    )).resolves.toEqual({
      kind: 'ask',
      reason: '确认将“我的扩展”中的“天气” 1.0.0 发布到扩展市场吗？可见范围：public。',
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
    await expect(guard!(
      { name: 'arkme_extension_apply', arguments: { extension_id: 'ext-native', version: '1.0.0' } },
      async () => ({ kind: 'allow' }),
    )).resolves.toEqual({
      kind: 'ask',
      reason: '确认下载、验签并在当前 DSH 会话应用扩展 ext-native@1.0.0 吗？该扩展是原生 DSH Bundle，将以 DSH 插件进程权限运行。',
    })
    expect(previewInstall).toHaveBeenCalledWith('ext-native', '1.0.0')
    await expect(guard!(
      { name: 'arkme_extension_set_enabled', arguments: { extension_id: 'ext-1', enabled: false } },
      async () => ({ kind: 'allow' }),
    )).resolves.toEqual({
      kind: 'ask',
      reason: '确认关闭已安装扩展 ext-1 吗？扩展和版本会保留，稍后可重新启用。',
    })
  })

  it('does not expose extension writes in atomic or disabled profiles', () => {
    for (const profile of ['atomic', 'disabled'] as const) {
      const register = vi.fn()
      registerArkmeExtensionTools({ tools: { register }, on: vi.fn() } as never, {} as never, {} as never, profile)
      expect(register).not.toHaveBeenCalled()
    }
  })
})
