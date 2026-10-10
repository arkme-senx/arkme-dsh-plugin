import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
import { callArkme } from '../src/client/api.js'
import { ArkmeAccountCancellation } from '../src/client/ArkmeAccountCancellation.js'

let renderer: ReactTestRenderer
const result = { mode: 'immediate', status: 'eligible', cancel_at: 0, has_phone: true }
async function open(onComplete = vi.fn()) {
  await act(async () => { renderer = create(<ArkmeAccountCancellation userId={7} disabled={false} onBusyChange={() => {}} onComplete={onComplete} />) })
  await act(async () => { renderer.root.findByType('button').props.onClick() })
}
const buttons = () => renderer.root.findAllByType('button')
const confirm = () => buttons().find(b => b.props.type === 'submit')!
afterEach(() => { act(() => renderer?.unmount()); vi.mocked(callArkme).mockReset() })
describe('account cancellation confirmation', () => {
  it('requires the exact confirmation phrase before immediately canceling', async () => {
    vi.mocked(callArkme).mockResolvedValueOnce(result).mockResolvedValueOnce({ ...result, status: 'done' })
    const completed = vi.fn()
    await open(completed)
    expect(confirm().props.disabled).toBe(true)
    await act(async () => renderer.root.findByType('input').props.onChange({ target: { value: '确认注销' } }))
    expect(confirm().props.disabled).toBe(false)
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(completed).toHaveBeenCalledWith({ ...result, status: 'done' })
  })
  it('clears confirmation and displays the changed mode instead of logging out', async () => {
    vi.mocked(callArkme).mockResolvedValueOnce(result).mockResolvedValueOnce({ ...result, mode: 'waiting', changed: true })
    const completed = vi.fn()
    await open(completed)
    await act(async () => renderer.root.findByType('input').props.onChange({ target: { value: '确认注销' } }))
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(completed).not.toHaveBeenCalled()
    expect(confirm().props.disabled).toBe(true)
    expect(JSON.stringify(renderer.toJSON())).toContain('15 天')
    expect(JSON.stringify(renderer.toJSON())).toContain('短信')
  })
  it('keeps confirmation open on failure and never signals completion', async () => {
    vi.mocked(callArkme).mockResolvedValueOnce(result).mockRejectedValueOnce(new Error('服务暂不可用'))
    const completed = vi.fn()
    await open(completed)
    await act(async () => renderer.root.findByType('input').props.onChange({ target: { value: '确认注销' } }))
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(completed).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer.toJSON())).toContain('服务暂不可用')
  })
})
