import { expect, it, vi } from 'vitest'
import { createMessageCopyLink } from '../src/services/message-copy-link-create.js'
import type { ServiceRuntime } from '../src/services/service.js'

it.each([
  { audio: false, delegated: false },
  { audio: true, delegated: false },
  { audio: false, delegated: true },
  { audio: true, delegated: true },
])('keeps source authority independent of audio processing time: %j', async ({ audio, delegated }) => {
  const post = vi.fn(async () => ({ sid: 'share', url: 'https://example.invalid/share' }))
  const runtime = { authenticatedChatPost: post } as unknown as ServiceRuntime
  const session = { userId: 42, accessToken: 'fixture', refreshToken: 'fixture' }
  const sources = [{ kind: 'fixture', include_audio: audio }]
  const signal = new AbortController().signal
  const access = delegated ? 'opaque-team-authority' : undefined
  await createMessageCopyLink(runtime, sources, session, signal, access)
  const options = { ...(delegated ? { chatAccessRef: access } : {}), ...(audio ? { requestTimeoutMs: 135_000 } : {}) }
  expect(post.mock.calls).toEqual([['/api/v1/chats/messages/copy-link/get-or-create', { sources }, session, signal, ...(audio || delegated ? [options] : [])]])
})

it('does not submit a cancelled copy-link command', async () => {
  const post = vi.fn()
  const runtime = { authenticatedChatPost: post } as unknown as ServiceRuntime
  const controller = new AbortController()
  controller.abort()
  await expect(createMessageCopyLink(runtime, [], { userId: 42, accessToken: 'fixture', refreshToken: 'fixture' }, controller.signal, 'opaque-team-authority')).rejects.toThrow()
  expect(post).not.toHaveBeenCalled()
})
