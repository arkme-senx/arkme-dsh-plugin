// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UnifiedForwardDialog } from '../src/client/UnifiedForwardDialog.js'
import { SourceForwardAttempt } from '../src/client/source-forward-attempt.js'
import { TeamForwardDialog } from '../src/client/TeamForwardDialog.js'
import { TeamForwardAttempt } from '../src/client/team-forward-attempt.js'
import type { ArkmeSourceItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ call: vi.fn(), phone: vi.fn(), refresh: vi.fn() }))
const sources: ArkmeSourceItem[] = ['first', 'second'].map(key => ({
  kind: 'private_chat', sourceKey: key, sourceRef: `ref-${key}`, displayName: key,
  directMessageAdmissionApplicable: true,
}))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/social-action-guard.js', () => ({ requirePhoneForSocialAction: mocks.phone }))
vi.mock('../src/client/auth-store.js', () => ({ arkmeAuthStore: {
  getSnapshot: () => ({ auth: { status: 'authenticated', environment: 'test', userId: 11 } }), subscribe: () => () => {},
} }))
vi.mock('../src/client/unified-forward-directory.js', () => ({ useUnifiedForwardDirectory: () => ({
  rows: sources.map(source => ({ kind: 'target', target: { kind: 'source', source }, pinned: false, activeAtMillis: 1 })),
  preferences: {}, loading: false, hasMore: false, error: '', refresh: mocks.refresh,
}) }))
vi.mock('../src/client/ArkmeAvatar.js', () => ({ ArkmeDirectorySourceAvatar: () => null, ArkmeUserAvatar: () => null }))
vi.mock('../src/client/ArkmeTeamAvatar.js', () => ({ ArkmeTeamChannelAvatar: () => null }))
vi.mock('../src/client/team-avatar-image-runtime.js', () => ({ teamAvatarImages: {} }))

let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.call.mockReset().mockRejectedValue(new Error('Unexpected read'))
  mocks.phone.mockReset().mockResolvedValue(undefined)
  mocks.refresh.mockReset().mockResolvedValue(undefined)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const row = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(button => button.textContent?.includes(name))!
const submit = () => document.querySelector<HTMLButtonElement>('button[aria-label="发送转发"]')!
const click = async (button: HTMLButtonElement) => { await act(async () => button.click()) }
const mountSource = async (sender: ConstructorParameters<typeof SourceForwardAttempt>[3], complete = vi.fn()) => {
  const attempt = new SourceForwardAttempt('source', ['action'], 11, sender)
  await act(async () => root.render(<UnifiedForwardDialog accountKey="test:11" attempt={attempt}
    preflightSelection={false} previewTitle="消息" previewSubtitle="" onClose={() => {}} onComplete={complete}/>))
  return attempt
}

it('selects an ordinary recipient immediately and waits for the phone guard only when sending', async () => {
  let release!: () => void
  mocks.phone.mockImplementation(() => new Promise<void>(resolve => { release = resolve }))
  const sender = vi.fn().mockResolvedValue({ itemUid: 'sent', localState: 'synced' }), complete = vi.fn()
  await mountSource(sender, complete)
  await click(row('first'))
  expect(row('first').getAttribute('aria-pressed')).toBe('true')
  expect(mocks.phone).not.toHaveBeenCalled()
  await click(submit())
  expect(mocks.phone).toHaveBeenCalledOnce()
  expect(sender).not.toHaveBeenCalled()
  await act(async () => release())
  expect(sender).toHaveBeenCalledOnce()
  expect(complete).toHaveBeenCalledOnce()
  expect(mocks.call).not.toHaveBeenCalled()
})

it('keeps a selected ordinary recipient and reports a failed phone guard without sending', async () => {
  mocks.phone.mockRejectedValue(new Error('绑定手机号后即可发送消息'))
  const sender = vi.fn(), complete = vi.fn()
  await mountSource(sender, complete)
  await click(row('first'))
  expect(row('first').getAttribute('aria-pressed')).toBe('true')
  await click(submit())
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('绑定手机号')
  expect(sender).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled()
  expect(mocks.call).not.toHaveBeenCalled()
})

it('preserves confirmed receipts and retries only the refused ordinary target with its original command', async () => {
  const sender = vi.fn().mockResolvedValueOnce({ itemUid: 'first', localState: 'synced' })
    .mockRejectedValueOnce(new Error('对方已拒收你的消息')).mockResolvedValue({ itemUid: 'second', localState: 'synced' })
  const complete = vi.fn()
  await mountSource(sender, complete)
  await click(row('first')); await click(row('second')); await click(submit())
  expect(sender).toHaveBeenCalledTimes(2)
  expect(complete).not.toHaveBeenCalled()
  expect(document.querySelectorAll('[aria-pressed="true"]')).toHaveLength(2)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('拒收')
  const rejectedCommand = sender.mock.calls[1]![0]
  await click(submit())
  expect(sender).toHaveBeenCalledTimes(3)
  expect(sender.mock.calls[2]![0]).toEqual(rejectedCommand)
  expect(complete).toHaveBeenCalledOnce()
  expect(mocks.phone).toHaveBeenCalledTimes(2)
  expect(mocks.call).not.toHaveBeenCalled()
})

it('preserves the Team selection preflight by default', async () => {
  let release!: () => void
  mocks.phone.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  const sender = vi.fn().mockResolvedValue({ itemUid: 'sent', localState: 'synced' })
  await act(async () => root.render(<TeamForwardDialog accountKey="test:11"
    attempt={new TeamForwardAttempt('team', [{ messageRef: 'message', version: 1 }], sender)}
    previewTitle="消息" previewSubtitle="" onClose={() => {}} onComplete={() => {}}/>))
  await click(row('first'))
  expect(mocks.phone).toHaveBeenCalledOnce()
  expect(row('first').getAttribute('aria-pressed')).toBe('false')
  await act(async () => release())
  expect(row('first').getAttribute('aria-pressed')).toBe('true')
  await click(submit())
  expect(mocks.phone).toHaveBeenCalledTimes(2)
  expect(sender).toHaveBeenCalledOnce()
  expect(mocks.call).not.toHaveBeenCalled()
})
