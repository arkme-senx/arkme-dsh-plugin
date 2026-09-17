import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { EmailBindDialog } from '../src/client/ArkmeSettingsSurface.js'
import type { ArkmeUserProfile } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), captcha: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/geetest.js', () => ({ verifyPhoneCaptcha: mocks.captcha }))
const profile: ArkmeUserProfile = {
  userId: 42, displayName: 'test', nickname: 'test', avatarRef: '', arkmeId: 'test42', accountType: 1, createdAt: 1,
  bindings: { apple: false, wechat: true, google: false }, contact: { phoneMasked: '138****0000' },
}
describe('email bind dialog', () => {
  it('retries only the profile refresh after a successful binding', async () => {
    mocks.call.mockReset()
    mocks.call.mockResolvedValueOnce({ bound: true }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ profile: { ...profile, contact: { emailMasked: 'a***@example.com' } } })
    const onClose = vi.fn(), onUpdated = vi.fn()
    const renderer = create(<EmailBindDialog profile={profile} onClose={onClose} onUpdated={onUpdated} />)
    act(() => renderer.root.findByProps({ type: 'email' }).props.onChange({ target: { value: 'a@example.com' } }))
    act(() => renderer.root.findByProps({ inputMode: 'numeric' }).props.onChange({ target: { value: '1234' } }))
    await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(onClose).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ role: 'alert' }).children).toContain('offline')
    await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(mocks.call.mock.calls.map(c => c[0])).toEqual(['auth.email.bind', 'user.profile.refresh', 'user.profile.refresh'])
    expect(onUpdated).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    renderer.unmount()
  })
  it('prevents duplicate sending and displays send failures without closing', async () => {
    mocks.call.mockReset()
    let reject!: (error: Error) => void
    mocks.call.mockReturnValue(new Promise((_, r) => { reject = r }))
    const onClose = vi.fn()
    const renderer = create(<EmailBindDialog profile={profile} onClose={onClose} onUpdated={() => {}} />)
    act(() => renderer.root.findByProps({ type: 'email' }).props.onChange({ target: { value: 'a@example.com' } }))
    const send = renderer.root.findAllByType('button').find(b => b.children.includes('发送验证码'))!
    act(() => { send.props.onClick(); send.props.onClick() })
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(send.props.disabled).toBe(true)
    await act(async () => { reject(new Error('该邮箱已绑定其他账号')) })
    expect(onClose).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ role: 'alert' }).children).toContain('该邮箱已绑定其他账号')
    expect(send.props.disabled).toBe(false)
    renderer.unmount()
  })
})
