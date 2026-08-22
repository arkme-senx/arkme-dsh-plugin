import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeSettingsSurface } from '../src/client/ArkmeSettingsSurface.js'

describe('ArkmeSettingsSurface', () => {
  it('groups the Demo account, general, Arkme and about settings in the plugin surface', () => {
    const markup = renderToStaticMarkup(<ArkmeSettingsSurface />)

    expect(markup).toContain('aria-label="Arkme 设置"')
    expect(markup).toContain('>账户<')
    expect(markup).toContain('>个人资料<')
    expect(markup).toMatch(/当前余量[\s\S]*正在加载余量…[\s\S]*充值/)
    expect(markup).toContain('>登录与安全<')
    expect(markup).toContain('>通用<')
    expect(markup).toContain('>外观<')
    expect(markup).toContain('>通知<')
    expect(markup).toContain('>Arkme<')
    expect(markup).toContain('>执行前确认<')
    expect(markup).toContain('>可读取内容<')
    expect(markup).toContain('>更新<')
    expect(markup).toContain('>APP<')
    expect(markup).toContain('>核心插件<')
    expect(markup).toContain('>关于<')
    expect(markup).toContain('>关于 Arkme<')
    expect(markup).toContain('版本 v…')
    expect(markup).toContain('>用户协议<')
    expect(markup).toContain('>隐私条款<')
  })
})
