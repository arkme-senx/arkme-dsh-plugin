import type { RecordingEntityItem } from '../../recording-entity-contract.js'

export interface RecordingEntityUnderline {
  start: number
  length: number
  entityKey: string
  name: string
}

/** Name links open the entity list; precise transcript navigation still uses owner occurrences. */
export function createRecordingEntityUnderliner(entities: readonly Pick<RecordingEntityItem, 'key' | 'name'>[]) {
  // Prepare once for the day's transcript. Longer names win overlaps, then original list order.
  const names = entities.map((entity, index) => ({ ...entity, name: entity.name.trim(), index }))
    .filter(entity => entity.name !== '').sort((a, b) => a.name.length - b.name.length || b.index - a.index)
  const word = (value: string | undefined) => value !== undefined && /[a-zA-Z0-9_]/.test(value)
  return (text: string): RecordingEntityUnderline[] => {
    if (!text || !names.length) return []
    const owners = new Int32Array(text.length)
    for (const [index, { name }] of names.entries()) {
      // Union repeats before filling, keeping work per name bounded by transcript length.
      let runStart = -1, runEnd = 0
      for (let from = 0; from < text.length;) {
        const start = text.indexOf(name, from)
        if (start < 0) break
        const end = start + name.length
        from = start + 1
        if ((word(name[0]) && word(text[start - 1])) || (word(name.at(-1)) && word(text[end]))) continue
        if (runStart >= 0 && start > runEnd) { owners.fill(index + 1, runStart, runEnd); runStart = -1 }
        if (runStart < 0) runStart = start
        runEnd = end
      }
      if (runStart >= 0) owners.fill(index + 1, runStart, runEnd)
    }
    const ranges: RecordingEntityUnderline[] = []
    let utf16 = 0, point = 0, owner = 0, start = 0
    const finish = () => {
      if (!owner) return
      const entity = names[owner - 1]!
      ranges.push({ start, length: point - start, entityKey: entity.key, name: entity.name })
    }
    for (const character of text) {
      const next = owners[utf16]!
      if (next !== owner) { finish(); start = point; owner = next }
      utf16 += character.length
      point += 1
    }
    finish()
    return ranges
  }
}
