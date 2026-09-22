import { describe, expect, it } from 'vitest'
import { prepareAskDshNotes, askDshNotesWithLocalNames } from '../src/client/ask-dsh-notes.js'
import type { ArkmeTimelineItem, ArkmeMessageSnapshotDetail, ArkmeContentBlock } from '../src/types.js'
const block = (name: string, uid: string): ArkmeContentBlock => ({ kind: 'file', fileAssetUid: uid, fileName: name, originalRef: uid, mediaRef: 'preview', mimeType: 'application/pdf', size: 4, sortOrder: 0 })
const item = (id: string): ArkmeTimelineItem => ({ itemUid: id, title: id, textContent: `完整正文${id}`, messageActionRef: id, senderName: '我', isMe: true, sendAtMillis: 1000, status: 0 })
const detail = (id: string, blocks: ArkmeContentBlock[]): ArkmeMessageSnapshotDetail => ({ itemUid: id, textContent: `完整正文${id}`, backgroundSound: 'unknown', contentBlocks: blocks })
describe('问 DSH 内容打包', () => {
  it('uses complete records in selection order, deduplicates resources and disambiguates names', async () => {
    const downloaded: string[] = []
    const files = await prepareAskDshNotes([item('A'), item('B')], {
      detail: async note => detail(note.itemUid, note.itemUid === 'A' ? [block('报告.pdf', 'one')] : [block('报告.pdf', 'one'), block('报告.pdf', 'two')]),
      original: async b => { downloaded.push(b.fileAssetUid!); return new Blob(['data']) },
    }, new AbortController().signal)
    expect(files.map(f => f.name)).toEqual(['快记摘录.md', '报告.pdf', '报告 (2).pdf'])
    const text = await files[0]!.text()
    expect(text).toContain('完整正文A')
    expect(text).not.toContain('截断')
    expect(text.indexOf('完整正文A')).toBeLessThan(text.indexOf('完整正文B'))
    expect(text).toContain('报告 (2).pdf')
    expect(downloaded).toEqual(['one', 'two'])
  })
  it('fails closed on missing media or mismatched record identity', async () => {
    const controller = new AbortController()
    await expect(prepareAskDshNotes([item('A')], { detail: async () => ({ ...detail('A', []), mediaUnavailable: true }), original: async () => new Blob() }, controller.signal)).rejects.toThrow('附件')
    await expect(prepareAskDshNotes([item('A')], { detail: async () => detail('B', []), original: async () => new Blob() }, controller.signal)).rejects.toThrow('不匹配')
  })
  it('does not silently omit unavailable originals and respects cancellation', async () => {
    await expect(prepareAskDshNotes([item('A')], { detail: async () => detail('A', [block('报告.pdf', 'one')]), original: async () => { throw Error('下载失败') } }, new AbortController().signal)).rejects.toThrow('报告.pdf')
    const c = new AbortController(); c.abort()
    await expect(prepareAskDshNotes([item('A')], { detail: async () => detail('A', []), original: async () => new Blob() }, c.signal)).rejects.toThrow()
  })
})

it('retains Markdown, full long text, available source links and dynamic-photo originals', async () => {
  const motion = { ...block('motion.mov', 'motion'), kind: 'video' as const }
  const cover = { ...block('cover.jpg', 'cover'), kind: 'image' as const, dynamicPhoto: { logicalUid: 'live', motion } }
  const body = '# 标题\n\n' + '完整正文'.repeat(10000)
  const files = await prepareAskDshNotes([{ ...item('A'), textContent: body }], {
    detail: async () => ({ ...detail('A', [cover]), textContent: body, textFormat: 'markdown', sourceUrl: 'https://example.test/note' }),
    original: async () => new Blob(['data']),
  }, new AbortController().signal)
  expect(files.map(file => file.name)).toEqual(['快记摘录.md', 'cover.jpg', 'motion.mov'])
  expect(await files[0]!.text()).toContain(body)
  expect(await files[0]!.text()).toContain('https://example.test/note')
})

it('rejects empty and oversized selections without reading any content', async () => {
  const reader = { detail: async () => { throw new Error('must not read') }, original: async () => new Blob() }
  for (const items of [[], Array.from({ length: 101 }, () => item('A'))]) {
    await expect(prepareAskDshNotes(items, reader, new AbortController().signal)).rejects.toThrow('1 至 100')
  }
})


