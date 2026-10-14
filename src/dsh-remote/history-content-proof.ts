import { createHash } from 'node:crypto'

type Event = { seq: number; type: string; time?: unknown; data?: unknown }
export type ContentProof = { version: 1; messages: Record<string, number>; sequence: string[] }
const messageTypes = new Set(['user/message', 'system/message', 'assistant/message', 'tool/call', 'tool/result'])
// Match Go's JSON encoder (UTF-8 key order, HTML escaping disabled). No title,
// seq, stream wrappers or regenerated chunks participate in message identity.
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map(key => `${canonical(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('Invalid message value')
  return encoded.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}
export function contentMessageKey(event: Event): string | undefined {
  if (!messageTypes.has(event.type)) return
  if (!Number.isSafeInteger(event.time) || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) throw new Error('Invalid message event')
  const data = event.data as Record<string, unknown>
  // Turn/step are format coordinates. Keep all other fields, including tool
  // metadata/errors and assistant usage. v3 embeds old token chunks as stream;
  // the complete message (including reasoning) remains its content identity.
  const payload = Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'turn' && key !== 'step' && !(event.type === 'assistant/message' && key === 'stream')))
  const encoded = canonical([event.type, event.time, payload])
  if (Buffer.byteLength(encoded) > 16 * 1024 * 1024) throw new Error('Message proof exceeds limit')
  return createHash('sha256').update(encoded).digest('hex')
}
export function parseContentProof(value: unknown): ContentProof {
  const proof = value as ContentProof
  if (proof?.version !== 1 || !proof.messages || Array.isArray(proof.messages) || typeof proof.messages !== 'object') throw new Error('Content proof unavailable')
  let total = 0
  for (const [key, count] of Object.entries(proof.messages)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !Number.isSafeInteger(count) || count <= 0 || (total += count) > 50_000) throw new Error('Invalid content proof')
  }
  if (!Array.isArray(proof.sequence) || proof.sequence.length !== total) throw new Error('Invalid message order proof')
  const counts: Record<string, number> = {}
  for (const key of proof.sequence) {
    if (typeof key !== 'string' || !Object.hasOwn(proof.messages, key)) throw new Error('Invalid message order proof')
    counts[key] = (counts[key] ?? 0) + 1
  }
  if (Object.entries(proof.messages).some(([key, count]) => counts[key] !== count)) throw new Error('Invalid message multiplicity')
  return proof
}
export const contentCovers = (complete: ContentProof, source: ContentProof): boolean => {
  if (!source.sequence.length) return false
  let matched = 0
  for (const key of complete.sequence) if (key === source.sequence[matched]) matched++
  return matched === source.sequence.length
}

/** Public persistence handles provide bounded, cancellable reads. The DSH
 * owner performs format conversion/validation; plugin code never reads files. */
export async function readLocalContentProof(persistence: unknown, session: string, through: number, signal: AbortSignal): Promise<ContentProof> {
  const service = persistence as { open?: (id: string, access: 'read', options: { signal: AbortSignal }) => Promise<{
    read(offset: number, length: number, options: { signal: AbortSignal }): Promise<{ events: readonly Event[] }>
    close(): Promise<void>
  }> }
  if (typeof service?.open !== 'function') throw new Error('Public bounded history reads unavailable')
  if (!Number.isSafeInteger(through) || through < -1 || through >= 3_000_000) throw new Error('Local history exceeds verification limit')
  const handle = await service.open(session, 'read', { signal })
  const messages: Record<string, number> = {}, sequence: string[] = []
  let offset = 0, count = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const { events } = await handle.read(offset, 256, { signal })
      if (!events.length) break
      if (events.length > 256 || offset + events.length > 3_000_000) throw new Error('Local history exceeds verification limit')
      for (const event of events) {
        if (event.seq !== offset++) throw new Error('Local history coordinates changed')
        const key = contentMessageKey(event)
        if (key) { if (++count > 50_000) throw new Error('Message proof exceeds limit'); messages[key] = (messages[key] ?? 0) + 1; sequence.push(key) }
      }
    }
    signal.throwIfAborted()
    return { version: 1, messages, sequence }
  } finally { await handle.close() }
}
