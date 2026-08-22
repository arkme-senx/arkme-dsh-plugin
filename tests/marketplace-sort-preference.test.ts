import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MARKETPLACE_SORT, readMarketplaceSortPreference, writeMarketplaceSortPreference,
} from '../src/client/marketplace-sort-preference.js'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('marketplace sort preference', () => {
  it('defaults to the highest rating when no preference exists', () => {
    expect(DEFAULT_MARKETPLACE_SORT).toBe('rating')
    expect(readMarketplaceSortPreference(10001, new MemoryStorage())).toBe('rating')
  })

  it('restores the last choice independently for each user', () => {
    const storage = new MemoryStorage()

    writeMarketplaceSortPreference(10001, 'comments', storage)
    writeMarketplaceSortPreference(10002, 'opens', storage)

    expect(readMarketplaceSortPreference(10001, storage)).toBe('comments')
    expect(readMarketplaceSortPreference(10002, storage)).toBe('opens')
    expect(readMarketplaceSortPreference(10003, storage)).toBe('rating')
  })

  it('keeps anonymous preferences separate from authenticated users', () => {
    const storage = new MemoryStorage()

    writeMarketplaceSortPreference(undefined, 'created_at', storage)

    expect(readMarketplaceSortPreference(undefined, storage)).toBe('created_at')
    expect(readMarketplaceSortPreference(10001, storage)).toBe('rating')
  })

  it('falls back to rating for malformed or unavailable storage', () => {
    const storage = new MemoryStorage()
    storage.setItem('dsh-arkme:marketplace-sort:v1:user:10001', 'invalid')
    const unavailable = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    } as unknown as Storage

    expect(readMarketplaceSortPreference(10001, storage)).toBe('rating')
    expect(readMarketplaceSortPreference(10001, unavailable)).toBe('rating')
    expect(() => { writeMarketplaceSortPreference(10001, 'comments', unavailable) }).not.toThrow()
  })
})
