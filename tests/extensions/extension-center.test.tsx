import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ARKME_EXTENSION_BRAND_GREEN, ARKME_EXTENSION_PRIMARY_ACTION_BG, ArkmeExtensionCenter, ArkmeExtensionToggle,
  extensionAuthorLabel, extensionCatalogAction, extensionDirectInstallTarget,
  extensionInstallOwnerId, extensionInstallPercent, extensionTabLoadMode, extensionUpdateVersionLabel,
  extensionVersionLabel, installedExtensionCatalogItem,
  extensionNativeInstallWarning, formatExtensionBytes, MyExtensionCard,
} from '../../src/client/ArkmeExtensionCenter.js'
import { ArkmeExtensionPublishDialog } from '../../src/client/ArkmeExtensionPublishDialog.js'
import type { ArkmeMyExtensionItem } from '../../src/extensions/owned-types.js'
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
    expect(html).toContain('我的扩展')
    expect(html).not.toContain('我的发布')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain(ARKME_EXTENSION_BRAND_GREEN)
    expect(ARKME_EXTENSION_BRAND_GREEN).toBe('#09B83E')
    expect(html).toContain('height:40px')
    expect(html).not.toContain('border-bottom:1px solid')
    expect(html).toContain('border-bottom:2px solid #09B83E')
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

  it('uses a dark primary action and the shared accessible switch proportions', () => {
    expect(ARKME_EXTENSION_PRIMARY_ACTION_BG).toContain('#292929')
    const html = renderToStaticMarkup(<ArkmeExtensionToggle
      item={{
        extensionId: 'ext-1', installedVersion: '1.0.0',
        manifest: {
          format: 'arkme-cordis-extension', format_version: 1, name: '扩展', description: '', version: '1.0.0',
          runtime: { dsh: '*', arkme_provider_contract: 1 }, halves: { host: true, client: false },
          permissions: [], entrypoints: { host: 'host.js' },
        },
        enabled: true, active: true, permissionSnapshot: [], updateChannel: 'stable',
        installedAtMillis: 1, lastCheckedAtMillis: 1,
      }}
      busy={false}
      onChange={() => {}}
    />)
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('width:40px')
    expect(html).toContain('height:22px')
    expect(html).toContain('translateX(18px)')
  })

  it('maps real download bytes into the install progress stage', () => {
    expect(extensionInstallPercent({ phase: 'downloading', downloadedBytes: 25, totalBytes: 100 })).toBe(25)
    expect(extensionInstallPercent({ phase: 'downloading', downloadedBytes: 100, totalBytes: 100 })).toBe(75)
    expect(extensionInstallPercent({ phase: 'verifying' })).toBe(80)
    expect(extensionInstallPercent({ phase: 'active' })).toBe(100)
    expect(formatExtensionBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('does not offer installation for an owned extension without a published version', () => {
    expect(extensionCatalogAction({}, undefined, true)).toEqual({ label: '未发布', disabled: true })
    expect(extensionCatalogAction({ latest_stable_version: '1.0.0' }, undefined, true))
      .toEqual({ label: '安装', disabled: false })
    expect(extensionCatalogAction({ latest_stable_version: '1.0.0' }, '1.0.0'))
      .toEqual({ label: '已安装', disabled: true })
    expect(extensionCatalogAction({ latest_stable_version: '1.1.0' }, '1.0.0'))
      .toEqual({ label: '更新', disabled: false })
  })

  it('keeps installed and latest versions visible independently from update status', () => {
    expect(extensionVersionLabel({ latest_stable_version: '1.2.3' })).toBe('v1.2.3')
    expect(extensionVersionLabel({ version: '2.0.0', latest_stable_version: '1.2.3' })).toBe('v2.0.0')
    expect(extensionUpdateVersionLabel({
      extension_id: 'ext-1', installed_version: '1.0.0', latest_version: '1.1.0',
      update_available: true, revoked: false,
    })).toBe('v1.0.0 → v1.1.0')
    expect(extensionUpdateVersionLabel({
      extension_id: 'ext-1', installed_version: '1.1.0', latest_version: '1.1.0',
      update_available: false, revoked: false,
    })).toBe('v1.1.0 · 已是最新')
    expect(extensionUpdateVersionLabel({
      extension_id: 'ext-1', installed_version: '1.1.0', update_available: false, revoked: false,
    })).toBe('当前 v1.1.0 · 暂无法确认最新版本')
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

  it('discloses native DSH process authority before installation', () => {
    expect(extensionNativeInstallWarning({ execution_model: 'dsh-native', package_name: '@example/native' }))
      .toBe('扩展 @example/native 是原生 DSH Bundle，将以 DSH 插件进程权限运行。确认继续安装吗？')
    expect(extensionNativeInstallWarning({ execution_model: 'arkme-sandboxed' })).toBeUndefined()
  })

  it('renders the resolved author without exposing a version in its label', () => {
    expect(extensionAuthorLabel({ owner_user_id: 42, owner_name: '阿明', owner_arkme_id: 'aming' }))
      .toBe('阿明 · @aming')
    expect(extensionAuthorLabel({ owner_user_id: 42 })).toBe('Arkme 用户 42')
    expect(extensionAuthorLabel({})).toBe('作者信息暂不可用')
  })

  it('projects installed extensions into the same catalog card contract', () => {
    expect(installedExtensionCatalogItem({
      extensionId: 'ext-1', installedVersion: '1.0.0',
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

  it('renders one unified card with every Host-owned lifecycle state', () => {
    const item: ArkmeMyExtensionItem = {
      ownedRef: 'owned-ref', name: '天气助手', description: '天气卡片',
      states: ['cordis', 'persisted', 'published'], halves: { host: true, client: false },
      cordis: { packageCount: 1, active: true },
      persisted: { packageName: 'local-weather', version: '1.0.0', active: true },
      published: { extensionId: 'ext-1', version: '1.0.0', visibility: 'private' },
      publish: { allowed: true, mode: 'version' },
    }

    const html = renderToStaticMarkup(<MyExtensionCard item={item} onPublish={() => {}} />)

    expect(html).toContain('天气助手')
    expect(html).toContain('Cordis 临时')
    expect(html).toContain('已持久化')
    expect(html).toContain('已发布')
    expect(html).not.toContain('发布新版本')
    expect(html).not.toContain('<button')
    expect(html.indexOf('天气助手')).toBeLessThan(html.indexOf('Cordis 临时'))
    expect(html.indexOf('Cordis 临时')).toBeLessThan(html.indexOf('天气卡片'))
    expect(html).toContain('border-radius:999px')
    expect(html).not.toContain('local-weather')
  })

  it('renders a button only for an unpublished live Cordis action', () => {
    const html = renderToStaticMarkup(<MyExtensionCard item={{
      ownedRef: 'owned-ref', name: '天气助手', description: '天气卡片', states: ['cordis'],
      halves: { host: true, client: false }, cordis: { packageCount: 1, active: true },
      publish: { allowed: true, mode: 'new' },
    }} onPublish={() => {}} />)

    expect(html).toContain('>发布</button>')
    expect(html).not.toContain('>仅本地</button>')
    expect(html).not.toContain('>已发布</button>')
  })

  it('renders an accessible private-by-default Cordis publish form', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionPublishDialog
      item={{
        ownedRef: 'owned-ref', name: '天气助手', description: '天气卡片', states: ['cordis'],
        halves: { host: true, client: false }, publish: { allowed: true, mode: 'new' },
      }}
      busy={false}
      error=""
      onCancel={() => {}}
      onSubmit={() => {}}
    />)

    expect(html).toContain('role="dialog"')
    expect(html).toContain('发布扩展')
    expect(html).toContain('value="天气助手"')
    expect(html).toContain('<option value="private" selected="">仅自己</option>')
  })
})
