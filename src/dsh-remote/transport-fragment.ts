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
  const encoded = Buffer.from(JSON.stringify(envelope))
  if (encoded.length <= DIRECT_PLAINTEXT_BYTES) return [{ value: envelope }]
  if (encoded.length > DSH_REMOTE_MAX_FRAGMENTED_PAYLOAD_BYTES) {
    throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '完整 DSH 事件超过 64MiB 安全上限', false, {
      logicalTooLarge: true,
      payloadBytes: encoded.length,
    })
  }
  const fragmentCount = Math.ceil(encoded.length / FRAGMENT_CHUNK_BYTES)
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
        fragmentIndex * FRAGMENT_CHUNK_BYTES,
        Math.min(encoded.length, (fragmentIndex + 1) * FRAGMENT_CHUNK_BYTES),
      ).toString('base64url'),
    },
  }))
}
