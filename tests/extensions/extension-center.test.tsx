import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'
import * as extensionCenterModule from '../../src/client/ArkmeExtensionCenter.js'
import {
  ARKME_EXTENSION_BRAND_GREEN, ARKME_EXTENSION_PRIMARY_ACTION_BG, ARKME_EXTENSION_PRIMARY_ACTION_FG,
  ARKME_EXTENSION_RESTART_SURFACE, ArkmeExtensionCenter, ArkmeExtensionRestartDialog,
  ArkmeExtensionToggle, ExtensionCard,
  extensionAuthorLabel, extensionCardMetadata, extensionCatalogAction, extensionDirectInstallTarget,
  extensionEnableUnavailable,
  extensionInstallFailureMessage, extensionInstallOwnerId, extensionInstallPercent, extensionTabLoadMode, extensionUpdateCardStatus,
  extensionVersionLabel, installedExtensionCatalogItem,
  extensionNativeInstallWarning, formatExtensionBytes, MyExtensionCard,
} from '../../src/client/ArkmeExtensionCenter.js'
import { ArkmeExtensionPublishDialog } from '../../src/client/ArkmeExtensionPublishDialog.js'
import { ArkmeExtensionEditDialog } from '../../src/client/ArkmeExtensionEditDialog.js'
import type { ArkmeMyExtensionItem } from '../../src/extensions/owned-types.js'
import { ArkmeExtensionIcon } from '../../src/client/ArkmeExtensionIcon.js'
import type { ArkmeExtensionPreviewItem } from '../../src/extensions/types.js'

const previewModule = extensionCenterModule as unknown as {
  ArkmeExtensionPreviewGallery?: ComponentType<{
    extensionId: string
    extensionName: string
    previews: ArkmeExtensionPreviewItem[]
  }>
  arkmeExtensionPreviewUrl?: (extensionId: string, previewRef: string) => string
  extensionPreviewSelection?: (currentRef: string | undefined, previews: ArkmeExtensionPreviewItem[]) => string | undefined
  ArkmeExtensionManifestDetails?: ComponentType<{ manifest: unknown }>
}

