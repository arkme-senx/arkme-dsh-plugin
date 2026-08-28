import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  decryptXChaCha20Poly1305,
  encryptXChaCha20Poly1305,
  hChaCha20,
} from '../src/dsh-remote/crypto.js'

describe('local command-ledger cryptography', () => {
  it('canonicalizes nested objects without changing array order', () => {
    expect(canonicalJson({ z: 1, a: [{ y: 2, x: 1 }] })).toBe('{"a":[{"x":1,"y":2}],"z":1}')
  })

  it('round-trips XChaCha20-Poly1305 with authenticated ledger identity', () => {
    const key = randomBytes(32)
    const encrypted = encryptXChaCha20Poly1305(key, 'pending command', 'account=42;runtime=runtime-01')
    expect(decryptXChaCha20Poly1305(key, encrypted, 'account=42;runtime=runtime-01').toString())
      .toBe('pending command')
    expect(() => decryptXChaCha20Poly1305(key, encrypted, 'account=43;runtime=runtime-01'))
      .toThrow(/认证失败/)
  })

  it('rejects invalid HChaCha20 key and nonce lengths', () => {
    expect(() => hChaCha20(Buffer.alloc(31), Buffer.alloc(16))).toThrow(/32-byte key/)
    expect(() => hChaCha20(Buffer.alloc(32), Buffer.alloc(15))).toThrow(/16-byte nonce/)
  })
})
