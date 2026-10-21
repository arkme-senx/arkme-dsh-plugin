import { describe, expect, it, vi } from 'vitest'
import { DesktopImportJournal, importFilePlaceholder, resolveImportFile, ImportFileAccessError, type ImportQueueRecord } from '../src/client/recordings/recording-import-journal.js'

function record(file: File): ImportQueueRecord {
  return { id: 'test', accountKey: 'prod:42', fileName: file.name, fileSize: file.size, lastModified: file.lastModified,
    mimeType: file.type, source: { kind: 'file', file }, selected: true, startAt: '2026-10-14T12:00:00', ownership: 'self', error: '' }
}
describe('durable import source recovery', () => {
  it('returns the saved bytes rather than the metadata placeholder', async () => {
    const file = new File(['original bytes'], 'one.wav', { lastModified: 123 })
    const row = record(file)
    expect(importFilePlaceholder(row).size).toBe(file.size)
    expect(await (await resolveImportFile(row)).text()).toBe('original bytes')
  })
  it('requests permission synchronously in the recovery click, never on automatic restore', async () => {
    const file = new File(['bytes'], 'one.wav', { lastModified: 123 })
    const row = record(file)
    const queryPermission = vi.fn(async () => 'prompt' as const)
    const requestPermission = vi.fn(async () => 'granted' as const)
    row.source = { kind: 'handle', handle: { kind: 'file', name: file.name, queryPermission, requestPermission, getFile: async () => file } }
    await expect(resolveImportFile(row)).rejects.toBeInstanceOf(ImportFileAccessError)
    expect(requestPermission).not.toHaveBeenCalled()
    const restoring = resolveImportFile(row, true)
    expect(requestPermission).toHaveBeenCalledOnce()
    expect(await restoring).toBe(file)
  })
  it('can persist a handle before iCloud has returned file metadata', async () => {
    const file = new File(['later ready'], 'cloud.wav', { lastModified: 123 })
    const row = { ...record(file), fileSize: 0, lastModified: 0 }
    row.source = { kind: 'handle', handle: { kind: 'file', name: file.name, queryPermission: async () => 'granted', requestPermission: async () => 'granted', getFile: async () => file } }
    expect(await resolveImportFile(row)).toBe(file)
  })
  it.each(['name', 'size', 'lastModified'])('pauses a changed %s instead of sending replacement content', async field => {
    const file = new File(['bytes'], 'one.wav', { lastModified: 123 })
    const replacement = new File([field === 'size' ? 'other bytes' : 'bytes'], field === 'name' ? 'two.wav' : 'one.wav', { lastModified: field === 'lastModified' ? 124 : 123 })
    const row = record(file)
    row.source = { kind: 'handle', handle: { kind: 'file', name: file.name, queryPermission: async () => 'granted', requestPermission: async () => 'granted', getFile: async () => replacement } }
    await expect(resolveImportFile(row)).rejects.toThrow('已改变')
  })
})

describe('native import upgrade preserves browser candidates', () => {
  const original = () => record(new File(['bytes'], 'old.wav', { lastModified: 123 }))
  it('restores both stores and prefers a persisted native conversion without duplicate rows', async () => {
    const old = original()
    const converted = { ...old, source: { kind: 'desktop' as const, token: 'grant' } }
    const other = { ...old, id: 'other' }
    const browser = { list: vi.fn(async () => [old, other]), change: vi.fn(async () => {}) }
    const native = { list: vi.fn(async () => [converted]), change: vi.fn(async () => {}) }
    const journal = new DesktopImportJournal('prod:42', native, browser)
    expect(await journal.list('prod:42')).toEqual([converted, other])
    await expect(journal.list('prod:43')).rejects.toThrow('账号不匹配')
  })
  it('retains the legacy copy if saving its native replacement fails', async () => {
    const browser = { list: vi.fn(async () => [original()]), change: vi.fn(async () => {}) }
    const native = { list: vi.fn(async () => []), change: vi.fn(async () => { throw new Error('disk full') }) }
    const journal = new DesktopImportJournal('prod:42', native, browser)
    await expect(journal.change([{ ...original(), source: { kind: 'desktop', token: 'grant' } }], []))
      .rejects.toThrow('disk full')
    expect(browser.change).not.toHaveBeenCalled()
  })
  it('routes mixed sources to their own stores and removes deleted candidates from both', async () => {
    const old = original()
    const added = { ...old, id: 'new', source: { kind: 'desktop' as const, token: 'grant' } }
    const browser = { list: vi.fn(async () => [old]), change: vi.fn(async () => {}) }
    const native = { list: vi.fn(async () => []), change: vi.fn(async () => {}) }
    const journal = new DesktopImportJournal('prod:42', native, browser)
    await journal.change([old, added], ['deleted'])
    expect(native.change).toHaveBeenNthCalledWith(1, 'prod:42', [added], ['deleted'])
    expect(browser.change).toHaveBeenCalledWith([old], ['deleted', 'new'])
    expect(native.change).toHaveBeenNthCalledWith(2, 'prod:42', [], ['test'])
    await expect(journal.change([{ ...old, accountKey: 'prod:43' }], [])).rejects.toThrow('账号不匹配')
  })
})
