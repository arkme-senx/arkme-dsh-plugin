import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'
import * as extensionCenterModule from '../../src/client/ArkmeExtensionCenter.js'
import {
  ARKME_EXTENSION_BRAND_GREEN, ARKME_EXTENSION_DETAIL_MODAL_MAX_HEIGHT, ARKME_EXTENSION_DETAIL_MODAL_MAX_WIDTH,
  ARKME_EXTENSION_MARKETPLACE_PAGE_SIZE,
  ARKME_EXTENSION_PRIMARY_ACTION_BG, ARKME_EXTENSION_PRIMARY_ACTION_FG,
  ARKME_EXTENSION_RESTART_SURFACE, ArkmeExtensionCenter, ArkmeExtensionRestartDialog,
  ArkmeExtensionDetailHeader, ArkmeExtensionDetailMetrics, ArkmeExtensionToggle, ExtensionCard,
  extensionAuthorLabel, extensionCardMetadata, extensionCatalogAction, extensionCommunityAuthor, extensionDirectInstallTarget,
  classificationStatusHint, extensionDetailHasPreviews, extensionDetailMetricLabels, extensionEnableUnavailable,
  extensionInstallFailureMessage, extensionInstallOwnerId, extensionInstallPercent, extensionTabLoadMode, extensionUpdateCardStatus,
  extensionVersionLabel, installedExtensionCatalogItem,
  extensionNativeInstallWarning, formatCompactCount, formatExtensionBytes, formatMarketplaceDate, marketplaceListParams, MyExtensionCard, shouldLoadMoreDiscoverPage,
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

    expect(html).toContain('aria-label="Arkme 市集"')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('width:min(860px, calc(100vw - 64px))')
    expect(html).toContain('height:min(680px, calc(100vh - 64px))')
    expect(html).toContain('height:58px')
    expect(html).toContain('padding:0 20px')
    expect(html).toContain('aria-label="关闭市集"')
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

  it('renders the marketplace as a page with separate visible category and sort entries', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionCenter displayMode="page" />)
    expect(html).toContain('role="region"')
    expect(html).not.toContain('aria-modal="true"')
    expect(html.match(/data-market-header-layer=/g)).toHaveLength(2)
    expect(html).toContain('data-market-header-layer="primary"')
    expect(html).toContain('data-market-header-layer="secondary"')
    expect(html).toContain('data-market-page-tabs="inline"')
    expect(html.match(/data-market-page-nav-state="selected"/g)).toHaveLength(1)
    expect(html.match(/data-market-page-nav-state="idle"/g)).toHaveLength(3)
    expect(html).toContain('background:var(--dsw-alias-bg-module-platform')
    expect(html).not.toContain('border-bottom:2px solid var(--dsw-alias-state-success-primary')
    expect(html.match(/aria-label="市集页面导航"/g)).toHaveLength(1)
    expect(html).toContain('搜索扩展、功能或作者')
    expect(html).toContain('aria-label="扩展分类"')
    expect(html).toContain('分类：全部')
    expect(html).toContain('aria-label="扩展排序"')
    expect(html).toContain('排序：最新创建')
    expect(html.match(/aria-haspopup="listbox"/g)).toHaveLength(2)
    expect(html).not.toContain('排序接口完成后启用')
  })

  it('keeps only copy-link and close actions in the detail modal header', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionDetailHeader
      title="天气助手"
      copyAvailable
      copyNotice="链接已复制"
      onCopy={() => {}}
      onClose={() => {}}
    />)
    expect(html).toContain('id="arkme-extension-detail-title"')
    expect(html).toContain('天气助手')
    expect(html).toContain('aria-label="复制扩展链接"')
    expect(html).toContain('title="复制链接"')
    expect(html).toContain('aria-label="关闭扩展详情"')
    expect(html).toContain('role="status"')
    expect(html).toContain('链接已复制')
    expect(html).not.toContain('分享')

    const withoutLink = renderToStaticMarkup(<ArkmeExtensionDetailHeader
      title="无链接扩展"
      copyAvailable={false}
      onCopy={() => {}}
      onClose={() => {}}
    />)
    expect(withoutLink).not.toContain('aria-label="复制扩展链接"')
    expect(withoutLink).toContain('aria-label="关闭扩展详情"')
  })

  it('removes the preview column when an extension has no valid image', () => {
    expect(extensionDetailHasPreviews(undefined)).toBe(false)
    expect(extensionDetailHasPreviews([])).toBe(false)
    expect(extensionDetailHasPreviews([{ preview_ref: 'invalid' }])).toBe(false)
    expect(extensionDetailHasPreviews([{ preview_ref: `preview_v1_${'a'.repeat(64)}` }])).toBe(true)
  })

  it('caps the detail modal at a compact scrollable viewport', () => {
    expect(ARKME_EXTENSION_DETAIL_MODAL_MAX_WIDTH).toBe(920)
    expect(ARKME_EXTENSION_DETAIL_MODAL_MAX_HEIGHT).toBe(680)
  })

  it('renders detail metrics with the same icon-only labels as marketplace cards', () => {
    const item = {
      rating_summary: { average: 4.8, count: 328, histogram: [0, 0, 1, 20, 307] },
      install_user_count: 12_300,
      comment_count: 76,
      open_count: 41_100,
    }
    expect(extensionDetailMetricLabels(item)).toEqual(['★ 4.8', '安装 12.3k', '评论 76', '查看 41.1k'])

    const html = renderToStaticMarkup(<ArkmeExtensionDetailMetrics item={item} />)
    const visibleText = html.replace(/<[^>]+>/g, '')
    expect(html).toContain('data-extension-detail-metrics="compact"')
    expect(html).toContain('aria-label="评分 4.8"')
    expect(html).toContain('aria-label="12300 人已安装"')
    expect(html).not.toContain('328 人评分')
    expect(html).toContain('aria-label="76 条评论"')
    expect(html).toContain('aria-label="查看次数 41100"')
    expect(html).toContain('column-gap:18px')
    expect(visibleText).toBe('4.812.3k7641.1k')
    expect(html).toContain('font-size:11px')
    expect(html).toContain('font-weight:400')
    expect(html).toContain('margin-top:9px')
  })

  it('renders a dense marketplace tile with only icon, name, and a GitHub identity avatar', () => {
    const html = renderToStaticMarkup(<ExtensionCard
      presentation="community"
      item={{
        extension_id: 'github/weather', name: '天气助手', description: '快速查看天气', visibility: 'public',
        owner_user_id: 77, owner_name: 'Quaso', owner_arkme_id: 'quaso',
        owner_avatar_fallback: { kind: 'phone_default', colorIndex: 3, label: 'Q' },
        source: { type: 'github_repository', url: 'https://github.com/octocat/weather', label: 'GitHub', verification: 'publisher_attested' },
        source_author: { name: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
        rating_summary: { average: 4.8, count: 328, histogram: [0, 0, 1, 20, 307] },
        install_user_count: 12_300,
        comment_count: 76,
        open_count: 41_100,
      }}
      actionLabel="安装"
      onClick={() => {}}
      onAction={() => {}}
    />)
    expect(html).toContain('data-extension-community-card="true"')
    expect(html).toContain('border:1px solid')
    expect(html).toContain('min-height:72px')
    expect(html).toContain('data-extension-title-row="true"')
    expect(html).toContain('aria-label="查看扩展：天气助手"')
    expect(html).toContain('title="天气助手"')
    expect(html).toContain('width:34px')
    expect(html).toContain('border-radius:6px')
    expect(html).toContain('margin-top:6px')
    expect(html).toContain('data-extension-community-identity="github"')
    expect(html).toContain('data-extension-community-identity-row="github"')
    expect(html).toContain('aria-label="GitHub 来源"')
    expect(html).not.toContain('Quaso')
    expect(html).not.toContain('octocat')
    expect(html).not.toContain('avatars.githubusercontent.com')
    expect(html).not.toContain('data-extension-source-badge="github"')
    expect(html).not.toContain('data-extension-description="true"')
    expect(html).not.toContain('快速查看天气')
    expect(html).not.toContain('data-extension-metadata-row="true"')
    expect(html).not.toContain('aria-label="安装"')
    expect(html).not.toContain('>安装</button>')
    expect(html.replace(/<[^>]+>/g, '')).toBe('天气助手GitHub')
    expect(html).not.toContain('aria-label="评分 4.8"')
    expect(html).not.toContain('aria-label="12300 人已安装"')
    expect(html).not.toContain('aria-label="76 条评论"')
    expect(html).not.toContain('41.1k')
    expect(html).toContain('padding:10px 12px')
  })

  it('hides an unavailable install-user metric instead of falling back to rating participants', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionDetailMetrics item={{
      rating_summary: { average: 4.5, count: 99, histogram: [0, 0, 0, 1, 98] },
      comment_count: 7,
      open_count: 20,
    }} />)
    expect(html).toContain('aria-label="评分 4.5"')
    expect(html).not.toContain('人已安装')
    expect(html).not.toContain('99 人评分')
  })

  it('keeps lifecycle actions out of the dense marketplace tile after installation', () => {
    const html = renderToStaticMarkup(<ExtensionCard
      presentation="community"
      item={{
        extension_id: 'ext-installed', name: '已安装扩展', description: '已经安装', visibility: 'public', version: '1.1.0',
        owner_name: 'Lucis',
      }}
      installed={{
        extensionId: 'ext-installed', installedVersion: '1.0.0',
        manifest: {
          format: 'arkme-cordis-extension', format_version: 1, name: '已安装扩展', description: '已经安装', version: '1.0.0',
          runtime: { dsh: '*', arkme_provider_contract: 1 }, halves: { host: true, client: false },
          permissions: [], entrypoints: { host: 'host.js' },
        },
        enabled: true, active: true, permissionSnapshot: [], updateChannel: 'stable',
        installedAtMillis: 1, lastCheckedAtMillis: 1,
      }}
      actionLabel="更新"
      onClick={() => {}}
      onAction={() => {}}
      onToggle={() => {}}
    />)

    expect(html).toContain('data-extension-community-identity="author"')
    expect(html).toContain('data-extension-community-identity-row="author"')
    expect(html.replace(/<[^>]+>/g, '')).toBe('已安装扩展Lucis')
    expect(html).not.toContain('role="switch"')
    expect(html).not.toContain('aria-checked="true"')
    expect(html).not.toContain('>更新</button>')
  })

  it('uses a generic GitHub author label and formats compact marketplace counts', () => {
    expect(extensionCommunityAuthor({
      extension_id: 'github/weather', name: '天气助手', description: '', visibility: 'public',
      source: { type: 'github_repository', url: 'https://github.com/octocat/weather', label: 'GitHub', verification: 'publisher_attested' },
    })).toEqual({ name: 'GitHub', github: true })
    expect(extensionCommunityAuthor({
      extension_id: 'github/owned', name: '已绑定作者的 GitHub 扩展', description: '', visibility: 'public',
      owner_user_id: 77, owner_name: 'Quaso', owner_arkme_id: 'quaso',
      source: { type: 'github_repository', url: 'https://github.com/octocat/weather', label: 'GitHub', verification: 'publisher_attested' },
    })).toEqual({ name: 'GitHub', github: true })
    expect(formatCompactCount(999)).toBe('999')
    expect(formatCompactCount(2_300)).toBe('2.3k')
    expect(formatCompactCount(2_300_000)).toBe('2.3m')
    expect(formatMarketplaceDate(Date.UTC(2026, 7, 21))).toBe('2026/08/21')
  })

  it('never sends unsupported sort parameters before the backend capability is enabled', () => {
    expect(ARKME_EXTENSION_MARKETPLACE_PAGE_SIZE).toBe(70)
    expect(marketplaceListParams(' 翻译 ', 'rating', false)).toEqual({ limit: ARKME_EXTENSION_MARKETPLACE_PAGE_SIZE, query: '翻译' })
    expect(marketplaceListParams('翻译', 'rating', true, 'next-page')).toEqual({
      limit: ARKME_EXTENSION_MARKETPLACE_PAGE_SIZE, query: '翻译', sort: 'rating', cursor: 'next-page',
    })
    expect(classificationStatusHint('building')).toContain('正在更新分类')
    expect(classificationStatusHint('ready')).toBeUndefined()
    expect(classificationStatusHint('failed', '分类服务异常')).toBe('分类服务异常')
  })

  it('loads another cursor page when the compact grid is near the bottom or does not fill the viewport', () => {
    expect(shouldLoadMoreDiscoverPage({ scrollHeight: 800, scrollTop: 0, clientHeight: 800 })).toBe(true)
    expect(shouldLoadMoreDiscoverPage({ scrollHeight: 1400, scrollTop: 0, clientHeight: 800 })).toBe(false)
    expect(shouldLoadMoreDiscoverPage({ scrollHeight: 1400, scrollTop: 380, clientHeight: 800 })).toBe(true)
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
    expect(extensionNativeInstallWarning({
      execution_model: 'dsh-native', package_name: '@example/native', artifact_contract_version: 3,
      native_capabilities: ['runtime_dependencies'], audit_status: 'warning', audit_risk_level: 'high',
      audit_reason: '读取令牌并访问网络',
    })).toBe('扩展 @example/native 是V3 原生 DSH Package，将以 DSH 插件进程权限运行。 检测到：运行依赖。 AI 风险审核提示（high）：读取令牌并访问网络。确认继续安装吗？')
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
      publish: { allowed: true, mode: 'version', route: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz' },
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
      publish: { allowed: true, mode: 'new', route: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz' },
    }} onPublish={() => {}} />)

    expect(html).toContain('>发布</button>')
    expect(html).not.toContain('>仅本地</button>')
    expect(html).not.toContain('>已发布</button>')
  })

  it('renders an accessible private-by-default Cordis publish form', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionPublishDialog
      item={{
        ownedRef: 'owned-ref', name: '天气助手', description: '天气卡片', states: ['cordis'],
        halves: { host: true, client: false }, publish: { allowed: true, mode: 'new', route: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz' },
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
