import { describe, expect, it, vi } from 'vitest'
import { retryArkmeRead } from '../src/client/read-retry.js'
import { createContactDirectoryState, contactDirectoryReducer } from '../src/client/redesign/contacts/contact-directory-state.js'

describe('directory failure recovery boundary', () => {
  it('does not multiply exhausted Host attempts in the browser', async () => {
    const failure = Object.assign(new Error('繁忙'), { body: { retryable: true, recovery: { owner: 'host', attempts: 3, exhausted: true } } })
    const read = vi.fn().mockRejectedValue(failure)
    await expect(retryArkmeRead(read)).rejects.toBe(failure)
    expect(read).toHaveBeenCalledOnce()
  })
  it.each(['groups', 'bots', 'unmarked-speakers', 'teams', 'contacts'] as const)('keeps existing %s rows after a refresh failure', section => {
    let state = createContactDirectoryState('account')
    const row = { kind: 'group' as const, sourceRef: 'opaque', displayName: 'Existing' }
    state.sections[section] = { ...state.sections[section], status: 'ready', items: [row], total: 1 }
    state = contactDirectoryReducer(state, { type: 'load-start', section, accountKey: 'account', generation: 1, mode: 'replace' })
    state = contactDirectoryReducer(state, { type: 'load-error', section, accountKey: 'account', generation: 1, message: '暂时繁忙' })
    expect(state.sections[section]).toMatchObject({ status: 'error', items: [row], total: 1, warning: '暂时繁忙' })
  })
})
