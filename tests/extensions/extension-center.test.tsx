import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ARKME_EXTENSION_BRAND_GREEN, ArkmeExtensionCenter, extensionAuthorLabel, extensionCatalogAction, extensionDirectInstallTarget,
  extensionInstallFailureMessage, extensionInstallOwnerId, extensionInstallPercent, extensionTabLoadMode, installedExtensionCatalogItem,
  formatExtensionBytes,
} from '../../src/client/ArkmeExtensionCenter.js'
import { ArkmeExtensionIcon } from '../../src/client/ArkmeExtensionIcon.js'

describe('Arkme extension market UI', () => {
  it('uses a large modal with text-only navigation, no search entry, and a guided empty state', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionCenter onClose={() => {}} />)

    expect(html).toContain('aria-label="Arkme 扩展市场"')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('width:min(860px, calc(100vw - 64px))')
    expect(html).toContain('height:min(680px, calc(100vh - 64px))')
    expect(html).toContain('height:58px')
    expect(html).toContain('padding:0 20px')
    expect(html).toContain('aria-label="关闭扩展市场"')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('var(--dsw-alias-state-success-primary, #09b83e)')
    expect(ARKME_EXTENSION_BRAND_GREEN).toBe('#09B83E')
    expect(html).toContain('height:40px')
    expect(html).not.toContain('border-bottom:1px solid')
    expect(html).toContain('border-bottom:2px solid var(--dsw-alias-state-success-primary, #09b83e)')
    expect(html.match(/border-bottom:2px solid/g)).toHaveLength(1)
    expect(html).not.toContain('border-bottom:2px solid transparent')
    expect(html).not.toContain('width:28%')
    expect(html).not.toContain('height:2px;flex:none;margin:0 22px')
    expect(html).not.toContain('background:var(--dsw-alias-interactive-bg-hover')
    expect(html).not.toContain('aria-label="搜索扩展"')
    expect(html).not.toContain('placeholder="搜索扩展"')
    expect(html).toContain('<svg')
    expect(html).not.toContain('>搜索</button>')
    expect(html).toContain('aria-label="正在加载扩展"')
    expect(html).not.toContain('还没有可发现的扩展')
    expect(html).not.toContain('background:#def3e8')
  })

  it('uses a blocking skeleton only before the first tab load and refreshes cached tabs silently', () => {
    expect(extensionTabLoadMode(new Set(), 'discover')).toBe('initial')
    expect(extensionTabLoadMode(new Set(['discover']), 'discover')).toBe('refresh')
    expect(extensionTabLoadMode(new Set(['discover']), 'installed')).toBe('initial')
  })

  it('uses an app-grid extension mark instead of the placeholder diamond', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionIcon size={22} />)

    expect(html.match(/<rect/g)).toHaveLength(3)
    expect(html).toContain('M17.25 14v6.5M14 17.25h6.5')
    expect(html).not.toContain('◇')
  })

  it('maps real download bytes into the install progress stage', () => {
    expect(extensionInstallPercent({ phase: 'downloading', downloadedBytes: 25, totalBytes: 100 })).toBe(25)
    expect(extensionInstallPercent({ phase: 'downloading', downloadedBytes: 100, totalBytes: 100 })).toBe(75)
    expect(extensionInstallPercent({ phase: 'verifying' })).toBe(80)
    expect(extensionInstallPercent({ phase: 'active' })).toBe(100)
    expect(formatExtensionBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('surfaces the completed install task failure instead of silently resetting the button', () => {
    expect(extensionInstallFailureMessage({
      phase: 'failed', message: '安装失败', error: { code: 'download-failed', message: '扩展制品下载失败', retryable: true },
    })).toBe('扩展制品下载失败')
    expect(extensionInstallFailureMessage({ phase: 'installed', message: '安装完成' })).toBeUndefined()
  })

  it('does not offer installation for an owned extension without a published version', () => {
    expect(extensionCatalogAction({}, undefined, true)).toEqual({ label: '未发布', disabled: true })
    expect(extensionCatalogAction({ latest_stable_version: '1.0.0' }, undefined, true))
      .toEqual({ label: '安装', disabled: false })
    expect(extensionCatalogAction({ latest_stable_version: '1.0.0' }, '1.0.0'))
      .toEqual({ label: '卸载', disabled: false })
    expect(extensionCatalogAction({ latest_stable_version: '1.1.0' }, '1.0.0'))
      .toEqual({ label: '更新', disabled: false })
  })

  it('starts list installation from the exact item without requiring detail navigation', () => {
    expect(extensionDirectInstallTarget({ extension_id: 'ext-1', latest_stable_version: '1.2.3' }))
      .toEqual({ extensionId: 'ext-1', version: '1.2.3' })
  })

  it('uses the DSH instance as the install owner when no conversation exists', () => {
    expect(extensionInstallOwnerId(undefined, 'instance-1')).toBe('profile:instance-1')
    expect(extensionInstallOwnerId('', 'instance-1')).toBe('profile:instance-1')
    expect(extensionInstallOwnerId('session-1', 'instance-1')).toBe('session-1')
    expect(extensionInstallOwnerId(undefined, undefined)).toBeUndefined()
  })

  it('renders the resolved author without exposing a version in its label', () => {
    expect(extensionAuthorLabel({ owner_user_id: 42, owner_name: '阿明', owner_arkme_id: 'aming' }))
      .toBe('阿明 · @aming')
    expect(extensionAuthorLabel({ owner_user_id: 42 })).toBe('Arkme 用户 42')
    expect(extensionAuthorLabel({})).toBe('作者信息暂不可用')
  })

  it('projects installed extensions into the same catalog card contract', () => {
    expect(installedExtensionCatalogItem({
      extensionId: 'ext-1', installedVersion: '1.0.0', artifactSha256: 'sha', artifactPath: '/tmp/ext',
      manifest: {
        format: 'arkme-cordis-extension', format_version: 1, name: '统一卡片', description: '同一种展示与点击入口',
        version: '1.0.0', runtime: { dsh: '*', arkme_provider_contract: 1 }, halves: { host: true, client: false },
        permissions: [], entrypoints: { host: 'host.js' },
      },
      enabled: true, active: true, permissionSnapshot: [], updateChannel: 'stable',
      installedAtMillis: 1, lastCheckedAtMillis: 1,
    })).toMatchObject({
      extension_id: 'ext-1', name: '统一卡片', description: '同一种展示与点击入口',
    })
  })

  it('does not render the former heavy install progress bar', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionCenter onClose={() => {}} />)
    expect(html).not.toContain('aria-label="扩展安装进度"')
  })
})
