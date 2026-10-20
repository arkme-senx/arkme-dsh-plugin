import { describe, expect, it } from 'vitest'
import { historyAttachmentDiff, historyDiffContext, historyTextDiff } from '../src/client/record-history-diff.js'
import type { ArkmeContentBlock } from '../src/types.js'

const reconstruct = (before: string, after: string) => {
  const diff = historyTextDiff(before, after)
  expect(diff.runs.filter(run => run.kind !== 'added').map(run => run.text).join('')).toBe(before)
  expect(diff.runs.filter(run => run.kind !== 'removed').map(run => run.text).join('')).toBe(after)
  return diff
}
describe('history text differences', () => {
  it('pinpoints one Chinese character in a long message and folds only unchanged context', () => {
    const before = '内容很长。'.repeat(1000) + '我们周三下午开会。' + '未改内容。'.repeat(1000)
    const diff = reconstruct(before, before.replace('周三', '周四'))
    expect(diff.runs.filter(run => run.kind !== 'same')).toEqual([{ kind: 'removed', text: '三' }, { kind: 'added', text: '四' }])
    expect(diff.changes).toBe(1)
    const context = historyDiffContext(diff.runs)
    expect(context.filter(run => run.kind !== 'gap').map(run => run.text).join('').length).toBeLessThan(100)
  })
  it('separates distant changes without showing the untouched middle as replaced', () => {
    const middle = '这是未改动的句子。'.repeat(300)
    const diff = reconstruct('开头甲' + middle + '结尾乙', '开头丙' + middle + '结尾丁')
    expect(diff.changes).toBe(2)
    expect(diff.coarse).toBe(false)
    expect(diff.runs.filter(run => run.kind !== 'same').map(run => run.text)).toEqual(['甲', '丙', '乙', '丁'])
  })
  it.each([['', '新增'], ['删除', ''], ['一二三', '三二一'], ['aaaab', 'baaaa'], ['相同', '相同'], ['👨‍👩‍👧‍👦你好é', '👨‍👩‍👦你好é']])('roundtrips %s → %s', (a, b) => { reconstruct(a, b) })
  it('never splits a grapheme or silently normalizes whitespace/formatting edits', () => {
    expect(reconstruct('hello👨‍👩‍👧‍👦', 'hello👨‍👩‍👦').runs.at(-1)?.text).toBe('👨‍👩‍👦')
    expect(reconstruct('**标题**\n正文', '**标题**\n\n正文').changes).toBe(1)
  })
  it('bounds a full rewrite and preserves both complete versions', () => {
    const diff = reconstruct('甲'.repeat(20000), '乙'.repeat(20000))
    expect(diff.coarse).toBe(true)
  })
  it('roundtrips deterministic edit combinations including repeated characters', () => {
    let seed = 9
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed }
    const alphabet = ['甲', '乙', '丙', ' ', '\n', '👩‍💻']
    for (let i = 0; i < 150; i++) {
      const sample = () => Array.from({ length: random() % 50 }, () => alphabet[random() % alphabet.length]).join('')
      reconstruct(sample(), sample())
    }
  })
})
const file = (uid: string, name = uid, mediaRef = 'rotating'): ArkmeContentBlock => ({ kind: 'file', fileAssetUid: uid, mediaRef, fileName: name, size: 10, sortOrder: 0, mimeType: 'application/pdf' })
const content = (contentBlocks: ArkmeContentBlock[], mediaUnavailable = false) => ({ title: '', textContent: '', contentBlocks, mediaUnavailable })
describe('history attachment differences', () => {
  it('uses asset identity, not names or rotating access references', () => {
    const result = historyAttachmentDiff(content([file('a', '同名.pdf', 'old')]), content([file('a', '改名.pdf', 'new'), file('b', '同名.pdf')]))
    expect(result.added.map(f => f.fileAssetUid)).toEqual(['b'])
    expect(result.removed).toEqual([])
    expect(result.renamed).toEqual([{ before: '同名.pdf', after: '改名.pdf' }])
  })
  it('distinguishes removed files, duplicate occurrences and reordering', () => {
    const result = historyAttachmentDiff(content([file('a'), file('b'), file('a'), file('c')]), content([file('c'), file('a'), file('b')]))
    expect(result.removed.map(f => f.fileAssetUid)).toEqual(['a'])
    expect(result.reordered).toBe(true)
  })
  it('never interprets missing historical attachments as deletion', () => {
    expect(historyAttachmentDiff(content([file('a')]), content([], true))).toMatchObject({ available: false, added: [], removed: [] })
    const unknown = file(''); delete unknown.fileAssetUid
    expect(historyAttachmentDiff(content([unknown]), content([])).available).toBe(false)
  })
})
