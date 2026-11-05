// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

it.each(['localStorage', 'sessionStorage'] as const)('%s uses the browser Storage implementation', name => {
  const storage = window[name]
  expect(storage).toBeInstanceOf(window.Storage)
  expect(globalThis[name]).toBe(storage)
  expect(storage.length).toBe(0)
  storage.setItem('storage-environment', 'value')
  expect(storage.getItem('storage-environment')).toBe('value')
  expect(storage.key(0)).toBe('storage-environment')
  expect(storage.length).toBe(1)
  storage.removeItem('storage-environment')
  expect(storage.getItem('storage-environment')).toBeNull()
  storage.setItem('clear-me', 'value')
  storage.clear()
  expect(storage.length).toBe(0)
})

it('keeps local and session storage separate and clears prior test state', () => {
  expect(localStorage.length).toBe(0)
  expect(sessionStorage.length).toBe(0)
  localStorage.setItem('scope', 'local')
  sessionStorage.setItem('scope', 'session')
  expect(localStorage.getItem('scope')).toBe('local')
  expect(sessionStorage.getItem('scope')).toBe('session')
})
