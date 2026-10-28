// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RelationViewCache } from '../src/client/explore/relation-view-cache.js'
const valid = (v: unknown): v is { text: string } => !!v && typeof v === 'object' && typeof (v as { text?: unknown }).text === 'string'
beforeEach(() => localStorage.clear())
describe('relationship read cache', () => {
  it('restores across reloads, separates accounts and expires from the read time', () => {
    let now = 1_800_000_000_000
    const first = new RelationViewCache(() => localStorage, () => now)
    first.write('prod:11', 'person:a', { text: 'saved' }, now)
    now += 60_000
    const reloaded = new RelationViewCache(() => localStorage, () => now)
    expect(reloaded.read('prod:11', 'person:a', valid)?.value.text).toBe('saved')
    expect(reloaded.read('test:11', 'person:a', valid)).toBeUndefined()
    expect(reloaded.read('prod:12', 'person:a', valid)).toBeUndefined()
    now += 6 * 60 * 60 * 1000
    expect(reloaded.read('prod:11', 'person:a', valid)).toBeUndefined()
    expect(localStorage.length).toBe(0)
  })
  it('bounds disk use, ignores malformed data, and clears both storage and memory on logout', () => {
    const cache = new RelationViewCache(() => localStorage, () => 1000)
    for (let n = 0; n < 40; n++) cache.write('prod:11', `person:${n}`, { text: 'a'.repeat(100_000) }, n + 1)
    expect(localStorage.length).toBeLessThanOrEqual(20)
    expect(Object.values(localStorage).reduce((n, raw) => n + String(raw).length, 0)).toBeLessThanOrEqual(2_000_000)
    expect(cache.read('prod:11', 'person:39', valid)?.value.text).toHaveLength(100_000)
    cache.clear()
    expect(localStorage.length).toBe(0)
    expect(cache.read('prod:11', 'person:39', valid)).toBeUndefined()
    localStorage.setItem('dsh-arkme:relation-view:v1:prod%3A11:broken', '{')
    expect(cache.read('prod:11', 'broken', valid)).toBeUndefined()
  })
  it('rejects late writes after logout rather than repopulating cleared data', () => {
    let allowed = true
    const cache = new RelationViewCache(() => localStorage, () => 1000, () => allowed)
    cache.write('prod:11', 'a', { text: 'old account' }, 999)
    allowed = false; cache.clear()
    cache.write('prod:11', 'a', { text: 'late response' }, 1000)
    expect(cache.read('prod:11', 'a', valid)).toBeUndefined()
    expect(localStorage.length).toBe(0)
  })
  it('retains memory results if browser persistence is unavailable', () => {
    const unavailable = vi.fn((): Storage => { throw new Error('storage denied') })
    const cache = new RelationViewCache(unavailable, () => 1000)
    cache.write('prod:11', 'a', { text: 'still readable' }, 999)
    expect(cache.read('prod:11', 'a', valid)?.value.text).toBe('still readable')
    expect(() => cache.clear()).not.toThrow()
  })
})
