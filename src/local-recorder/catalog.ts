import { readRecorderBlock, recorderBlockPages, type RecorderManifest } from './volume.js'
import type { LocalRecorderRecording } from './contract.js'
import { safeUint64 } from './protocol.js'
interface Session {
  id: number; start: number; samples: number; complete: boolean; anchor?: number
  boot?: string; uptime?: number
}
export async function recorderCatalog(directory: string, manifest: RecorderManifest): Promise<LocalRecorderRecording[]> {
  const sessions = new Map<number, Session>()
  const anchors: Array<{ boot: string; uptime: number; unix: number }> = []
  for (const block of manifest.blocks) {
    for (const page of recorderBlockPages(await readRecorderBlock(directory, manifest, block))) {
      const clock = page.payload.length === 24 && page.payload[0] === 1
        ? { boot: page.payload.readBigUInt64LE(4).toString(), uptime: safeUint64(page.payload, 12) } : undefined
      if (page.type === 10 && clock && page.unixMillis > 0) anchors.push({ ...clock, unix: page.unixMillis })
      if (!page.sessionId) continue
      const session = sessions.get(page.sessionId) ?? { id: page.sessionId, start: 0, samples: 0, complete: false }
      if (page.type === 3) session.start = page.unixMillis
      if (page.type === 4) {
        session.samples += page.payload.length / (page.codec === 2 ? 2 : 1)
        if (!session.start && page.unixMillis > 0) session.start = page.unixMillis - Math.floor(page.sampleIndex / 16)
      }
      if (page.type === 5) session.complete = true
      if (page.type === 7 && page.unixMillis > 0) session.anchor = page.unixMillis - Math.floor(page.sampleIndex / 16)
      if (page.type === 9 && clock) { session.boot = clock.boot; session.uptime = clock.uptime }
      sessions.set(page.sessionId, session)
    }
  }
  return [...sessions.values()].filter(session => session.samples > 0).map(session => {
    const candidates = anchors.filter(anchor => anchor.boot === session.boot).sort((a, b) => a.uptime - b.uptime)
    let corrected: number | undefined
    if (session.uptime !== undefined && candidates.length) {
      const upper = candidates.findIndex(anchor => anchor.uptime >= session.uptime!)
      if (upper <= 0) {
        const anchor = candidates[upper === -1 ? candidates.length - 1 : 0]!
        corrected = anchor.unix + session.uptime - anchor.uptime
      } else {
        const a = candidates[upper - 1]!, b = candidates[upper]!
        corrected = Math.round(a.unix + (session.uptime - a.uptime) * (b.unix - a.unix) / (b.uptime - a.uptime))
      }
    }
    const start = session.anchor ?? corrected ?? session.start
    return { id: `${manifest.volume}.${session.id}`, sessionId: session.id,
      startAtMillis: Number.isSafeInteger(start) && start > 0 ? start : null,
      durationMillis: Math.floor(session.samples / 16), complete: session.complete, cached: true }
  }).sort((a, b) => (b.startAtMillis ?? 0) - (a.startAtMillis ?? 0) || b.sessionId - a.sessionId)
}
