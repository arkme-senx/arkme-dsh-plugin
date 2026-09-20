import { afterEach, expect, it, vi } from 'vitest'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { bindLongArticleWindowAccount, openLongArticleWindow } from '../src/client/long-article-window.js'
const source = { sourceKey: 'chat:A', sourceRef: 'signed-A', displayName: 'A' }
afterEach(() => vi.unstubAllGlobals())
it('preserves the browser fallback when the native bridge is unavailable', async () => {
  vi.stubGlobal('arkmeLongArticle', undefined)
  expect(await openLongArticleWindow(source)).toBe(false)
})
it('passes the original account and source to the native window', async () => {
  arkmeAuthStore.setAuth({ status: 'authenticated', userId: 7, environment: 'prod' })
  const open = vi.fn(async () => true), account = vi.fn(async () => true)
  vi.stubGlobal('arkmeLongArticle', { version: 1, open, account })
  expect(await openLongArticleWindow(source)).toBe(true)
  expect(open).toHaveBeenCalledWith({ ...source, accountKey: 'prod:7' })
})
it('does not open after the account changes while opening', async () => {
  arkmeAuthStore.setAuth({ status: 'authenticated', userId: 7, environment: 'prod' })
  const open = vi.fn()
  vi.stubGlobal('arkmeLongArticle', { version: 1, open, account: async () => {
    arkmeAuthStore.setAuth({ status: 'authenticated', userId: 8, environment: 'prod' }); return true
  } })
  await expect(openLongArticleWindow(source)).rejects.toThrow('账号已切换')
  expect(open).not.toHaveBeenCalled()
})
it('notifies native windows on logout and unsubscribes cleanly', () => {
  arkmeAuthStore.setAuth({ status: 'authenticated', userId: 7, environment: 'prod' })
  const account = vi.fn(async () => true)
  vi.stubGlobal('arkmeLongArticle', { version: 1, account })
  const stop = bindLongArticleWindowAccount()
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'prod' })
  expect(account).toHaveBeenLastCalledWith(null)
  stop(); const count = account.mock.calls.length
  arkmeAuthStore.setAuth({ status: 'authenticated', userId: 9, environment: 'prod' })
  expect(account).toHaveBeenCalledTimes(count)
})

it('falls back for existing articles on a create-only bridge', async () => {
 const open = vi.fn(); vi.stubGlobal('arkmeLongArticle', { version: 1, open })
 const item = { itemUid: 'a', title: 'a', textContent: '', isMe: true, senderName: '我', status: 1, sendAtMillis: 1 }
 expect(await openLongArticleWindow(source, { mode: 'existing', item })).toBe(false)
 expect(open).not.toHaveBeenCalled()
})
