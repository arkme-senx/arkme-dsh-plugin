import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeDirectMessageAdmission } from '../src/direct-message-admission.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call, ArkmeClientError: class extends Error {} }))
import { invalidateDirectMessageAdmission, requireDirectMessageSendAllowed, useDirectMessageAdmission } from '../src/client/direct-message-admission.js'
import { privateChatActions } from '../src/client/private-chat-actions-store.js'

const allowed: ArkmeDirectMessageAdmission = { state: 'allowed', canSend: true, refusalCreationEnabled: true, ownRefused: false, counterpartRefused: false, ownRevision: 0, counterpartRevision: 0 }
const denied: ArkmeDirectMessageAdmission = { ...allowed, state: 'refused_by_self', canSend: false, ownRefused: true, ownRevision: 1 }
let latest: ReturnType<typeof useDirectMessageAdmission>
function Probe({ account = 'test:42', source = 'source', applicable = true }) {
  latest = useDirectMessageAdmission(account, { sourceRef: source, kind: 'private_chat', displayName: 'Peer', activeAtMillis: 0, unreadCount: 0 }, applicable)
  return <textarea disabled={latest.blocked} defaultValue="保留草稿" />
}
let renderer: ReactTestRenderer | undefined
afterEach(async () => { await act(async () => { renderer?.unmount() }); renderer = undefined; privateChatActions.activateAccount(undefined); privateChatActions.reset(); mocks.call.mockReset(); vi.unstubAllGlobals() })
describe('private message admission UI lifecycle', () => {
  it('one click recovers unknown state, confirms and uses the queried revision', async () => {
    mocks.call.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { renderer = create(<Probe />) })
    mocks.call.mockResolvedValueOnce({ ...allowed, ownRevision: 7 }).mockResolvedValue({ ...denied, ownRevision: 8 })
    const confirm = vi.fn(() => true)
    await act(async () => { await latest.toggle(confirm) })
    expect(confirm).toHaveBeenCalledOnce()
    expect(mocks.call.mock.calls.filter(call => call[0] === 'chat.direct-message-refusal.set')[0]?.[1])
      .toEqual({ sourceRef: 'source', refused: true, expectedRevision: 7 })
    expect(latest.admission?.ownRefused).toBe(true)
  })
  it('cancelling recovered refusal keeps normal messaging and does not mutate', async () => {
    mocks.call.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { renderer = create(<Probe />) })
    mocks.call.mockResolvedValue(allowed)
    await act(async () => { await latest.toggle(() => false) })
    expect(latest.blocked).toBe(false)
    expect(latest.busy).toBe(false)
    expect(mocks.call.mock.calls.some(call => call[0] === 'chat.direct-message-refusal.set')).toBe(false)
  })
  it('failed recovery never invents a revision or blocks normal messages', async () => {
    mocks.call.mockRejectedValue(new Error('offline'))
    await act(async () => { renderer = create(<Probe />) })
    const confirm = vi.fn(() => true)
    await act(async () => { await latest.toggle(confirm) })
    expect(confirm).not.toHaveBeenCalled()
    expect(latest.blocked).toBe(false)
    expect(latest.busy).toBe(false)
    expect(mocks.call.mock.calls.some(call => call[0] === 'chat.direct-message-refusal.set')).toBe(false)
    expect(mocks.call).toHaveBeenCalledTimes(2)
  })
  it('changing conversation during recovery prevents confirmation and mutation', async () => {
    mocks.call.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { renderer = create(<Probe />) })
    let resolve!: (value: ArkmeDirectMessageAdmission) => void
    mocks.call.mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValue(allowed)
    const confirm = vi.fn(() => true)
    let pending!: Promise<void>
    await act(async () => { pending = latest.toggle(confirm) })
    await act(async () => { renderer!.update(<Probe source="another" />) })
    await act(async () => { resolve(allowed); await pending })
    expect(confirm).not.toHaveBeenCalled()
    expect(mocks.call.mock.calls.some(call => call[0] === 'chat.direct-message-refusal.set')).toBe(false)
    expect(latest.busy).toBe(false)
  })
  it('restores last successful refusal after remount without leaking between accounts or conversations', async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
    } })
    mocks.call.mockResolvedValue(denied)
    await act(async () => { renderer = create(<Probe />) })
    await act(async () => { renderer!.unmount() })
    mocks.call.mockRejectedValue(new Error('offline'))
    await act(async () => { renderer = create(<Probe />) })
    expect(latest.blocked).toBe(true)
    await act(async () => { renderer!.update(<Probe account="test:43" />) })
    expect(latest.blocked).toBe(false)
    await act(async () => { renderer!.update(<Probe source="another" />) })
    expect(latest.blocked).toBe(false)
    await act(async () => { renderer!.update(<Probe />) })
    expect(latest.blocked).toBe(true)
    mocks.call.mockResolvedValue({ ...allowed, ownRevision: 2 })
    await act(async () => { await latest.toggle() })
    await act(async () => { renderer!.unmount() })
    mocks.call.mockRejectedValue(new Error('offline'))
    await act(async () => { renderer = create(<Probe />) })
    expect(latest.blocked).toBe(false)
  })
  it.each(['{broken', JSON.stringify({ ...denied, canSend: true })])('ignores malformed persistent state: %s', async raw => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), localStorage: { getItem: () => raw } })
    mocks.call.mockRejectedValue(new Error('offline'))
    await act(async () => { renderer = create(<Probe />) })
    expect(latest.blocked).toBe(false)
  })
  it('storage failures never turn a successful query into a refusal', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), get localStorage() { throw new Error('disabled') } })
    mocks.call.mockResolvedValue(allowed)
    await act(async () => { renderer = create(<Probe />) })
    expect(latest.admission).toEqual(allowed)
    expect(latest.error).toBe('')
  })
  it('optional send preflight allows unavailable status but preserves cancellation', async () => {
    const source = { sourceRef: 'source', kind: 'private_chat' as const, displayName: 'Peer', activeAtMillis: 0, unreadCount: 0, directMessageAdmissionApplicable: true }
    mocks.call.mockRejectedValue(new Error('offline'))
    await expect(requireDirectMessageSendAllowed(source)).resolves.toBeUndefined()
    const abort = new AbortController()
    abort.abort()
    await expect(requireDirectMessageSendAllowed(source, abort.signal)).rejects.toBeDefined()
    mocks.call.mockResolvedValue(denied)
    await expect(requireDirectMessageSendAllowed(source)).rejects.toThrow('你已拒收对方的消息')
  })
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
    mocks.call.mockResolvedValue({ ...allowed, refusalCreationEnabled: false, ownRevision: 2 })
    await act(async () => { renderer = create(<Probe />) })
    expect(latest.blocked).toBe(false)
    await act(async () => { await latest.toggle() })
    expect(mocks.call.mock.calls.some(call => call[0] === 'chat.direct-message-refusal.set')).toBe(false)
    mocks.call.mockResolvedValue({ ...denied, refusalCreationEnabled: false, ownRevision: 3 })
    await act(async () => { invalidateDirectMessageAdmission() })
    expect(latest.blocked).toBe(true)
    mocks.call.mockResolvedValue({ ...allowed, refusalCreationEnabled: false, ownRevision: 4 })
    await act(async () => { await latest.toggle() })
    expect(latest.blocked).toBe(false)
    expect(mocks.call.mock.calls.filter(call => call[0] === 'chat.direct-message-refusal.set')).toHaveLength(1)
  })
  it('allows unknown state, disables known refusal and never replays on unrefuse', async () => {
    let resolve!: (value: ArkmeDirectMessageAdmission) => void
    mocks.call.mockImplementationOnce(() => new Promise(value => { resolve = value }))
    await act(async () => { renderer = create(<Probe />) })
    expect(renderer!.root.findByType('textarea').props.disabled).toBe(false)
    await act(async () => { resolve(denied) })
    expect(latest.blocked).toBe(true)
    expect(renderer!.root.findByType('textarea').props.defaultValue).toBe('保留草稿')
    mocks.call.mockResolvedValue({ ...allowed, ownRevision: 2 })
    await act(async () => { await latest.toggle() })
    expect(latest.blocked).toBe(false)
    expect(mocks.call.mock.calls.every(call => String(call[0]).startsWith('chat.direct-message'))).toBe(true)
    expect(mocks.call.mock.calls.filter(call => call[0] === 'chat.direct-message-refusal.set')).toHaveLength(1)
  })
  it('keeps normal messages available when the initial query fails', async () => {
    mocks.call.mockRejectedValue(new Error('offline'))
    await act(async () => { renderer = create(<Probe />) })
    expect(latest.blocked).toBe(false)
    expect(latest.message).toBe('')
  })
  it('retains a known refusal when a refresh fails', async () => {
    mocks.call.mockResolvedValue(denied)
    await act(async () => { renderer = create(<Probe />) })
    mocks.call.mockRejectedValue(new Error('offline'))
    await act(async () => { invalidateDirectMessageAdmission() })
    expect(latest.admission).toEqual(denied)
    expect(latest.blocked).toBe(true)
    expect(latest.message).not.toContain('offline')
  })
  it('isolates old-account responses and refreshes shared projections on invalidation', async () => {
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
