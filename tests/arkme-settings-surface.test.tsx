import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ArkmeSettingsSurface,
  VersionSettingsRow,
  aboutArkmeVersion,
} from '../src/client/ArkmeSettingsSurface.js'

describe('ArkmeSettingsSurface', () => {
  it('places update buttons before version values and reserves the shared trailing alignment column', () => {
    const appMarkup = renderToStaticMarkup(<VersionSettingsRow
      title="ArkME 客户端"
      version="v0.1.0"
      actionLabel="检查更新"
      onAction={() => {}}
    />)
    const harnessMarkup = renderToStaticMarkup(<VersionSettingsRow
      title="DeepSeek Harness"
      version="v0.1.0-rc.8"
    />)

    expect(appMarkup).toMatch(/class="arkme-redesign-version-action-slot"[\s\S]*class="arkme-redesign-update-button"[\s\S]*<span class="arkme-redesign-version-value">v0\.1\.0<\/span><span class="arkme-redesign-trailing-slot" aria-hidden="true"><\/span>/)
    expect(harnessMarkup).toContain('arkme-redesign-version-row is-without-action')
    expect(harnessMarkup).toContain('<span class="arkme-redesign-version-value">v0.1.0-rc.8</span><span class="arkme-redesign-trailing-slot" aria-hidden="true"></span>')
    expect(harnessMarkup).not.toContain('arkme-redesign-version-action-slot')
  })

  it('shows an accessible spinner while a version check is running', () => {
    const markup = renderToStaticMarkup(<VersionSettingsRow
      title="ArkME 客户端"
      version="v0.1.0"
      feedback="正在检查更新…"
      actionLabel="检查中…"
      loading
      disabled
      onAction={() => {}}
    />)

    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('aria-label="正在检查 ArkME 客户端更新"')
    expect(markup).toContain('class="arkme-icon-spin"')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('>检查中…</button>')
  })

  it('uses the desktop-injected APP version when the update bridge has no status yet', () => {
    expect(aboutArkmeVersion(undefined, { arkmeDesktop: { appVersion: '0.1.0' } })).toBe('v0.1.0')
    expect(aboutArkmeVersion('1.2.0', { arkmeDesktop: { appVersion: '0.1.0' } })).toBe('v0.1.0')
  })

  it('groups the Demo account, general, Arkme and about settings in the plugin surface', () => {
    Object.defineProperty(globalThis, 'arkmeDesktop', {
      configurable: true,
      value: { appVersion: '0.1.0', harnessVersion: '0.1.0-rc.8' },
    })
    const markup = renderToStaticMarkup(<ArkmeSettingsSurface />)
    Reflect.deleteProperty(globalThis, 'arkmeDesktop')

    expect(markup).toContain('aria-label="Arkme 设置"')
    expect(markup).toContain('>账户<')
    expect(markup).toContain('>个人资料<')
    expect(markup).toMatch(/当前余量[\s\S]*正在加载余量…[\s\S]*充值/)
    expect(markup).toContain('>登录与安全<')
    expect(markup).toContain('>通用<')
    expect(markup).toContain('>外观<')
    expect(markup).toContain('>通知<')
    expect(markup).toMatch(/>通知<\/strong><span class="arkme-redesign-setting-summary">[^<]+<\/span><span class="arkme-redesign-trailing-slot" aria-hidden="true"><\/span>/)
    expect(markup).toContain('>Arkme<')
    expect(markup).toContain('>执行前确认<')
    expect(markup).toContain('>可读取内容<')
    expect(markup).toContain('>关于<')
    expect(markup).not.toContain('id="arkme-settings-update"')
    expect(markup).not.toContain('<h2>更新</h2>')
    expect(markup).not.toContain('>关于 Arkme<')
    expect(markup).toMatch(/ArkME 客户端[\s\S]*检查更新[\s\S]*v0\.1\.0[\s\S]*ArkME 插件[\s\S]*检查更新[\s\S]*v…[\s\S]*DeepSeek Harness[\s\S]*v0\.1\.0-rc\.8/)
    expect(markup).toContain('aria-label="检查 ArkME 客户端更新"')
    expect(markup).toContain('aria-label="检查 ArkME 插件更新"')
    expect(markup.match(/>检查更新<\/button>/g)).toHaveLength(2)
    expect(markup).toContain('>用户协议<')
    expect(markup).toContain('>隐私条款<')
  })
})
