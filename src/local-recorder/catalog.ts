import { readRecorderBlock, recorderBlockPages, type RecorderManifest, type RecorderPage } from './volume.js'
import type { LocalRecorderRecording } from './contract.js'
import { safeUint64 } from './protocol.js'
interface Session {
  id: number; start: number; declaredStart?: number | undefined; samples: number; cachedSamples: number; audioBytes: number; complete: boolean
  anchor?: number | undefined; boot?: string | undefined; uptime?: number | undefined; end?: number | undefined; reason?: number | undefined; batteryStart?: number | undefined; batteryEnd?: number | undefined
  firmware?: number | undefined; gainStart?: number | undefined; gainChanges: number; vadEnabled?: boolean | undefined; vadThreshold?: number | undefined; blocks: Set<number>
}
interface Anchor { boot: string; uptime: number; unix: number }
interface BlockSummary { hash: string; sessions: Map<number, Session>; anchors: Anchor[] }
const session = (id: number): Session => ({ id, start: 0, samples: 0, cachedSamples: 0, audioBytes: 0, complete: false, gainChanges: 0, blocks: new Set() })
const voltage = (value: number) => value > 0 && value <= 6000 ? value : undefined
function gain(page: RecorderPage, offset: number): number | undefined {
  const data = page.payload, code = data[offset]!, min = data[offset + 1]!, max = data[offset + 2]!
  return data[offset + 3] === 1 && min <= max && code >= min && code <= max ? (code - 40) / 2 : undefined
}
function summarize(bytes: Buffer, physical: number, hash: string): BlockSummary {
  const result: BlockSummary = { hash, sessions: new Map(), anchors: [] }
  for (const page of recorderBlockPages(bytes)) {
    const clock = page.payload.length === 24 && page.payload[0] === 1
      ? { boot: page.payload.readBigUInt64LE(4).toString(), uptime: safeUint64(page.payload, 12) } : undefined
    if (page.type === 10 && clock && page.unixMillis > 0) result.anchors.push({ ...clock, unix: page.unixMillis })
    if (!page.sessionId) continue
    const row = result.sessions.get(page.sessionId) ?? session(page.sessionId)
    row.blocks.add(physical)
    if (page.type === 3) {
      row.start = page.unixMillis; row.declaredStart = page.unixMillis
      if (page.payload.length === 32) {
        row.firmware = page.payload.readUInt32LE(0) || undefined
        row.batteryStart = voltage(page.payload.readUInt32LE(4))
        row.gainStart = gain(page, 24)
      }
    }
    if (page.type === 4) {
      const samples = page.payload.length / (page.codec === 2 ? 2 : 1)
      row.cachedSamples += samples; row.audioBytes += page.payload.length
      if (!Number.isSafeInteger(page.sampleIndex + samples)) throw new Error('录音采样位置超出安全范围')
      row.samples = Math.max(row.samples, page.sampleIndex + samples)
      if (!row.start && page.unixMillis > 0) row.start = page.unixMillis - Math.floor(page.sampleIndex / 16)
    }
    if (page.type === 5) {
      row.complete = true; row.end = page.unixMillis
      if (page.payload.length === 32) {
        row.reason = page.payload.readUInt32LE(0); row.batteryEnd = voltage(page.payload.readUInt32LE(4))
        row.samples = Math.max(row.samples, safeUint64(page.payload, 8))
      }
    }
    if (page.type === 7 && page.unixMillis > 0) row.anchor = page.unixMillis - Math.floor(page.sampleIndex / 16)
    if (page.type === 8 && page.payload.length === 8 && gain(page, 0) !== undefined) {
      row.gainChanges++; if (!page.sampleIndex) row.gainStart = gain(page, 0)
    }
    if (page.type === 9 && clock) { row.boot = clock.boot; row.uptime = clock.uptime }
    if (page.type === 13 && [8, 12].includes(page.payload.length) && [1, 2].includes(page.payload[0]!)
      && page.payload[1]! <= 1 && page.payload.readUInt16LE(2) >= 20 && page.payload.readUInt16LE(2) <= 1000) {
      row.vadEnabled = page.payload[1] === 1; row.vadThreshold = page.payload.readUInt16LE(2)
    }
    result.sessions.set(page.sessionId, row)
  }
  return result
}
/** Only new/changed blocks are read and parsed. Summaries never retain audio payloads. */
export class RecorderCatalog {
  private volume = ''
  private readonly blocks = new Map<number, BlockSummary>()
  async update(directory: string, manifest: RecorderManifest, signal?: AbortSignal) {
    if (manifest.blocks.length > 2048 || new Set(manifest.blocks.map(block => block.physical)).size !== manifest.blocks.length) throw new Error('录音目录包含重复或过量区块')
    if (manifest.volume !== this.volume) { this.blocks.clear(); this.volume = manifest.volume }
    const current = new Set(manifest.blocks.map(block => block.physical))
    for (const physical of this.blocks.keys()) if (!current.has(physical)) this.blocks.delete(physical)
    for (const block of manifest.blocks) {
      signal?.throwIfAborted()
      if (this.blocks.get(block.physical)?.hash !== block.hash) {
        this.blocks.set(block.physical, summarize(await readRecorderBlock(directory, manifest, block), block.physical, block.hash))
      }
    }
  }
  recordings(manifest: RecorderManifest): LocalRecorderRecording[] {
    if (manifest.volume !== this.volume) throw new Error('录音目录与存储卷不一致')
    const sessions = new Map<number, Session>(), anchors: Anchor[] = []
    for (const block of manifest.blocks) {
      const summary = this.blocks.get(block.physical)
      if (!summary || summary.hash !== block.hash) throw new Error('录音目录与缓存版本不一致')
      anchors.push(...summary.anchors)
      for (const incoming of summary.sessions.values()) {
        const row = sessions.get(incoming.id) ?? session(incoming.id)
        if (incoming.declaredStart !== undefined) { row.start = incoming.declaredStart; row.declaredStart = incoming.declaredStart }
        else if (!row.start) row.start = incoming.start
        row.samples = Math.max(row.samples, incoming.samples); row.cachedSamples += incoming.cachedSamples
        row.audioBytes += incoming.audioBytes; row.complete ||= incoming.complete; row.gainChanges += incoming.gainChanges
        for (const physical of incoming.blocks) row.blocks.add(physical)
        for (const key of ['anchor', 'boot', 'uptime', 'end', 'reason', 'batteryStart', 'batteryEnd', 'firmware', 'gainStart', 'vadEnabled', 'vadThreshold'] as const) {
          const value = incoming[key]; if (value !== undefined) Object.assign(row, { [key]: value })
        }
        sessions.set(row.id, row)
      }
    }
    const byBoot = new Map<string, Anchor[]>()
    for (const anchor of anchors) { const list = byBoot.get(anchor.boot) ?? []; list.push(anchor); byBoot.set(anchor.boot, list) }
    for (const list of byBoot.values()) list.sort((a, b) => a.uptime - b.uptime)
    return [...sessions.values()].filter(row => row.cachedSamples > 0).map(row => {
      const candidates = byBoot.get(row.boot ?? '') ?? []
      let corrected: number | undefined
      if (row.uptime !== undefined && candidates.length) {
        const upper = candidates.findIndex(anchor => anchor.uptime >= row.uptime!)
        if (upper <= 0) { const anchor = candidates[upper === -1 ? candidates.length - 1 : 0]!; corrected = anchor.unix + row.uptime - anchor.uptime }
        else { const a = candidates[upper - 1]!, b = candidates[upper]!; corrected = Math.round(a.unix + (row.uptime - a.uptime) * (b.unix - a.unix) / (b.uptime - a.uptime)) }
      }
      const start = row.anchor ?? corrected ?? row.start, validStart = Number.isSafeInteger(start) && start > 0 && start <= 8640000000000000 ? start : null
      const end = row.end && validStart !== null && row.start > 0 ? row.end + validStart - row.start : null
      return { id: `${manifest.volume}.${row.id}`, sessionId: row.id, startAtMillis: validStart,
        durationMillis: Math.floor(row.samples / 16), complete: row.complete, cached: true,
        info: { audioBytes: row.audioBytes, cachedDurationMillis: Math.floor(row.cachedSamples / 16),
          endAtMillis: end !== null && Number.isSafeInteger(end) && end > 0 && end <= 8640000000000000 ? end : null,
          batteryStartMV: row.batteryStart ?? null, batteryEndMV: row.batteryEnd ?? null, firmwareVersion: row.firmware ?? null,
          gainStartDb: row.gainStart ?? null, gainChanges: row.gainChanges, vadEnabled: row.vadEnabled ?? null,
          vadThreshold: row.vadThreshold ?? null, stopReason: row.reason ?? null, blockCount: row.blocks.size, crcVerified: true } }
    }).sort((a, b) => (b.startAtMillis ?? 0) - (a.startAtMillis ?? 0) || b.sessionId - a.sessionId)
  }
}
export async function recorderCatalog(directory: string, manifest: RecorderManifest): Promise<LocalRecorderRecording[]> {
  const catalog = new RecorderCatalog(); await catalog.update(directory, manifest); return catalog.recordings(manifest)
}
