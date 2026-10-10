// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { adoptFlatSessionDefault, SESSION_LIST_DEFAULT_MARKER } from '../src/client/harness-session-list-default.js'

afterEach(() => localStorage.clear())

it('adopts flat once and leaves native ordering and future fields intact; later user choices survive remount', () => {
  const native = { groupBy: 'workspace', orderBy: 'manual', futurePreference: { enabled: true } }
  const setGroupBy = vi.fn((mode: 'flat') => { native.groupBy = mode })
  expect(adoptFlatSessionDefault(native.groupBy, setGroupBy, localStorage)).toBe(true)
  expect(native).toEqual({ groupBy: 'flat', orderBy: 'manual', futurePreference: { enabled: true } })
  expect(localStorage.getItem(SESSION_LIST_DEFAULT_MARKER)).toBe('1')
  native.groupBy = 'workspace' // User changes the native view option.
  adoptFlatSessionDefault(native.groupBy, setGroupBy, localStorage)
  expect(native.groupBy).toBe('workspace')
  expect(setGroupBy).toHaveBeenCalledOnce()
})

it('respects an already-flat view without writing it again', () => {
  const action = vi.fn()
  expect(adoptFlatSessionDefault('flat', action, localStorage)).toBe(true)
  expect(action).not.toHaveBeenCalled()
  expect(localStorage.getItem(SESSION_LIST_DEFAULT_MARKER)).toBe('1')
})

it('does not overwrite an unknown upstream grouping mode or mark it initialized', () => {
  const action = vi.fn()
  expect(adoptFlatSessionDefault('future-mode', action, localStorage)).toBe(false)
  expect(action).not.toHaveBeenCalled()
  expect(localStorage.getItem(SESSION_LIST_DEFAULT_MARKER)).toBeNull()
})

it('can initialize the mounted page when browser storage is blocked', () => {
  const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  const action = vi.fn()
  expect(adoptFlatSessionDefault('workspace', action, blocked)).toBe(true)
  expect(action).toHaveBeenCalledWith('flat')
})
