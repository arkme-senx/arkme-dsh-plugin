import { renderToStaticMarkup } from 'react-dom/server'
import { create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  ArkmeSettingsSurface,
  BackgroundSoundSettingsRow,
  VersionSettingsRow,
  aboutArkmeVersion,
  aboutHarnessVersion,
  describeArkmeBackgroundSoundSetting,
  resolveArkmeBackgroundSoundEligibility,
  scrollArkmeSettingsSurface,
} from '../src/client/ArkmeSettingsSurface.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import pluginManifest from '../package.json' with { type: 'json' }

describe('ArkmeSettingsSurface', () => {
  it('renders the text background-sound preference as an accessible real switch', () => {
    const disabled = renderToStaticMarkup(<BackgroundSoundSettingsRow
      checked={false}
      busy={false}
      description="未开启；开启后会在首次输入时请求麦克风权限"
      onChange={() => {}}
    />)
    const enabled = renderToStaticMarkup(<BackgroundSoundSettingsRow
      checked
      busy
      description="已开启，输入时自动记录环境背景音并随本条快记保存"
      onChange={() => {}}
    />)

    expect(disabled).toContain('>文字背景音<')
    expect(disabled).toContain('role="switch"')
    expect(disabled).toContain('aria-label="文字背景音"')
    expect(disabled).toContain('aria-checked="false"')
    expect(disabled).toContain('首次输入时请求麦克风权限')
    expect(enabled).toContain('aria-checked="true"')
    expect(enabled).toContain('aria-busy="true"')
    expect(enabled).toContain('disabled=""')
    expect(enabled).toContain('自动记录环境背景音')

    const onChange = vi.fn()
    const renderer = create(<BackgroundSoundSettingsRow
      checked={false}
      busy={false}
      description="未开启"
      onChange={onChange}
    />)
    renderer.root.findByProps({ role: 'switch' }).props.onClick()
    expect(onChange).toHaveBeenCalledWith(true)
    renderer.unmount()
  })

  it('keeps the background-sound setting unavailable when the Host capability is absent', () => {
    const markup = renderToStaticMarkup(<BackgroundSoundSettingsRow
      checked={false}
      busy={false}
      disabled
      description="当前 Arkme Host 不支持文字背景音"
      onChange={() => { throw new Error('unsupported switch must not run') }}
    />)

    expect(markup).toContain('当前 Arkme Host 不支持文字背景音')
    expect(markup).toContain('role="switch"')
    expect(markup).toContain('aria-checked="false"')
    expect(markup).toContain('disabled=""')
  })

  it('fail-closes free and unverifiable memberships with distinct settings guidance', () => {
    expect(resolveArkmeBackgroundSoundEligibility({
      eligible: true,
      eligibilityReason: 'eligible',
    })).toBe('eligible')
    expect(resolveArkmeBackgroundSoundEligibility({
      eligible: false,
      eligibilityReason: 'membership-required',
    })).toBe('membership-required')
    expect(resolveArkmeBackgroundSoundEligibility({
      eligible: false,
      eligibilityReason: 'membership-unavailable',
    })).toBe('membership-unavailable')
    expect(resolveArkmeBackgroundSoundEligibility(undefined)).toBe('membership-unavailable')

    const freeDescription = describeArkmeBackgroundSoundSetting({
      capability: 'supported',
      eligibility: 'membership-required',
      enabled: true,
      permission: 'granted',
    })
    const unknownDescription = describeArkmeBackgroundSoundSetting({
      capability: 'supported',
      eligibility: 'membership-unavailable',
      enabled: true,
      permission: 'granted',
    })
    expect(freeDescription).toBe('免费版暂不支持背景音')
    expect(unknownDescription).toBe('暂时无法确认会员权益')
    expect(describeArkmeBackgroundSoundSetting({
      capability: 'supported',
      eligibility: 'eligible',
      enabled: true,
      permission: 'prompt',
    })).toBe('已开启，首次输入时会请求麦克风权限')
    expect(describeArkmeBackgroundSoundSetting({
      capability: 'supported',
      eligibility: 'eligible',
      enabled: true,
      permission: 'denied',
    })).toContain('输入时检测到麦克风权限已拒绝')

    for (const description of [freeDescription, unknownDescription]) {
      const markup = renderToStaticMarkup(<BackgroundSoundSettingsRow
        checked={false}
        busy={false}
        disabled
        description={description}
        onChange={() => { throw new Error('ineligible switch must not run') }}
      />)
      expect(markup).toContain('aria-checked="false"')
      expect(markup).toContain('disabled=""')
      expect(markup).toContain(description)
    }
  })

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
    expect(aboutHarnessVersion({ arkmeDesktop: { harnessVersion: '0.1.0-rc.8' } })).toBe('v0.1.0-rc.8')
    expect(aboutHarnessVersion({})).toBe('v…')
  })

  it('renders only functional account settings in the plugin surface', () => {
    Object.defineProperty(globalThis, 'arkmeDesktop', {
      configurable: true,
      value: { appVersion: '0.1.0', harnessVersion: '0.1.0-rc.8' },
    })
    const markup = renderToStaticMarkup(<ArkmeSettingsSurface />)
    Reflect.deleteProperty(globalThis, 'arkmeDesktop')

    expect(markup).toContain('aria-label="Arkme 设置"')
    expect(markup).toContain('>账户<')
    expect(markup).toContain('>通用<')
    expect(markup).toContain('>通知<')
    expect(markup).toMatch(/>通知<\/strong><span class="arkme-redesign-setting-summary">[^<]+<\/span><span class="arkme-redesign-trailing-slot" aria-hidden="true"><\/span>/)
    expect(markup).toContain('id="arkme-settings-about"')
    expect(markup).toContain('<h2>更新</h2>')
    expect(markup).not.toContain('>关于 Arkme<')
    expect(markup).toContain('>ArkME 客户端<')
    expect(markup).toContain('>ArkME 插件<')
    expect(markup).toContain('>DeepSeek Harness<')
    expect(markup).toMatch(/ArkME 插件[\s\S]*DeepSeek Harness/)
    expect(markup).toContain('aria-label="检查 ArkME 客户端更新"')
    expect(markup).toContain('<span class="arkme-redesign-version-value">v0.1.0</span>')
    expect(markup).toContain(`<span class="arkme-redesign-version-value">v${pluginManifest.version}</span>`)
    expect(markup).toContain('<span class="arkme-redesign-version-value">v0.1.0-rc.8</span>')
    expect(markup).not.toContain('aria-label="检查 ArkME 插件更新"')
    expect(markup).not.toContain('aria-label="检查 DeepSeek Harness更新"')
    expect(markup).toContain('>用户协议<')
    expect(markup).toContain('>隐私条款<')
    expect(markup).not.toContain('>个人资料<')
    expect(markup).not.toContain('>登录与安全<')
    expect(markup).not.toContain('>外观<')
    expect(markup).not.toContain('>执行前确认<')
    expect(markup).not.toContain('>可读取内容<')
  })

  it('offers logout only for an authenticated account', () => {
    arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
    const loggedOut = renderToStaticMarkup(<ArkmeSettingsSurface />)
    expect(loggedOut).toContain('>当前未登录<')
    expect(loggedOut).not.toContain('>退出登录<')
    expect(loggedOut).not.toContain('>账户操作<')

    arkmeAuthStore.setAuth({ status: 'binding-required', environment: 'test', userId: 10001 })
    const bindingRequired = renderToStaticMarkup(<ArkmeSettingsSurface />)
    expect(bindingRequired).toContain('>待完成登录<')
    expect(bindingRequired).not.toContain('>退出登录<')
    expect(bindingRequired).not.toContain('>账户操作<')

    try {
      arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 10001 })
      const authenticated = renderToStaticMarkup(<ArkmeSettingsSurface />)
      expect(authenticated).toMatch(/AI 余额[\s\S]*正在加载余额…[\s\S]*充值/)
      expect(authenticated).toContain('>退出登录<')
      expect(authenticated).toContain('>文字背景音<')
      expect(authenticated).toContain('aria-label="文字背景音"')
      expect(authenticated).toContain('aria-checked="false"')
      expect(authenticated).toContain('>账户操作<')
      expect(authenticated.indexOf('>隐私条款<')).toBeLessThan(authenticated.indexOf('>账户操作<'))
      expect(authenticated.indexOf('>账户操作<')).toBeLessThan(authenticated.indexOf('>退出登录<'))
    } finally {
      arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
    }
  })

  it('resets the nearest DSH scroll owner to the top', () => {
    const outer = { parentElement: null, scrollTop: 240 }
    const wrapper = { parentElement: outer, scrollTop: 80 }
    const surface = {
      parentElement: wrapper,
      scrollTop: 30,
    }

    scrollArkmeSettingsSurface(
      surface as unknown as HTMLElement,
      element => element === outer ? 'auto' : 'visible',
    )

    expect(outer.scrollTop).toBe(0)
    expect(wrapper.scrollTop).toBe(80)
    expect(surface.scrollTop).toBe(30)
  })

  it('falls back to the surface when DSH does not expose a scroll owner', () => {
    const surface = {
      parentElement: null,
      scrollTop: 40,
    }

    scrollArkmeSettingsSurface(
      surface as unknown as HTMLElement,
      () => 'visible',
    )

    expect(surface.scrollTop).toBe(0)
  })
})
