import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { DshRemoteError } from './errors.js'

export function encodeBase64Url(value: Uint8Array | string): string {
  return Buffer.from(value).toString('base64url')
}

export function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '无效的 base64url 数据')
  return Buffer.from(value, 'base64url')
}

function normalizedCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedCanonical)
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key]
      if (child !== undefined) sorted[key] = normalizedCanonical(child)
    }
    return sorted
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new DshRemoteError('REMOTE_REQUEST_INVALID', '协议数据不能包含非有限数字')
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizedCanonical(value))
}

function rotateLeft(value: number, count: number): number {
  return ((value << count) | (value >>> (32 - count))) >>> 0
}

function quarterRound(state: Uint32Array, a: number, b: number, c: number, d: number): void {
  state[a] = (state[a]! + state[b]!) >>> 0
  state[d] = rotateLeft(state[d]! ^ state[a]!, 16)
  state[c] = (state[c]! + state[d]!) >>> 0
  state[b] = rotateLeft(state[b]! ^ state[c]!, 12)
  state[a] = (state[a]! + state[b]!) >>> 0
  state[d] = rotateLeft(state[d]! ^ state[a]!, 8)
  state[c] = (state[c]! + state[d]!) >>> 0
  state[b] = rotateLeft(state[b]! ^ state[c]!, 7)
}

export function hChaCha20(key: Uint8Array, nonce: Uint8Array): Buffer {
  if (key.length !== 32 || nonce.length !== 16) throw new TypeError('HChaCha20 requires a 32-byte key and 16-byte nonce')
  const state = new Uint32Array(16)
  const constants = Buffer.from('expand 32-byte k', 'ascii')
  for (let index = 0; index < 4; index += 1) state[index] = constants.readUInt32LE(index * 4)
  const keyBuffer = Buffer.from(key)
  const nonceBuffer = Buffer.from(nonce)
  for (let index = 0; index < 8; index += 1) state[index + 4] = keyBuffer.readUInt32LE(index * 4)
  for (let index = 0; index < 4; index += 1) state[index + 12] = nonceBuffer.readUInt32LE(index * 4)
  for (let round = 0; round < 10; round += 1) {
    quarterRound(state, 0, 4, 8, 12)
    quarterRound(state, 1, 5, 9, 13)
    quarterRound(state, 2, 6, 10, 14)
    quarterRound(state, 3, 7, 11, 15)
    quarterRound(state, 0, 5, 10, 15)
    quarterRound(state, 1, 6, 11, 12)
    quarterRound(state, 2, 7, 8, 13)
    quarterRound(state, 3, 4, 9, 14)
  }
  const result = Buffer.allocUnsafe(32)
  for (const [outputIndex, stateIndex] of [0, 1, 2, 3, 12, 13, 14, 15].entries()) {
    result.writeUInt32LE(state[stateIndex]!, outputIndex * 4)
  }
  return result
}

export interface XChaChaCiphertext {
  nonce: string
  ciphertext: string
}

export function encryptXChaCha20Poly1305(
  key: Uint8Array,
  plaintext: Uint8Array | string,
  aad: Uint8Array | string,
  nonce: Uint8Array = randomBytes(24),
): XChaChaCiphertext {
  if (key.length !== 32 || nonce.length !== 24) throw new TypeError('XChaCha20-Poly1305 requires a 32-byte key and 24-byte nonce')
  const subkey = hChaCha20(key, nonce.subarray(0, 16))
  const chachaNonce = Buffer.concat([Buffer.alloc(4), Buffer.from(nonce.subarray(16))])
  const cipher = createCipheriv('chacha20-poly1305', subkey, chachaNonce, { authTagLength: 16 })
  const encodedPlaintext = Buffer.from(plaintext)
  cipher.setAAD(Buffer.from(aad), { plaintextLength: encodedPlaintext.length })
  const encrypted = Buffer.concat([cipher.update(encodedPlaintext), cipher.final(), cipher.getAuthTag()])
  return { nonce: encodeBase64Url(nonce), ciphertext: encodeBase64Url(encrypted) }
}

export function decryptXChaCha20Poly1305(
  key: Uint8Array,
  input: XChaChaCiphertext,
  aad: Uint8Array | string,
): Buffer {
  const nonce = decodeBase64Url(input.nonce)
  const encoded = decodeBase64Url(input.ciphertext)
  if (key.length !== 32 || nonce.length !== 24 || encoded.length < 16) {
    throw new DshRemoteError('REMOTE_REQUEST_INVALID', '远控密文格式无效')
  }
  try {
    const subkey = hChaCha20(key, nonce.subarray(0, 16))
    const chachaNonce = Buffer.concat([Buffer.alloc(4), nonce.subarray(16)])
    const decipher = createDecipheriv('chacha20-poly1305', subkey, chachaNonce, { authTagLength: 16 })
    decipher.setAAD(Buffer.from(aad), { plaintextLength: encoded.length - 16 })
    decipher.setAuthTag(encoded.subarray(encoded.length - 16))
    return Buffer.concat([decipher.update(encoded.subarray(0, encoded.length - 16)), decipher.final()])
  } catch (error) {
    throw new DshRemoteError('REMOTE_STORAGE_FAILED', '命令账本密文认证失败', false, {}, { cause: error })
  }
}
