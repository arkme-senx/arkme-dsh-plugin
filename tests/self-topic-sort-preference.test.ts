import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SELF_TOPIC_SORT, readSelfTopicSortPreference, writeSelfTopicSortPreference,
} from '../src/client/self-topic-sort-preference.js'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('send-to-self topic sort preference', () => {
  it('defaults new users to the mobile-compatible custom order', () => {
    expect(DEFAULT_SELF_TOPIC_SORT).toBe('custom')
    expect(readSelfTopicSortPreference(10000, new MemoryStorage())).toBe('custom')
  })

  it('restores the last choice independently for each signed-in user', () => {
    const storage = new MemoryStorage()

    writeSelfTopicSortPreference(10001, 'custom', storage)
    writeSelfTopicSortPreference(10002, 'most', storage)

    expect(readSelfTopicSortPreference(10001, storage)).toBe('custom')
    expect(readSelfTopicSortPreference(10002, storage)).toBe('most')
    expect(readSelfTopicSortPreference(10003, storage)).toBe(DEFAULT_SELF_TOPIC_SORT)
  })

  it('falls back safely for anonymous, malformed, or unavailable storage', () => {
    const storage = new MemoryStorage()
    storage.setItem('dsh-arkme:self-topic-sort:v1:user:10001', 'invalid')
    const unavailable = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    } as unknown as Storage

    writeSelfTopicSortPreference(undefined, 'custom', storage)
    expect(readSelfTopicSortPreference(undefined, storage)).toBe(DEFAULT_SELF_TOPIC_SORT)
    expect(readSelfTopicSortPreference(10001, storage)).toBe(DEFAULT_SELF_TOPIC_SORT)
    expect(readSelfTopicSortPreference(10001, unavailable)).toBe(DEFAULT_SELF_TOPIC_SORT)
    expect(() => { writeSelfTopicSortPreference(10001, 'custom', unavailable) }).not.toThrow()
  })
})
