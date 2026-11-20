import { expect, it } from 'vitest'
import { buildTranscriptHistoryPeriods } from '../src/client/recordings/transcript-history.js'
import type { ArkmeRecordingWorkbenchItem } from '../src/types.js'

function item(text: string, start: number, end = start + 10_000): ArkmeRecordingWorkbenchItem {
  return { itemId: text, itemRef: '', sessionKey: '', transcriptSource: 'system', text, startAtMillis: start, endAtMillis: end,
    speakerNumber: 1, speakerKey: 'speaker', speakerLabel: '说话人 1', speakerColorIndex: 1,
    canBindSpeaker: false, isSelf: false, isBackground: false, textStartOffset: 0, textEndOffset: text.length, textTotalLength: text.length }
}
it('groups a partial replacement in one minute, excludes unchanged and later appended minutes', () => {
  const a = item('A', 0, 30_000), b = item('B', 0, 30_000), d = item('D', 10_000, 13_000)
  const c = item('C', 60_000), e = item('E', 120_000)
  const groups = buildTranscriptHistoryPeriods([{ ...b, activeRanges: [{ startAtMillis: 0, endAtMillis: 10000 }, { startAtMillis: 13000, endAtMillis: 30000 }] }, d, c, e], [
    { versionRef: 'before-d', createdAtMillis: 3, items: [b, { ...c, itemId: 'live-c', speakerLabel: '新名字' }] },
    { versionRef: 'duplicate', createdAtMillis: 2, items: [b, c] },
    { versionRef: 'before-b', createdAtMillis: 1, items: [a, c] },
  ])
  expect(groups).toHaveLength(3)
  expect(groups[0]?.versions.map(v => v.items.map(i => i.text))).toEqual([['B', 'D'], ['B'], ['A']])
  expect(groups.slice(1).map(g => g.versions.length)).toEqual([1, 1])
})
it('keeps a long utterance whole when replacement overlaps another minute', () => {
  const original = item('完整长句，不切割正文', 30_000, 150_000)
  const replacement = item('中间替换', 70_000, 85_000)
  const [group] = buildTranscriptHistoryPeriods([{ ...original, activeRanges: [{ startAtMillis: 30000, endAtMillis: 70000 }, { startAtMillis: 85000, endAtMillis: 150000 }] }, replacement], [{ versionRef: 'old', createdAtMillis: 1, items: [original] }])
  expect(group?.startAtMillis).toBe(0)
  expect(group?.endAtMillis).toBe(180_000)
  expect(group?.versions[1]?.items).toEqual([original])
})
it('detects changed effective ranges but ignores media availability and speaker enrichment', () => {
  const original = item('正文', 0, 30_000)
  const current = { ...original, activeRanges: [{ startAtMillis: 0, endAtMillis: 10_000 }] }
  expect(buildTranscriptHistoryPeriods([current], [{ versionRef: 'old', createdAtMillis: 1, items: [original] }])[0]?.versions).toHaveLength(2)
  expect(buildTranscriptHistoryPeriods([{ ...original, playable: true }], [{ versionRef: 'old', createdAtMillis: 1,
    items: [{ ...original, playable: false, activeRanges: [{ startAtMillis: 0, endAtMillis: 30_000 }] }] }])[0]?.versions).toHaveLength(1)
})
it('keeps historical-only periods accessible without inventing a blank historical version for new content', () => {
  const groups = buildTranscriptHistoryPeriods([], [{ versionRef: 'old', createdAtMillis: 1, items: [item('旧正文', 60_000)] }])
  expect(groups[0]?.versions.map(v => v.items.length)).toEqual([0, 1])
})
it('does not mark an unchanged minute red just because more text was appended in that minute', () => {
  const first = item('先前', 0, 10000), later = item('随后新增', 20000, 30000)
  expect(buildTranscriptHistoryPeriods([first, later], [{ versionRef: 'old', createdAtMillis: 1, items: [first] }])[0]?.versions).toHaveLength(1)
})
it('bounds item scans for a full day with hundreds of independent periods', () => {
  let reads = 0
  const entries = Array.from({ length: 600 }, (_, i) => ({ ...item(`内容${i}`, i * 60000), get startAtMillis() { reads++; return i * 60000 } }))
  const result = buildTranscriptHistoryPeriods(entries, [{ versionRef: 'old', createdAtMillis: 1, items: entries }])
  expect(result).toHaveLength(600)
  expect(result.every(period => period.versions.length === 1)).toBe(true)
  expect(reads).toBeLessThan(entries.length * 100)
})
