import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ArkmeSettingsSurface,
  aboutArkmeVersion,
  scrollArkmeSettingsSurface,
} from '../src/client/ArkmeSettingsSurface.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'

describe('ArkmeSettingsSurface', () => {
  it('uses the desktop-injected APP version when the update bridge has no status yet', () => {
    expect(aboutArkmeVersion(undefined, { arkmeDesktop: { appVersion: '0.1.0' } })).toBe('v0.1.0')
    expect(aboutArkmeVersion('1.2.0', { arkmeDesktop: { appVersion: '0.1.0' } })).toBe('v0.1.0')
  })

  it('renders only functional account settings in the plugin surface', () => {
    const markup = renderToStaticMarkup(<ArkmeSettingsSurface />)

    expect(markup).toContain('aria-label="Arkme 设置"')
    expect(markup).toContain('>账户<')
    expect(markup).toContain('>通用<')
    expect(markup).toContain('>通知<')
    expect(markup).toContain('>更新<')
    expect(markup).toContain('>核心插件<')
    expect(markup).toContain('>关于<')
    expect(markup).toContain('>关于 Arkme<')
    expect(markup).toContain('版本 v…')
    expect(markup).toContain('>用户协议<')
    expect(markup).toContain('>隐私条款<')
    expect(markup).not.toContain('>个人资料<')
    expect(markup).not.toContain('>登录与安全<')
    expect(markup).not.toContain('>外观<')
    expect(markup).not.toContain('>执行前确认<')
    expect(markup).not.toContain('>可读取内容<')
    expect(markup).not.toContain('>APP<')
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
      expect(authenticated).toMatch(/当前余量[\s\S]*正在加载余量…[\s\S]*充值/)
      expect(authenticated).toContain('>退出登录<')
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
