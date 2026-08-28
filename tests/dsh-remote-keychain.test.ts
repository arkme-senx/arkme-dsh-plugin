import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeMacOSSecureValueStore } from '../src/keychain-store.js'

const source = readFileSync(join(process.cwd(), 'src', 'keychain-store.ts'), 'utf8')

describe('remote Desktop Credential macOS storage', () => {
  it('passes the secret separately from security argv', async () => {
    const secret = '{"privateKey":"must-not-be-in-argv"}'
    const writer = vi.fn(async (_args: readonly string[], _payload: string) => undefined)
    const store = new ArkmeMacOSSecureValueStore('dev.jotmo.remote', writer, 'darwin')

    await store.write('account-1', secret)

    expect(writer).toHaveBeenCalledOnce()
    const [args, payload] = writer.mock.calls[0] ?? []
    expect(args).toEqual([
      'add-generic-password', '-a', 'account-1', '-s', 'dev.jotmo.remote', '-U', '-w',
    ])
    expect(args).not.toContain(secret)
    expect(args?.at(-1)).toBe('-w')
    expect(payload).toBe(secret)
  })

  it('writes complete macOS credentials through Security Framework stdin', () => {
    expect(source).toContain("spawn('/usr/bin/osascript'")
    expect(source).toContain('readDataToEndOfFile')
    expect(source).toContain('SecItemUpdate')
    expect(source).toContain('SecItemAdd')
    expect(source).toContain('SecItemCopyMatching')
    expect(source).toContain('SecItemDelete')
    expect(source).not.toContain("spawn('/usr/bin/expect'")
    expect(source).not.toContain("spawn('/usr/bin/security', [...args]")
  })

  it('uses the same native Security Framework bridge to read and delete', async () => {
    const reader = vi.fn(async () => '{"privateKey":"value"}')
    const deleter = vi.fn(async () => undefined)
    const store = new ArkmeMacOSSecureValueStore(
      'dev.jotmo.remote',
      vi.fn(async () => undefined),
      'darwin',
      reader,
      deleter,
    )

    await expect(store.read('account-1')).resolves.toBe('{"privateKey":"value"}')
    await store.delete('account-1')

    expect(reader).toHaveBeenCalledWith('account-1', 'dev.jotmo.remote')
    expect(deleter).toHaveBeenCalledWith('account-1', 'dev.jotmo.remote')
  })
})
