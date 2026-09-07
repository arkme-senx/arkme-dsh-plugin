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
    expect(renderer.root.findByType('input').props.disabled).toBe(true)
    const oldSignal = mocks.policy.mock.calls[0][2] as AbortSignal
    await act(async () => { renderer.update(<ArkmeTopicHomeVisibility sourceRef="topic-b" />) })
    expect(oldSignal.aborted).toBe(true)
    await act(async () => { resolveOld({ showInHome: false }) })
    expect(renderer.root.findByType('input').props.checked).toBe(true)
    const currentSignal = mocks.policy.mock.calls[1][2] as AbortSignal
    act(() => { renderer.unmount() })
    expect(currentSignal.aborted).toBe(true)
  })
})
