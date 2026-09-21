import { createHash } from 'node:crypto'
import { DSH_REMOTE_MAX_FRAGMENTED_PAYLOAD_BYTES } from './types.js'
import { DshRemoteError } from './errors.js'

const DIRECT_PLAINTEXT_BYTES = 32 * 1024
const FRAGMENT_CHUNK_BYTES = 32 * 1024
const MAX_FRAGMENT_COUNT = 2048

export interface DshRemoteOutboundPlaintext {
  value: unknown
  fragmentIndex?: number
  commandId?: string
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('base64url')
}

/**
 * Splits a large typed payload into independently bounded Realtime events.
 */
export function dshRemoteOutboundPayloads(
  envelope: unknown,
  transferSeed: string,
): DshRemoteOutboundPlaintext[] {
  // Older Realtime Redis relays re-encode empty arrays as objects. Keep their
  // JSON bytes opaque using the existing fragment protocol, even for small payloads.
  let hasEmptyArray = false
  const encoded = Buffer.from(JSON.stringify(envelope, (_key, value: unknown) => {
    if (Array.isArray(value) && value.length === 0) hasEmptyArray = true
    return value
  }))
  if (encoded.length <= DIRECT_PLAINTEXT_BYTES && !hasEmptyArray) return [{ value: envelope }]
  if (encoded.length > DSH_REMOTE_MAX_FRAGMENTED_PAYLOAD_BYTES) {
    throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '完整 DSH 事件超过 64MiB 安全上限', false, {
      logicalTooLarge: true,
      payloadBytes: encoded.length,
    })
  }
  // Existing receivers require at least two non-empty fragments.
  const chunkBytes = encoded.length <= DIRECT_PLAINTEXT_BYTES
    ? Math.ceil(encoded.length / 2) : FRAGMENT_CHUNK_BYTES
  const fragmentCount = Math.ceil(encoded.length / chunkBytes)
  if (fragmentCount > MAX_FRAGMENT_COUNT) {
    throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '完整 DSH 事件需要过多远控分片', false, {
      logicalTooLarge: true,
      fragmentCount,
    })
  }
  const digest = sha256(encoded)
  const transferRef = `fragment_${createHash('sha256').update(`${transferSeed}\n${digest}`).digest('base64url').slice(0, 40)}`
  return Array.from({ length: fragmentCount }, (_, fragmentIndex) => ({
    fragmentIndex,
    commandId: `fragment_${createHash('sha256').update(`${transferRef}\n${fragmentIndex}`).digest('base64url').slice(0, 40)}_${fragmentIndex}`,
    value: {
      protocol: 'dsh.remote-fragment',
      protocol_major: 1,
      kind: 'fragment',
      transfer_ref: transferRef,
      fragment_index: fragmentIndex,
      fragment_count: fragmentCount,
      payload_bytes: encoded.length,
      payload_sha256: digest,
      chunk: encoded.subarray(
        fragmentIndex * chunkBytes,
        Math.min(encoded.length, (fragmentIndex + 1) * chunkBytes),
      ).toString('base64url'),
    },
  }))
}

/** Reassemble one subscribed channel. Bounded by the existing 64 MiB wire contract. */
export class DshRemoteFragmentReader {
  private readonly transfers = new Map<string, { started: number; bytes: number; count: number; hash: string; chunks: Map<number, Buffer>; received: number }>()
  accept(payload: Record<string, unknown>): Record<string, unknown> | undefined {
    if (payload.protocol !== 'dsh.remote-fragment') return payload
    const id = payload.transfer_ref
    if (typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(id)) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '分片标识无效')
    for (const [key, transfer] of this.transfers) if (Date.now() - transfer.started > 45_000) this.transfers.delete(key)
    const count = Number(payload.fragment_count), index = Number(payload.fragment_index), bytes = Number(payload.payload_bytes)
    if (payload.protocol_major !== 1 || payload.kind !== 'fragment' || !Number.isSafeInteger(count) || count < 2 || count > 2048
      || !Number.isSafeInteger(index) || index < 0 || index >= count || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > 64 * 1024 * 1024
      || typeof payload.chunk !== 'string' || !/^[A-Za-z0-9_-]+$/.test(payload.chunk) || payload.chunk.length > 44_000
      || typeof payload.payload_sha256 !== 'string') throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '历史分片无效')
    let transfer = this.transfers.get(id)
    if (!transfer) {
      if (this.transfers.size >= 4 || [...this.transfers.values()].reduce((sum, value) => sum + value.bytes, bytes) > 64 * 1024 * 1024) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '历史分片超过接收上限')
      transfer = { started: Date.now(), bytes, count, hash: payload.payload_sha256, chunks: new Map(), received: 0 }
      this.transfers.set(id, transfer)
    }
    if (transfer.bytes !== bytes || transfer.count !== count || transfer.hash !== payload.payload_sha256) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '历史分片信息冲突')
    const chunk = Buffer.from(payload.chunk, 'base64url')
    const previous = transfer.chunks.get(index)
    if (previous && !previous.equals(chunk)) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '历史分片内容冲突')
    if (!previous) { transfer.chunks.set(index, chunk); transfer.received += chunk.length }
    if (transfer.received > bytes) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '历史分片长度无效')
    if (transfer.chunks.size !== count) return
    this.transfers.delete(id)
    const content = Buffer.concat(Array.from({ length: count }, (_, i) => transfer!.chunks.get(i)!))
    if (content.length !== bytes || createHash('sha256').update(content).digest('base64url') !== transfer.hash) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '历史分片校验失败')
    const value: unknown = JSON.parse(content.toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '分片对象无效')
    return value as Record<string, unknown>
  }
}
