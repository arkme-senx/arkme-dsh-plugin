import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeDirectMessageAdmission } from '../src/direct-message-admission.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call, ArkmeClientError: class extends Error {} }))
import { invalidateDirectMessageAdmission, useDirectMessageAdmission } from '../src/client/direct-message-admission.js'

const allowed: ArkmeDirectMessageAdmission = { state: 'allowed', canSend: true, refusalCreationEnabled: true, ownRefused: false, counterpartRefused: false, ownRevision: 0, counterpartRevision: 0 }
const denied: ArkmeDirectMessageAdmission = { ...allowed, state: 'refused_by_self', canSend: false, ownRefused: true, ownRevision: 1 }
let latest: ReturnType<typeof useDirectMessageAdmission>
function Probe({ account = 'test:42', source = 'source', applicable = true }) {
  latest = useDirectMessageAdmission(account, source, applicable)
  return <textarea disabled={latest.blocked} defaultValue="保留草稿" />
}
let renderer: ReactTestRenderer | undefined
afterEach(async () => { await act(async () => { renderer?.unmount() }); renderer = undefined; mocks.call.mockReset() })
describe('private message admission UI lifecycle', () => {
  it('coalesces same-frame repeated mutations', async () => {
    let finish!: (value: ArkmeDirectMessageAdmission) => void
    mocks.call.mockResolvedValue(allowed)
    await act(async () => { renderer = create(<Probe />) })
    mocks.call.mockImplementation((operation: string) => operation === 'chat.direct-message-refusal.set'
      ? new Promise(resolve => { finish = resolve }) : Promise.resolve(denied))
    let first!: Promise<void>
    let second!: Promise<void>
    await act(async () => { first = latest.toggle(); second = latest.toggle() })
    expect(mocks.call.mock.calls.filter(call => call[0] === 'chat.direct-message-refusal.set')).toHaveLength(1)
    await act(async () => { finish(denied); await Promise.all([first, second]) })
  })
  it('requeries after an uncertain mutation and an invalidation received in flight', async () => {
    let fail!: (reason: unknown) => void
    mocks.call.mockResolvedValue(allowed)
    await act(async () => { renderer = create(<Probe />) })
    mocks.call.mockImplementation((operation: string) => operation === 'chat.direct-message-refusal.set'
      ? new Promise((_resolve, reject) => { fail = reject }) : Promise.resolve(denied))
    let pending!: Promise<void>
    await act(async () => { pending = latest.toggle() })
    await act(async () => { invalidateDirectMessageAdmission() })
    await act(async () => { fail(new Error('response lost')); await pending })
    expect(latest.admission).toEqual(denied)
    expect(mocks.call.mock.calls.filter(call => call[0] === 'chat.direct-message-admission')).toHaveLength(2)
  })
  it('rollout closure blocks only new refusal, keeping messages and unrefuse available', async () => {
    mocks.call.mockResolvedValue({ ...allowed, refusalCreationEnabled: false })
    await act(async () => { renderer = create(<Probe />) })
    expect(latest.blocked).toBe(false)
    await act(async () => { await latest.toggle() })
    expect(mocks.call.mock.calls.some(call => call[0] === 'chat.direct-message-refusal.set')).toBe(false)
    mocks.call.mockResolvedValue({ ...denied, refusalCreationEnabled: false })
    await act(async () => { invalidateDirectMessageAdmission() })
    expect(latest.blocked).toBe(true)
    mocks.call.mockResolvedValue({ ...allowed, refusalCreationEnabled: false })
    await act(async () => { await latest.toggle() })
    expect(latest.blocked).toBe(false)
    expect(mocks.call.mock.calls.filter(call => call[0] === 'chat.direct-message-refusal.set')).toHaveLength(1)
  })
  it('disables input while loading/refused and does not replay a send on unrefuse', async () => {
    let resolve!: (value: ArkmeDirectMessageAdmission) => void
    mocks.call.mockImplementationOnce(() => new Promise(value => { resolve = value }))
    await act(async () => { renderer = create(<Probe />) })
    expect(renderer!.root.findByType('textarea').props.disabled).toBe(true)
    await act(async () => { resolve(denied) })
    expect(latest.blocked).toBe(true)
    expect(renderer!.root.findByType('textarea').props.defaultValue).toBe('保留草稿')
    mocks.call.mockResolvedValue(allowed)
    await act(async () => { await latest.toggle() })
    expect(latest.blocked).toBe(false)
    expect(mocks.call.mock.calls.every(call => String(call[0]).startsWith('chat.direct-message'))).toBe(true)
    expect(mocks.call.mock.calls.filter(call => call[0] === 'chat.direct-message-refusal.set')).toHaveLength(1)
  })
  it('ignores old-account responses and refreshes on invalidation without a shared fact cache', async () => {
    let resolveOld!: (value: ArkmeDirectMessageAdmission) => void
    mocks.call.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve })).mockResolvedValue(allowed)
    await act(async () => { renderer = create(<Probe />) })
    await act(async () => { renderer!.update(<Probe account="test:43" />) })
    await act(async () => { resolveOld(denied) })
    expect(latest.admission).toEqual(allowed)
    mocks.call.mockResolvedValue(denied)
    await act(async () => { invalidateDirectMessageAdmission() })
    expect(latest.admission).toEqual(denied)
  })
  it('does not query or restrict groups/pending/bot sources', async () => {
    await act(async () => { renderer = create(<Probe applicable={false} />) })
    expect(latest.blocked).toBe(false)
    expect(mocks.call).not.toHaveBeenCalled()
  })
})
