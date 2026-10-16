import type { ArkmeContentBlock } from '../types.js'
import type { ArkmeRecordRevision } from '../record-edit-history.js'

export interface HistoryTextRun { kind: 'same' | 'removed' | 'added'; text: string }
export interface HistoryTextDiff { runs: HistoryTextRun[]; changes: number; coarse: boolean }
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const tokens = (text: string) => [...segmenter.segment(text)].map(part => part.segment)

function compact(runs: HistoryTextRun[]): HistoryTextRun[] {
  const result: HistoryTextRun[] = []
  for (const run of runs) {
    if (!run.text) continue
    const last = result.at(-1)
    if (last?.kind === run.kind) last.text += run.text
    else result.push({ ...run })
  }
  return result
}

/** Bounded Myers diff. Prefix/suffix trimming keeps tiny edits in long notes cheap.
 * A complete rewrite falls back to an explicitly labelled block comparison. */
export function historyTextDiff(before: string, after: string): HistoryTextDiff {
  if (before === after) return { runs: before ? [{ kind: 'same', text: before }] : [], changes: 0, coarse: false }
  const left = tokens(before), right = tokens(after)
  let start = 0, end = 0
  while (start < Math.min(left.length, right.length) && left[start] === right[start]) start++
  while (end < Math.min(left.length, right.length) - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++
  const a = left.slice(start, left.length - end), b = right.slice(start, right.length - end)
  const prefix: HistoryTextRun = { kind: 'same', text: left.slice(0, start).join('') }
  const suffix: HistoryTextRun = { kind: 'same', text: end ? left.slice(-end).join('') : '' }
  let middle: HistoryTextRun[] | undefined
  if (!a.length || !b.length) middle = [{ kind: 'removed', text: a.join('') }, { kind: 'added', text: b.join('') }]
  else {
    let work = 0
    const trace: Map<number, number>[] = []
    const v = new Map<number, number>([[1, 0]])
    outer: for (let d = 0; d <= Math.min(a.length + b.length, 384); d++) {
      trace.push(new Map(v))
      for (let k = -d; k <= d; k += 2) {
        if (++work > 200_000) break outer
        let x = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))
          ? v.get(k + 1) ?? 0 : (v.get(k - 1) ?? 0) + 1
        let y = x - k
        while (x < a.length && y < b.length && a[x] === b[y]) {
          x++; y++
          if (++work > 200_000) break outer
        }
        v.set(k, x)
        if (x >= a.length && y >= b.length) {
          const reversed: HistoryTextRun[] = []
          for (let step = d; step >= 0; step--) {
            const previous = trace[step]!, diagonal = x - y
            const previousDiagonal = diagonal === -step || (diagonal !== step && (previous.get(diagonal - 1) ?? -1) < (previous.get(diagonal + 1) ?? -1))
              ? diagonal + 1 : diagonal - 1
            const px = previous.get(previousDiagonal) ?? 0, py = px - previousDiagonal
            while (x > px && y > py) { reversed.push({ kind: 'same', text: a[--x]! }); y-- }
            if (step > 0) {
              if (x === px) reversed.push({ kind: 'added', text: b[--y]! })
              else reversed.push({ kind: 'removed', text: a[--x]! })
            }
          }
          middle = reversed.reverse()
          break outer
        }
      }
    }
  }
  const coarse = middle === undefined
  const runs = compact([prefix, ...(middle ?? [{ kind: 'removed' as const, text: a.join('') }, { kind: 'added' as const, text: b.join('') }]), suffix])
  return { runs, coarse, changes: runs.filter((run, i) => run.kind !== 'same' && (i === 0 || runs[i - 1]?.kind === 'same')).length }
}

/** Leave a little context around each change; never truncate changed text. */
export function historyDiffContext(runs: HistoryTextRun[], radius = 24): (HistoryTextRun | { kind: 'gap'; text: string })[] {
  return runs.flatMap((run, index): (HistoryTextRun | { kind: 'gap'; text: string })[] => {
    if (run.kind !== 'same') return [run]
    const parts = tokens(run.text)
    const keepStart = index > 0 ? radius : 0, keepEnd = index < runs.length - 1 ? radius : 0
    if (parts.length <= keepStart + keepEnd + 12) return [run]
    return [
      ...(keepStart ? [{ kind: 'same' as const, text: parts.slice(0, keepStart).join('') }] : []),
      { kind: 'gap', text: parts.slice(keepStart, parts.length - keepEnd).join('') },
      ...(keepEnd ? [{ kind: 'same' as const, text: parts.slice(-keepEnd).join('') }] : []),
    ]
  })
}

export interface HistoryAttachmentDiff {
  available: boolean
  added: ArkmeContentBlock[]
  removed: ArkmeContentBlock[]
  renamed: { before: string; after: string }[]
  reordered: boolean
}
type Content = ArkmeRecordRevision['content']
export function historyAttachmentDiff(before: Content, after: Content): HistoryAttachmentDiff {
  const result: HistoryAttachmentDiff = { available: true, added: [], removed: [], renamed: [], reordered: false }
  // Missing hydration is not a deletion. Temporary media refs are not file identity.
  if (before.mediaUnavailable || after.mediaUnavailable || [...before.contentBlocks, ...after.contentBlocks].some(block => !block.fileAssetUid)) {
    return { ...result, available: false }
  }
  const remaining = before.contentBlocks.map((block, index) => ({ block, index }))
  const matched: number[] = []
  for (const block of after.contentBlocks) {
    const index = remaining.findIndex(entry => entry.block.fileAssetUid === block.fileAssetUid)
    if (index < 0) result.added.push(block)
    else {
      const match = remaining.splice(index, 1)[0]!
      matched.push(match.index)
      if (match.block.fileName !== block.fileName) result.renamed.push({ before: match.block.fileName, after: block.fileName })
    }
  }
  result.removed = remaining.map(entry => entry.block)
  result.reordered = matched.some((value, i) => i > 0 && value < matched[i - 1]!)
  return result
}
