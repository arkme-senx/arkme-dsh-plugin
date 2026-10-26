import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
import { callArkme } from '../src/client/api.js'
import { usePasswordLogin, type ArkmePasswordLoginFields } from '../src/client/use-password-login.js'
import { defaultArkmeLoginTranslate as t } from '../src/client/arkme-login-locales.js'

let renderer: ReactTestRenderer | undefined
afterEach(() => { act(() => { renderer?.unmount() }); renderer = undefined; vi.clearAllMocks() })

function setup() {
  let fields: ArkmePasswordLoginFields
  const options = { active: true, agreed: true, busy: false, t, setBusy: vi.fn(), setSubmitBusy: vi.fn(), setError: vi.fn(), acceptAuthSnapshot: vi.fn() }
  function Probe({ active = true }: { active?: boolean }) { fields = usePasswordLogin({ ...options, active }); return null }
  act(() => { renderer = create(<Probe />) })
  return { fields: () => fields!, options, deactivate: () => act(() => { renderer!.update(<Probe active={false} />) }) }
}

describe('password login UI lifecycle', () => {
  it('validates empty input and agreement before any Host request', () => {
    const { fields, options } = setup()
    act(() => { fields().onSubmit() })
    expect(options.setError).toHaveBeenLastCalledWith('请输入有效的账号')
    act(() => { fields().onAccountChange('review') })
    act(() => { fields().onSubmit() })
    expect(options.setError).toHaveBeenLastCalledWith('请输入有效的密码')
    options.agreed = false
    act(() => { fields().onPasswordChange('pwd') })
    act(() => { fields().onSubmit() })
    expect(options.setError).toHaveBeenLastCalledWith('请阅读并同意用户协议和隐私条款')
    expect(callArkme).not.toHaveBeenCalled()
  })

  it('submits once, preserves account, clears password on success and accepts the shared snapshot', async () => {
    let resolve!: (value: unknown) => void
    vi.mocked(callArkme).mockImplementation(() => new Promise(done => { resolve = done }) as never)
    const { fields, options } = setup()
    act(() => { fields().onAccountChange(' review '); fields().onPasswordChange(' pwd ') })
    act(() => { fields().onSubmit(); fields().onSubmit() })
    expect(callArkme).toHaveBeenCalledTimes(1)
    expect(callArkme).toHaveBeenCalledWith('auth.password.login', { account: 'review', password: ' pwd ' }, expect.any(AbortSignal))
    const snapshot = { status: 'authenticated', userId: 42, environment: 'test' }
    await act(async () => { resolve(snapshot) })
    expect(options.acceptAuthSnapshot).toHaveBeenCalledWith(snapshot)
    expect(fields().password).toBe('')
    expect(fields().account).toBe(' review ')
    expect(options.setBusy).toHaveBeenLastCalledWith(false)
  })

  it('clears the password and cancels a late response when the login surface closes', async () => {
    let resolve!: (value: unknown) => void
    vi.mocked(callArkme).mockImplementation(() => new Promise(done => { resolve = done }) as never)
    const { fields, options, deactivate } = setup()
    act(() => { fields().onAccountChange('review'); fields().onPasswordChange('pwd') })
    act(() => { fields().onSubmit() })
    const signal = vi.mocked(callArkme).mock.calls.at(-1)![2]!
    deactivate()
    expect(signal.aborted).toBe(true)
    expect(fields().password).toBe('')
    await act(async () => { resolve({ status: 'authenticated' }) })
    expect(options.acceptAuthSnapshot).not.toHaveBeenCalled()
  })
})