it('includes each sender, preferring the viewer-resolved name over the timeline snapshot', async () => {
  const notes = [{ ...item('A'), senderName: '张工（客户）', isMe: false }, { ...item('B'), senderName: '无备注昵称', isMe: false }, { ...item('C'), senderName: '我' }]
  const files = await prepareAskDshNotes(notes, {
    detail: async note => detail(note.itemUid, []),
    original: async () => new Blob(),
  }, new AbortController().signal)
  const text = await files[0]!.text()
  expect(text).toContain('用户：张工（客户）')
  expect(text).not.toContain('旧昵称')
  expect(text).toContain('用户：无备注昵称')
  expect(text).toContain('用户：我')
})


it('reuses local remarks, private chat titles and self profile without mutating timeline rows', () => {
  const other = { ...item('A'), isMe: false, memberRef: 'member', senderName: '原昵称' }
  const members = new Map([['member', { displayName: '客户备注' }]])
  expect(askDshNotesWithLocalNames([other], { kind: 'group_chat', displayName: '群名' }, members)[0]!.senderName).toBe('客户备注')
  expect(askDshNotesWithLocalNames([other], { kind: 'private_chat', displayName: '私聊备注' }, members)[0]!.senderName).toBe('私聊备注')
  expect(askDshNotesWithLocalNames([other], { kind: 'group_chat', displayName: '群名' }, new Map())[0]!.senderName).toBe('原昵称')
  expect(askDshNotesWithLocalNames([item('me')], { kind: 'send_to_self', displayName: '发给自己' }, members, { displayName: '本人昵称', nickname: '' })[0]!.senderName).toBe('本人昵称')
  expect(other.senderName).toBe('原昵称')
})

it('reads at most four full records concurrently while preserving list order', async () => {
  const releases: Array<() => void> = []
  let active = 0, peak = 0
  const notes = Array.from({ length: 6 }, (_, i) => item(String(i)))
  const pending = prepareAskDshNotes(notes, {
    detail: async note => { active++; peak = Math.max(peak, active); await new Promise<void>(resolve => releases.push(resolve)); active--; return detail(note.itemUid, []) },
    original: async () => new Blob(),
  }, new AbortController().signal)
  expect(releases).toHaveLength(4)
  releases[3]!(); releases[2]!(); releases[1]!(); releases[0]!()
  for (let i = 0; i < 5; i++) await Promise.resolve()
  expect(releases).toHaveLength(6)
  releases[5]!(); releases[4]!()
  const text = await (await pending)[0]!.text()
  expect(peak).toBe(4)
  for (let i = 0; i < 5; i++) expect(text.indexOf(`完整正文${i}`)).toBeLessThan(text.indexOf(`完整正文${i + 1}`))
})


it('exports folded long Markdown entirely from loaded timeline data without any detail request', async () => {
  const body = '# 完整标题\n' + '长正文'.repeat(10000)
  let detailCalls = 0
  const files = await prepareAskDshNotes([{ ...item('A'), textContent: body, contentBlocks: [] }], {
    detail: async () => { detailCalls++; throw new Error('must not fetch text') },
    original: async () => { throw new Error('no attachment') },
  }, new AbortController().signal)
  expect(detailCalls).toBe(0)
  expect(await files[0]!.text()).toContain(body)
})

it('uses loaded original references directly and repairs only explicitly unavailable media', async () => {
  let detailCalls = 0
  const reader = { detail: async () => { detailCalls++; return detail('A', [block('file.pdf', 'file')]) }, original: async () => new Blob(['data']) }
  const note = { ...item('A'), textContent: '本地已加载正文', contentBlocks: [block('file.pdf', 'file')] }
  await prepareAskDshNotes([note], reader, new AbortController().signal)
  expect(detailCalls).toBe(0)
  const files = await prepareAskDshNotes([{ ...note, contentBlocks: [], attachmentSnapshotUnavailable: true }], reader, new AbortController().signal)
  expect(detailCalls).toBe(1)
  expect(await files[0]!.text()).toContain('本地已加载正文')
  expect(files.map(file => file.name)).toEqual(['快记摘录.md', 'file.pdf'])
})