describe('Arkme extension market UI', () => {
  it('treats missing manifest permissions as no declared permissions', () => {
    const ManifestDetails = previewModule.ArkmeExtensionManifestDetails
    expect(ManifestDetails).toBeTypeOf('function')
    if (ManifestDetails === undefined) return

    const html = renderToStaticMarkup(<ManifestDetails manifest={{
      runtime: { dsh: '>=0.1.0-rc.7' }, halves: { host: true, client: false }, permissions: null,
    }} />)
    expect(html).toContain('运行能力')
    expect(html).toContain('Host')
    expect(html).toContain('&gt;=0.1.0-rc.7')
  })

  it('hides an empty legacy manifest without affecting the rest of the detail', () => {
    const ManifestDetails = previewModule.ArkmeExtensionManifestDetails
    expect(ManifestDetails).toBeTypeOf('function')
    if (ManifestDetails === undefined) return
    const html = renderToStaticMarkup(<ManifestDetails manifest={{
      runtime: { dsh: '' }, halves: { host: false, client: false }, permissions: null,
    }} />)
    expect(html).toBe('')
  })

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
    expect(html).toContain('var(--dsw-alias-state-business-primary, #8295e8)')
    expect(ARKME_EXTENSION_BRAND_GREEN).toBe('#8295E8')
    expect(html).toContain('height:40px')
    expect(html).not.toContain('border-bottom:1px solid')
    expect(html).toContain('border-bottom:2px solid var(--dsw-alias-state-business-primary, #8295e8)')
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

  it('renders an ordered same-origin preview gallery without exposing storage transport', () => {
    const Gallery = previewModule.ArkmeExtensionPreviewGallery
    const previews: ArkmeExtensionPreviewItem[] = [
      {
        preview_ref: `preview_v1_${'a'.repeat(64)}`, content_type: 'image/png', preview_size: 1024,
        width: 1280, height: 720, created_at: 1,
      },
      {
        preview_ref: `preview_v1_${'b'.repeat(64)}`, content_type: 'image/webp', preview_size: 2048,
        width: 800, height: 600, created_at: 2,
      },
    ]
    const html = Gallery === undefined ? '' : renderToStaticMarkup(<Gallery
      extensionId="ext-preview"
      extensionName="预览扩展"
      previews={previews}
    />)

    expect(html).toContain('aria-label="扩展预览图"')
    expect(html).toContain('alt="预览扩展的第 1 张预览图"')
    expect(html).toContain('aria-label="查看第 1 张预览图"')
    expect(html).toContain('aria-label="查看第 2 张预览图"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain(`/arkme-self/api/extension-preview?extension_id=ext-preview&amp;preview_ref=preview_v1_${'a'.repeat(64)}`)
    expect(html).toContain(`/arkme-self/api/extension-preview?extension_id=ext-preview&amp;preview_ref=preview_v1_${'b'.repeat(64)}`)
    expect(html).not.toContain('https://')
  })

  it('hides an empty preview gallery and keeps selection inside the current ordered refs', () => {
    const Gallery = previewModule.ArkmeExtensionPreviewGallery
    const previews: ArkmeExtensionPreviewItem[] = [
      {
        preview_ref: `preview_v1_${'a'.repeat(64)}`, content_type: 'image/png', preview_size: 1024,
        width: 1280, height: 720, created_at: 1,
      },
      {
        preview_ref: `preview_v1_${'b'.repeat(64)}`, content_type: 'image/webp', preview_size: 2048,
        width: 800, height: 600, created_at: 2,
      },
    ]
    const empty = Gallery === undefined ? '' : renderToStaticMarkup(<Gallery
      extensionId="ext-preview"
      extensionName="预览扩展"
      previews={[]}
    />)

    expect(empty).toBe('')
    expect(previewModule.extensionPreviewSelection?.(previews[1]!.preview_ref, previews)).toBe(previews[1]!.preview_ref)
    expect(previewModule.extensionPreviewSelection?.('preview_v1_missing', previews)).toBe(previews[0]!.preview_ref)
    expect(previewModule.extensionPreviewSelection?.(undefined, [])).toBeUndefined()
    expect(previewModule.arkmeExtensionPreviewUrl?.('ext/a', previews[0]!.preview_ref)).toBe(
      `/arkme-self/api/extension-preview?extension_id=ext%2Fa&preview_ref=preview_v1_${'a'.repeat(64)}`,
    )
  })

  it('uses the client semantic primary action pair and the shared accessible switch proportions', () => {
    expect(ARKME_EXTENSION_PRIMARY_ACTION_BG).toContain('--dsw-alias-button-primary-fill')
    expect(ARKME_EXTENSION_PRIMARY_ACTION_FG).toContain('--dsw-alias-label-primary-inverted')
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

  it('keeps fallback extension icons and install actions theme-aware', () => {
    const html = renderToStaticMarkup(<ExtensionCard
      item={{
        extension_id: 'ext-no-icon', name: '无图标扩展', description: '', visibility: 'public', version: '1.0.0',
        manifest: {
          format: 'arkme-cordis-extension', format_version: 1, name: '无图标扩展', description: '', version: '1.0.0',
          runtime: { dsh: '*', arkme_provider_contract: 1 }, halves: { host: true, client: false },
          permissions: [], entrypoints: { host: 'host.js' },
        },
      }}
      actionLabel="安装"
      onClick={() => {}}
      onAction={() => {}}
    />)

    expect(html).toContain('--dsw-alias-bg-module-platform')
    expect(html).toContain('--dsw-alias-button-primary-fill')
    expect(html).toContain('--dsw-alias-label-primary-inverted')
    expect(html).not.toContain('--dsw-alias-fill-secondary')
  })

  it('keeps the post-install restart dialog readable in dark mode and while restarting', () => {
    const ready = renderToStaticMarkup(<ArkmeExtensionRestartDialog
      kind="apply" restarting={false} onLater={() => {}} onRestart={() => {}}
    />)
    const restarting = renderToStaticMarkup(<ArkmeExtensionRestartDialog
      kind="apply" restarting onLater={() => {}} onRestart={() => {}}
    />)
    const unavailable = renderToStaticMarkup(<ArkmeExtensionRestartDialog
      kind="unavailable" restarting={false} onLater={() => {}} onRestart={() => {}}
    />)

    expect(ARKME_EXTENSION_RESTART_SURFACE).toContain('--dsw-specific-menu')
    expect(ready).toContain('role="alertdialog"')
    expect(ready).toContain('--dsw-specific-menu')
    expect(ready).toContain('--dsw-alias-label-primary')
    expect(ready).toContain('--dsw-alias-label-secondary')
    expect(ready).toContain('--dsw-alias-button-primary-fill')
    expect(ready).toContain('--dsw-alias-label-primary-inverted')
    expect(ready).toContain('立即重启')
    expect(restarting).toContain('正在重启…')
    expect(restarting).toContain('opacity:0.62')
    expect(restarting.match(/disabled=""/g)).toHaveLength(2)
    expect(unavailable).toContain('插件不可用')
    expect(unavailable).toContain('插件运行失败，已自动停用。')
    expect(unavailable).toContain('知道了')
    expect(unavailable).not.toContain('需要重启 DSH')
    expect(unavailable).not.toContain('立即重启')
    expect(unavailable).not.toContain('harness.defineTool')
  })

  it('opens the unavailable dialog instead of retrying restart for a quarantined extension', () => {
    expect(extensionEnableUnavailable({ unavailable: {
      code: 'runtime-load-failed', message: '插件运行失败，已自动停用。',
    } } as never, true)).toBe(true)
    expect(extensionEnableUnavailable({ unavailable: {
      code: 'runtime-load-failed', message: '插件运行失败，已自动停用。',
    } } as never, false)).toBe(false)
    expect(extensionEnableUnavailable(undefined, true)).toBe(false)
  })

  it('renders only the version in catalog card metadata', () => {
    const html = renderToStaticMarkup(<ExtensionCard
      item={{
        extension_id: 'ext-public', name: '公开扩展', description: '', visibility: 'public', version: '1.0.0',
        manifest: {
          format: 'arkme-cordis-extension', format_version: 1, name: '公开扩展', description: '', version: '1.0.0',
          runtime: { dsh: '*', arkme_provider_contract: 1 }, halves: { host: true, client: true },
          permissions: ['files.read'], entrypoints: { host: 'host.js', client: 'client.js' },
        },
      }}
      onClick={() => {}}
    />)
    expect(html).toContain('公开扩展')
    expect(html).toContain('v1.0.0')
    expect(html).not.toContain('Host + Client')
    expect(html).not.toContain('项权限')
  })

  it('maps real download bytes into the install progress stage', () => {
    expect(extensionInstallPercent({ phase: 'downloading', downloadedBytes: 25, totalBytes: 100 })).toBe(25)
    expect(extensionInstallPercent({ phase: 'downloading', downloadedBytes: 100, totalBytes: 100 })).toBe(75)
    expect(extensionInstallPercent({ phase: 'verifying' })).toBe(80)
    expect(extensionInstallPercent({ phase: 'active' })).toBe(100)
    expect(formatExtensionBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('surfaces an asynchronously failed install task instead of silently restoring the install button', () => {
    expect(extensionInstallFailureMessage({
      taskId: 'task-1', extensionId: 'ext-1', sessionId: 'profile:instance-1',
      phase: 'failed', done: true, updatedAtMillis: 1,
      message: '扩展需要 DSH >=0.1.0-rc.7',
      error: { code: 'extension-dsh-incompatible', message: '扩展需要 DSH >=0.1.0-rc.7', retryable: false },
    })).toBe('扩展需要 DSH >=0.1.0-rc.7')
    expect(extensionInstallFailureMessage({
      taskId: 'task-2', extensionId: 'ext-1', sessionId: 'profile:instance-1',
      phase: 'installed', done: true, updatedAtMillis: 2, message: '扩展已安装',
    })).toBeUndefined()
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

  it('keeps only the version in card metadata and hides normal update status copy', () => {
    expect(extensionVersionLabel({ latest_stable_version: '1.2.3' })).toBe('v1.2.3')
    expect(extensionVersionLabel({ version: '2.0.0', latest_stable_version: '1.2.3' })).toBe('v2.0.0')
    expect(extensionCardMetadata({
      version: '1.0.0', latest_stable_version: '1.1.0',
      manifest: {
        format: 'arkme-cordis-extension', format_version: 1, name: '扩展', description: '', version: '1.0.0',
        runtime: { dsh: '*', arkme_provider_contract: 1 }, halves: { host: true, client: true },
        permissions: ['files.read'], entrypoints: { host: 'host.js', client: 'client.js' },
      },
    })).toBe('v1.0.0')
    expect(extensionUpdateCardStatus({
      extension_id: 'ext-1', installed_version: '1.0.0', latest_version: '1.1.0',
      update_available: true, revoked: false,
    })).toBeUndefined()
    expect(extensionUpdateCardStatus({
      extension_id: 'ext-1', installed_version: '1.0.0', update_available: false,
      revoked: true, revocation_reason: '版本已撤销',
    })).toBe('版本已撤销')
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
      published: { extensionId: 'ext-1', version: '1.0.0', visibility: 'private', iconRef: `icon_v1_${'a'.repeat(64)}` },
      publish: { allowed: true, mode: 'version' },
    }

		const html = renderToStaticMarkup(<MyExtensionCard item={item} onPublish={() => {}} onEdit={() => {}} onOpen={() => {}} />)

    expect(html).toContain('天气助手')
    expect(html).toContain('Cordis 临时')
    expect(html).toContain('已持久化')
    expect(html).toContain('已发布')
    expect(html).not.toContain('发布新版本')
    expect(html).toContain('>编辑</button>')
		expect(html).toContain('>详情</button>')
    expect(html.indexOf('天气助手')).toBeLessThan(html.indexOf('Cordis 临时'))
    expect(html.indexOf('Cordis 临时')).toBeLessThan(html.indexOf('天气卡片'))
    expect(html).toContain('border-radius:999px')
    expect(html).not.toContain('更换头像')
    expect(html).not.toContain('上传头像')
    expect(html).toContain('v1.0.0')
    expect(html).not.toContain('>Host</span>')
    expect(html).not.toContain('>Client</span>')
    expect(html).toContain(`/arkme-self/api/extension-icon?extension_id=ext-1&amp;icon_ref=icon_v1_${'a'.repeat(64)}`)
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
    expect(html).toContain('accept="image/*"')
		expect(html).toContain('GitHub 仓库（可选）')
		expect(html).toContain('placeholder="https://github.com/owner/repository"')
  })

  it('keeps preview image management out of the extension edit dialog', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionEditDialog
      item={{
        ownedRef: 'owned-ref', name: '天气助手', description: '天气卡片', states: ['published'],
        halves: { host: true, client: true },
        published: {
          extensionId: 'ext-1', version: '1.0.0', visibility: 'private',
          previewImages: [{
            preview_ref: `preview_v1_${'a'.repeat(64)}`, content_type: 'image/png', preview_size: 4,
            width: 640, height: 360, created_at: 1,
          }],
          previewRevision: 1,
        },
        publish: { allowed: false, reason: '已发布' },
      }}
      busy={false}
      error=""
      onCancel={() => {}}
      onSubmit={() => {}}
    />)

    expect(html).not.toContain('扩展预览图')
    expect(html).not.toContain('multiple=""')
    expect(html).not.toContain('accept="image/png,image/jpeg,image/webp"')
    expect(html).not.toContain('aria-label="删除第 1 张预览图"')
    expect(html).toContain('max-height:calc(100% - 32px)')
    expect(html).toContain('overflow-y:auto')
  })
})
