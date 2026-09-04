import { polyphonic } from 'pinyin-pro'

export interface RecordingTranscriptMatch {
  itemId: string
  start: number
  length: number
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
