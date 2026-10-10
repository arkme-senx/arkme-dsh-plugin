import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { HARNESS_SESSION_RESTORE_SCRIPT } from '../src/harness-session-restore-script.js'

it('isolates the iframe restore read from root writes while preserving every other storage operation', () => {
  const values = new Map<string, string>([['dsh.sessions.current', '{"sessionId":"A"}'], ['theme', 'dark']])
  class Storage {
    getItem(key: string) { return values.get(key) ?? null }
    setItem(key: string, value: string) { values.set(key, value) }
  }
  const localStorage = new Storage()
  const sessionStorage = new Storage()
  let restored: string | null = '{"sessionId":"A"}'
  const window = { localStorage, parent: { arkmeDesktop: { sessionSelection: { restore: () => restored } } } }
  runInNewContext(HARNESS_SESSION_RESTORE_SCRIPT, { window, Storage })
  // The root's initial pending projection clears the real shared origin key.
  values.set('dsh.sessions.current', '{}')
  expect(localStorage.getItem('dsh.sessions.current')).toBe('{"sessionId":"A"}')
  expect(sessionStorage.getItem('dsh.sessions.current')).toBe('{}')
  expect(localStorage.getItem('theme')).toBe('dark')
  localStorage.setItem('theme', 'light')
  expect(values.get('theme')).toBe('light')
  restored = '{"sessionId":"B"}'
  expect(localStorage.getItem('dsh.sessions.current')).toBe(restored)
  restored = null
  expect(localStorage.getItem('dsh.sessions.current')).toBeNull()
})

it('leaves browser-only storage untouched when no desktop restore bridge exists', () => {
  class Storage { getItem() { return 'browser-selection' } }
  const original = Storage.prototype.getItem
  runInNewContext(HARNESS_SESSION_RESTORE_SCRIPT, { window: { parent: {} }, Storage })
  expect(Storage.prototype.getItem).toBe(original)
})
