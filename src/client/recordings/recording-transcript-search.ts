import { polyphonic } from 'pinyin-pro'
import type { ArkmeRecordingDaySearchCandidate, ArkmeRecordingWorkbenchItem } from '../../types.js'

export interface RecordingTranscriptMatch {
  itemId: string
  start: number
  length: number
}

export interface RecordingTranscriptSearchHit {
  key: string
  startAtMillis: number
  identityHash?: string
  matchIndex?: number
}

/** Combine early candidates with the real, possibly corrected transcript.
 * Once an utterance has loaded, its displayed text owns the match count. */
export function recordingTranscriptSearchHits(
  items: readonly ArkmeRecordingWorkbenchItem[], matches: readonly RecordingTranscriptMatch[],
  candidates: readonly ArkmeRecordingDaySearchCandidate[], query: string,
): RecordingTranscriptSearchHit[] {
  const byId = new Map(items.map(item => [item.itemId, item]))
  const loaded = new Set(items.filter(item => item.textEndOffset >= item.textTotalLength).map(item => item.searchIdentityHash))
  const counts = new Map<string, number>()
  const keyFor = (id: string) => {
    const order = counts.get(id) ?? 0
    counts.set(id, order + 1)
    return `${id}:${String(order)}`
  }
  const hits: RecordingTranscriptSearchHit[] = matches.flatMap((match, matchIndex) => {
    const item = byId.get(match.itemId)
    if (!item) return []
    return [{
      key: keyFor(item.searchIdentityHash ?? item.itemId), startAtMillis: item.startAtMillis, matchIndex,
      ...(item.searchIdentityHash ? { identityHash: item.searchIdentityHash } : {}),
    }]
  })
  const pending = new Map(candidates.filter(item => !loaded.has(item.identityHash) && !counts.has(item.identityHash)).map(item => [item.identityHash, item]))
  for (const candidate of pending.values()) {
    const matches = findRecordingTranscriptMatches([{ itemId: candidate.identityHash, text: candidate.snippet }], query)
    for (const _match of matches) hits.push({
      key: keyFor(candidate.identityHash), startAtMillis: candidate.startAtMillis, identityHash: candidate.identityHash,
    })
  }
  return hits.sort((a, b) => a.startAtMillis - b.startAtMillis)
}

/** Locate occurrences in the loaded day document; never join separate ASR paragraphs. */
export function findRecordingTranscriptMatches(
  items: readonly { itemId: string; text: string }[],
  keyword: string,
): RecordingTranscriptMatch[] {
  const query = Array.from(keyword.trim())
  if (query.length === 0) return []
  const readings = new Map<string, string[]>()
  const syllables = (character: string): string[] => {
    let value = readings.get(character)
    if (value === undefined) {
      value = /^\p{Script=Han}$/u.test(character)
        ? (polyphonic(character, { type: 'array', toneType: 'none' })[0] ?? [])
        : []
      readings.set(character, value)
    }
    return value
  }
  const phonetic = query.length >= 2 && query.every(character => syllables(character).length > 0)
  const seen = new Set<string>()
  const result: RecordingTranscriptMatch[] = []
  for (const item of items) {
    if (seen.has(item.itemId)) continue
    seen.add(item.itemId)
    const text = Array.from(item.text)
    for (let start = 0; start <= text.length - query.length;) {
      const literal = query.every((character, offset) => character === text[start + offset])
      const homophone = phonetic && query.every((character, offset) =>
        syllables(text[start + offset]!).some(value => syllables(character).includes(value)))
      if (literal || homophone) {
        result.push({ itemId: item.itemId, start, length: query.length })
        start += query.length
      } else start += 1
    }
  }
  return result
}
