import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DshRemoteCommandLedger } from '../src/dsh-remote/command-ledger.js'
import { securePrivateFileSync } from '../src/private-filesystem.js'

vi.mock('../src/private-filesystem.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/private-filesystem.js')>()
  return { ...actual, securePrivateFileSync: vi.fn(actual.securePrivateFileSync) }
})

const directories: string[] = []
const ledgers: DshRemoteCommandLedger[] = []
const identity = {
  accountId: 'account-1', runtimeRef: 'runtime-1', requestRef: 'request-1',
  operation: 'session.prompt' as const, arguments: { text: 'preserve this command' },
  executeBeforeMillis: 20_000,
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'arkme-ledger-close-'))
  directories.push(directory)
  const key = Buffer.alloc(32, 7)
  const ledger = new DshRemoteCommandLedger(directory, key, { now: () => 1_000 })
  ledgers.push(ledger)
  return { directory, key, ledger, path: join(directory, 'remote-command-ledger.sqlite3') }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(securePrivateFileSync).mockReset()
  for (const ledger of ledgers.splice(0)) { try { ledger.close() } catch {} }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('remote ledger close preserves durable commands', () => {
  it('tolerates Windows missing sidecars after SQLite closes and preserves deduplication on reopen', () => {
    const { directory, key, ledger } = fixture()
    ledger.begin(identity)
    ledger.complete(identity, { accepted: true })
    vi.mocked(securePrivateFileSync).mockImplementation(path => {
      if (!existsSync(path)) throw Object.assign(new Error('icacls: file not found'), { status: 2 })
    })
    expect(() => ledger.close()).not.toThrow()
    const reopened = new DshRemoteCommandLedger(directory, key)
    ledgers.push(reopened)
    expect(reopened.begin(identity)).toMatchObject({
      duplicate: true, entry: { state: 'completed', payload: { result: { accepted: true } } },
    })
    expect(key).toEqual(Buffer.alloc(32, 7))
  })

  it('allows repeated close without operating on a closed SQLite connection', () => {
    const { ledger } = fixture()
    ledger.close()
    expect(() => ledger.close()).not.toThrow()
  })

  it('erases only the private key copy even when permissions fail after close', () => {
    const { ledger, key, path } = fixture()
    const privateKey = (ledger as unknown as { key: Buffer }).key
    const denied = Object.assign(new Error('access denied'), { status: 5 })
    vi.mocked(securePrivateFileSync).mockImplementation(file => { if (file === path) throw denied })
    expect(() => ledger.close()).toThrow(denied)
    expect(privateKey).toEqual(Buffer.alloc(32))
    expect(key).toEqual(Buffer.alloc(32, 7))
  })

  it('keeps an actually open database and its key usable when SQLite close fails', () => {
    const { ledger } = fixture()
    ledger.begin(identity)
    const failure = new Error('SQLite close failed')
    vi.spyOn(DatabaseSync.prototype, 'close').mockImplementationOnce(() => { throw failure })
    expect(() => ledger.close()).toThrow(failure)
    expect(ledger.get(identity)?.payload).toEqual({ arguments: identity.arguments })
    expect(() => ledger.close()).not.toThrow()
  })

  it('does not ignore a missing main database', () => {
    const { ledger, path } = fixture()
    const missing = Object.assign(new Error('main database missing'), { code: 'ENOENT' })
    vi.mocked(securePrivateFileSync).mockImplementation(file => { if (file === path) throw missing })
    expect(() => ledger.close()).toThrow(missing)
  })

  it('tolerates a sidecar disappearing during the permission operation', () => {
    const { ledger, path } = fixture()
    ledger.close()
    // Simulate the race on a disposable sidecar after the real connection is closed.
    writeFileSync(`${path}-wal`, '')
    vi.mocked(securePrivateFileSync).mockImplementation(file => {
      if (file.endsWith('-wal')) {
        rmSync(file)
        throw Object.assign(new Error('icacls: file disappeared'), { status: 2 })
      }
    })
    expect(() => (ledger as unknown as { secureFiles(): void }).secureFiles()).not.toThrow()
  })

  it('does not swallow permission errors on an existing sidecar', () => {
    const { ledger, path } = fixture()
    ledger.close()
    writeFileSync(`${path}-shm`, '')
    const denied = Object.assign(new Error('icacls: access denied'), { status: 5 })
    vi.mocked(securePrivateFileSync).mockImplementation(file => { if (file.endsWith('-shm')) throw denied })
    expect(() => (ledger as unknown as { secureFiles(): void }).secureFiles()).toThrow(denied)
  })
})
