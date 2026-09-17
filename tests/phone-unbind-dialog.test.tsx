import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { PhoneBindDialog } from '../src/client/ArkmeSettingsSurface.js'
import type { ArkmeUserProfile } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), captcha: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/geetest.js', () => ({ verifyPhoneCaptcha: mocks.captcha }))
const profile: ArkmeUserProfile = {
  userId: 42, displayName: 'test', nickname: 'test', avatarRef: '', arkmeId: 'test42', accountType: 1, createdAt: 1,
  bindings: { apple: false, wechat: true, google: false }, contact: { phoneMasked: '138****0000' },
}
describe('phone unbind dialog', () => {
  it('does not repeat the entry check while pending or update a closed dialog', async () => {
    mocks.call.mockReset()
    let finish!: (value: unknown) => void
    mocks.call.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const onClose = vi.fn()
    const renderer = create(<PhoneBindDialog config={undefined} profile={profile} onClose={onClose} onUpdated={() => {}} />)
    const enter = renderer.root.findAllByType('button').find(b => b.children.includes('解绑手机号'))!.props.onClick
    act(() => { enter(); enter() })
    expect(mocks.call).toHaveBeenCalledTimes(1)
    act(() => renderer.unmount())
    await act(async () => { finish({ allowed: true }); await Promise.resolve() })
    expect(onClose).not.toHaveBeenCalled()
  })
  it.each(['denied', 'offline', 'missing'])('keeps the change form when eligibility is %s', async scenario => {
    mocks.call.mockReset()
    mocks.captcha.mockReset()
    if (scenario === 'offline') mocks.call.mockRejectedValue(new Error('offline'))
    else mocks.call.mockResolvedValue(scenario === 'denied' ? { allowed: false } : {})
    const renderer = create(<PhoneBindDialog config={undefined} profile={profile} onClose={() => {}} onUpdated={() => {}} />)
    await act(async () => {
      renderer.root.findAllByType('button').find(b => b.children.includes('解绑手机号'))!.props.onClick()
      await Promise.resolve()
    })
    expect(renderer.root.findAllByType('input').filter(i => i.props.inputMode === 'tel')).toHaveLength(1)
    expect(renderer.root.findByProps({ role: 'status' }).children.join('')).not.toBe('')
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(mocks.call).toHaveBeenCalledWith('auth.phone.unbind.check', { expectedUserId: 42 })
    expect(mocks.captcha).not.toHaveBeenCalled()
    renderer.unmount()
  })
  it('closes into the binding gate without fetching an authenticated profile', async () => {
    mocks.call.mockReset()
    mocks.call.mockResolvedValue({ status: 'binding-required', environment: 'test', userId: 42 })
    const onClose = vi.fn()
    const onUpdated = vi.fn()
    const renderer = create(<PhoneBindDialog config={undefined} profile={profile} onClose={onClose} onUpdated={onUpdated} />)
    await act(async () => { mocks.call.mockResolvedValueOnce({ allowed: true }); renderer.root.findAllByType('button').find(b => b.children.includes('解绑手机号'))!.props.onClick(); await Promise.resolve() }); mocks.call.mockClear()
    act(() => { renderer.root.findAllByType('input').find(i => i.props.inputMode === 'numeric')!.props.onChange({ target: { value: '123456' } }) })
    await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); await Promise.resolve() })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onUpdated).not.toHaveBeenCalled()
    expect(mocks.call).toHaveBeenCalledTimes(1)
    renderer.unmount()
  })
  it('shows the bound phone without an editable field and prevents double submit', async () => {
    mocks.call.mockReset()
    let reject!: (reason: unknown) => void
    mocks.call.mockReturnValue(new Promise((_, no) => { reject = no }))
    const onClose = vi.fn()
    const renderer = create(<PhoneBindDialog config={undefined} profile={profile} onClose={onClose} onUpdated={() => {}} />)
    await act(async () => { mocks.call.mockResolvedValueOnce({ allowed: true }); renderer.root.findAllByType('button').find(b => b.children.includes('解绑手机号'))!.props.onClick(); await Promise.resolve() }); mocks.call.mockClear()
    expect(renderer.root.findAllByType('input').filter(i => i.props.inputMode === 'tel')).toHaveLength(0)
    expect(renderer.root.findAllByProps({ className: 'arkme-account-rule' }).some(p => p.children.includes('138****0000'))).toBe(true)
    act(() => { renderer.root.findAllByType('input').find(i => i.props.inputMode === 'numeric')!.props.onChange({ target: { value: '123456' } }) })
    const submit = renderer.root.findByType('form').props.onSubmit
    act(() => { submit({ preventDefault() {} }); submit({ preventDefault() {} }) })
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(mocks.call).toHaveBeenCalledWith('auth.phone.unbind', { code: '123456' })
    await act(async () => { reject(new Error('验证码错误')); await Promise.resolve() })
    expect(onClose).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ role: 'status' }).children.join('')).toContain('验证码错误')
    renderer.unmount()
  })
  it('does not publish late auth or close callbacks after unmount', async () => {
    mocks.call.mockReset()
    let finish!: (value: unknown) => void
    mocks.call.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const onClose = vi.fn()
    const onUpdated = vi.fn()
    const renderer = create(<PhoneBindDialog config={undefined} profile={profile} onClose={onClose} onUpdated={onUpdated} />)
    await act(async () => { mocks.call.mockResolvedValueOnce({ allowed: true }); renderer.root.findAllByType('button').find(b => b.children.includes('解绑手机号'))!.props.onClick(); await Promise.resolve() }); mocks.call.mockClear()
    act(() => { renderer.root.findAllByType('input').find(i => i.props.inputMode === 'numeric')!.props.onChange({ target: { value: '123456' } }) })
    act(() => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    act(() => { renderer.unmount() })
    const publish = vi.spyOn(arkmeAuthStore, 'setAuth')
    try {
      await act(async () => { finish({ status: 'binding-required', environment: 'test', userId: 42 }); await Promise.resolve() })
      expect(publish).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
      expect(onUpdated).not.toHaveBeenCalled()
    } finally { publish.mockRestore() }
  })

})
