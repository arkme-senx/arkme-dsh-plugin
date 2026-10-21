import { expect, it, vi } from 'vitest'
import { NotificationDirectoryPreferences } from '../src/client/notification-directory-preferences.js'

it('persists pins across restarts, isolates both user and environment, and supports unpinning', () => {
  const data = new Map<string, string>()
  const storage = () => ({ getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } })
  const first = new NotificationDirectoryPreferences(storage), listener = vi.fn()
  const stop = first.subscribe(listener)
  first.pin('prod:1', true)
  expect(listener).toHaveBeenCalledOnce()
  const restarted = new NotificationDirectoryPreferences(storage)
  expect(restarted.read('prod:1')).toBe(true)
  expect(restarted.read('test:1')).toBe(false)
  expect(restarted.read('prod:2')).toBe(false)
  restarted.pin('prod:1', false)
  expect(first.read('prod:1')).toBe(false)
  stop(); first.invalidate(); expect(listener).toHaveBeenCalledOnce()
})

it('does not claim a successful pin when storage is unavailable or full', () => {
  const store = new NotificationDirectoryPreferences(() => ({ getItem: () => null, setItem: () => { throw Error('quota') } }))
  const listener = vi.fn(); store.subscribe(listener)
  expect(() => store.pin('prod:1', true)).toThrow('保存失败')
  expect(store.read('prod:1')).toBe(false)
  expect(listener).not.toHaveBeenCalled()
  expect(() => store.pin('', true)).toThrow('请先登录')
})
