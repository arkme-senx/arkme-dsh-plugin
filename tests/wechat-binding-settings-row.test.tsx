import { renderToStaticMarkup } from 'react-dom/server'
import { create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { WechatBindingSettingsRow } from '../src/client/ArkmeSettingsSurface.js'

describe('WeChat binding presentation', () => {
  it.each([undefined, false, true])('does not expose an action without a real adapter (%s)', bound => {
    const markup = renderToStaticMarkup(<WechatBindingSettingsRow bound={bound} />)
    expect(markup).toContain('>微信号<')
    expect(markup).toContain(bound === undefined ? '正在读取…' : bound ? '已绑定' : '未绑定')
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('换绑')
  })

  it('suppresses binding for an already bound account even with an adapter', () => {
    const markup = renderToStaticMarkup(<WechatBindingSettingsRow bound onBind={() => {}} />)
    expect(markup).toContain('已绑定')
    expect(markup).not.toContain('<button')
  })

  it('offers binding only while unbound and prevents repeat activation while busy', () => {
    const onBind = vi.fn()
    const renderer = create(<WechatBindingSettingsRow bound={false} onBind={onBind} />)
    renderer.root.findByType('button').props.onClick()
    expect(onBind).toHaveBeenCalledTimes(1)
    renderer.update(<WechatBindingSettingsRow bound={false} onBind={onBind} busy />)
    expect(renderer.root.findAllByType('button')).toHaveLength(0)
    renderer.update(<WechatBindingSettingsRow bound={false} onBind={onBind} />)
    expect(renderer.root.findAllByType('button')).toHaveLength(1)
    renderer.update(<WechatBindingSettingsRow bound onBind={onBind} />)
    expect(renderer.root.findAllByType('button')).toHaveLength(0)
    renderer.unmount()
  })
})
