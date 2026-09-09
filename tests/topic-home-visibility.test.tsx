import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeTopicHomeVisibility } from '../src/client/ArkmeTopicHomeVisibility.js'

const mocks = vi.hoisted(() => ({ policy: vi.fn() }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => ({ topicHomeVisibility: mocks.policy }) }))

describe('DSH topic home setting', () => {
  it('reads the server value, preserves it on a failed save and permits retry', async () => {
    mocks.policy.mockReset().mockResolvedValueOnce({ showInHome: false })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeTopicHomeVisibility sourceRef="topic-a" />) })
    const checkbox = () => renderer.root.findByType('input')
    expect(checkbox().props.checked).toBe(false)
    expect(checkbox().props.disabled).toBe(false)
    mocks.policy.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { checkbox().props.onChange({ currentTarget: { checked: true } }) })
    expect(checkbox().props.checked).toBe(false)
    expect(mocks.policy).toHaveBeenLastCalledWith('topic-a', true, expect.any(AbortSignal))
    mocks.policy.mockResolvedValueOnce({ showInHome: true })
    await act(async () => { renderer.root.findByType('button').props.onClick() })
    expect(checkbox().props.checked).toBe(true)
    expect(renderer.root.findAllByType('button')).toHaveLength(0)
    act(() => { renderer.unmount() })
  })

  it('ignores an old topic response and aborts outstanding work on unmount', async () => {
    let resolveOld!: (result: { showInHome: boolean }) => void
    mocks.policy.mockReset().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValueOnce({ showInHome: true })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeTopicHomeVisibility sourceRef="topic-a" />) })
    expect(renderer.root.findAllByType('input')).toHaveLength(0)
    expect(renderer.root.findByProps({ role: 'status' }).children).toContain('正在读取设置…')
    const oldSignal = mocks.policy.mock.calls[0][2] as AbortSignal
    await act(async () => { renderer.update(<ArkmeTopicHomeVisibility sourceRef="topic-b" />) })
    expect(oldSignal.aborted).toBe(true)
    await act(async () => { resolveOld({ showInHome: false }) })
    expect(renderer.root.findByType('input').props.checked).toBe(true)
    // A completed read releases its cancellation listener. Only pending work
    // belongs to the mounted surface and must be aborted when it leaves.
    mocks.policy.mockImplementationOnce(() => new Promise(() => undefined))
    await act(async () => { renderer.update(<ArkmeTopicHomeVisibility sourceRef="topic-c" />) })
    const currentSignal = mocks.policy.mock.calls[2][2] as AbortSignal
    act(() => { renderer.unmount() })
    expect(currentSignal.aborted).toBe(true)
  })

  it('reserves a themed footer while settings are unknown', async () => {
    mocks.policy.mockReset().mockImplementation(() => new Promise(() => undefined))
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeTopicHomeVisibility sourceRef="topic-a" />) })
    const footer = renderer.root.findByType('footer')
    expect(footer.props.style).toMatchObject({ flexShrink: 0, minHeight: 72, boxSizing: 'border-box' })
    expect(renderer.root.findAllByType('input')).toHaveLength(0)
    act(() => { renderer.unmount() })
  })
})
