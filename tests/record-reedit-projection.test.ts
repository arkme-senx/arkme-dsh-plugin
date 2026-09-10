import { describe, expect, it } from 'vitest'
import { projectRecordReedit, recordReeditProjectionSettled } from '../src/client/record-reedit-submissions.js'
import type { ArkmeRecordReeditSubmissionView } from '../src/record-reedit-contract.js'
import type { ArkmeTimelineItem } from '../src/types.js'

const original: ArkmeTimelineItem = { itemUid: 'r', title: '', textContent: '旧文', version: 7, sendAtMillis: 1, status: 1 }
const pending: ArkmeRecordReeditSubmissionView = { submissionId: 's', itemUid: 'r', state: 'pending', baseVersion: 7, title: '', textContent: '新文', attachments: [{ localFile: { fileRef: 'local', fileName: 'new.png', mimeType: 'image/png', fileKind: 1, size: 10 }, selection: { fileRef: 'local' } }] }
describe('re-edit presentation is not a canonical record', () => {
  it('updates text and attachments together without inventing a version or send time', () => {
    expect(projectRecordReedit(original, [pending])).toMatchObject({ itemUid: 'r', textContent: '新文', version: 7, sendAtMillis: 1, contentBlocks: [{ localFileRef: 'local' }] })
  })
  it('never masks a newer canonical version while a conflicting edit is pending', () => {
    const newer = { ...original, version: 8, textContent: '其他设备更新' }
    expect(projectRecordReedit(newer, [pending])).toBe(newer)
  })
  it('retains the successful candidate until its version reaches the timeline', () => {
    const committed = { ...pending, state: 'committed' as const, result: { status: 'committed' as const, itemUid: 'r', version: 8, revisionUid: 'revision', projectionState: 'pending' as const } }
    expect(projectRecordReedit(original, [committed]).textContent).toBe('新文')
    const projected = { ...original, version: 8, textContent: '新文' }
    expect(projectRecordReedit(projected, [committed])).toBe(projected)
  })
  it('retains the candidate at its committed version until all media is available', () => {
    const committed = { ...pending, state: 'committed' as const, result: { status: 'committed' as const, itemUid: 'r', version: 8, revisionUid: 'revision', projectionState: 'pending' as const } }
    const partial = { ...original, recordVersion: 8, mediaUnavailable: true, contentBlocks: [] }
    expect(projectRecordReedit(partial, [committed]).contentBlocks).toMatchObject([{ localFileRef: 'local' }])
    expect(projectRecordReedit({ ...partial, recordVersion: 9 }, [committed]).mediaUnavailable).toBe(true)
  })
  it('uses the same completeness boundary for handoff and acknowledgement without masking later edits or deletion', () => {
    const committed = { ...pending, state: 'committed' as const, result: { status: 'committed' as const, itemUid: 'r', version: 8, revisionUid: 'revision', projectionState: 'pending' as const } }
    for (const [item, settled] of [
      [{ ...original, recordVersion: 8, mediaUnavailable: true }, false],
      [{ ...original, recordVersion: 8, mediaUnavailable: false }, true],
      [{ ...original, recordVersion: 9, mediaUnavailable: true }, true],
      [{ ...original, recordVersion: 8, mediaUnavailable: true, status: 0 }, true],
    ] as const) {
      expect(recordReeditProjectionSettled(item, committed)).toBe(settled)
      expect(projectRecordReedit(item, [committed]) === item).toBe(settled)
    }
    expect(recordReeditProjectionSettled({ ...original, itemUid: 'other', version: 8 }, committed)).toBe(false)
  })

  it('preserves only the independent voice, not a removed ordinary audio attachment', () => {
    const audio = (uid: string) => ({ kind: 'audio' as const, mediaRef: uid, fileAssetUid: uid, fileName: uid, mimeType: 'audio/mp3', size: 10, sortOrder: 0 })
    const item = { ...original, contentBlocks: [audio('voice'), audio('ordinary-audio')] }
    expect(projectRecordReedit(item, [{ ...pending, attachments: [], voiceFileAssetUid: 'voice' }]).contentBlocks).toEqual([audio('voice')])
  })

  it('keeps the unchanged main voice while the committed version has only partially resolved media', () => {
    const voice = { kind: 'audio' as const, mediaRef: 'voice-ref', fileAssetUid: 'voice',
      fileName: 'voice.m4a', mimeType: 'audio/mp4', size: 10, sortOrder: 0 }
    const item = { ...original, templateKind: 4, contentBlocks: [voice] }
    const committed = { ...pending, state: 'committed' as const, voiceFileAssetUid: 'voice', voiceBlock: voice,
      result: { status: 'committed' as const, itemUid: 'r', version: 8, revisionUid: 'revision', projectionState: 'pending' as const } }
    const assets = (value: ArkmeTimelineItem) => value.contentBlocks?.map(block => block.fileAssetUid ?? block.localFileRef)

    expect(assets(projectRecordReedit(item, [committed]))).toEqual(['voice', 'local'])
    const partial = { ...item, recordVersion: 8, mediaUnavailable: true, contentBlocks: [] }
    expect(recordReeditProjectionSettled(partial, committed)).toBe(false)
    expect(assets(projectRecordReedit(partial, [committed]))).toEqual(['voice', 'local'])
    const newer = { ...partial, recordVersion: 9 }
    expect(projectRecordReedit(newer, [committed])).toBe(newer)
    const deleted = { ...partial, status: 0 }
    expect(projectRecordReedit(deleted, [committed])).toBe(deleted)
  })

  it('prefers current main voice media and never substitutes another attachment or claims missing media is complete', () => {
    const voice = { kind: 'audio' as const, mediaRef: 'current', fileAssetUid: 'voice', fileName: 'voice.m4a', mimeType: 'audio/mp4', size: 10, sortOrder: 0 }
    const job = { ...pending, attachments: [], voiceFileAssetUid: 'voice', voiceBlock: { ...voice, mediaRef: 'cached' } }
    expect(projectRecordReedit({ ...original, contentBlocks: [voice] }, [job]).contentBlocks).toEqual([voice])
    for (const voiceBlock of [undefined, { ...voice, fileAssetUid: 'other' }, { ...voice, kind: 'image' as const }]) {
      const projected = projectRecordReedit({ ...original, contentBlocks: [] }, [{ ...job, voiceBlock }])
      expect(projected.contentBlocks).toEqual([])
      expect(projected.mediaUnavailable).toBe(true)
    }
    expect(projectRecordReedit(original, [{ ...job, voiceFileAssetUid: undefined }]).contentBlocks).toEqual([])
  })

  it('refreshes only selected remote media while preserving candidate order, removals and staged files', () => {
    const block = (uid: string) => ({ kind: 'file' as const, fileAssetUid: uid, mediaRef: `fresh-${uid}`,
      fileName: `${uid}.pdf`, mimeType: 'application/pdf', size: 10, sortOrder: 99 })
    const attachment = (uid: string) => ({ selection: { fileAssetUid: uid },
      asset: { fileAssetUid: uid, fileName: `${uid}.pdf`, mimeType: 'application/pdf', size: 10, fileKind: 4 as const },
      block: { ...block(uid), mediaRef: `cached-${uid}` } })
    const item = { ...original, contentBlocks: [block('removed'), block('a'), block('b'), block('local')] }
    const job = { ...pending, attachments: [attachment('b'), ...pending.attachments, attachment('a'), attachment('missing')] }
    expect(projectRecordReedit(item, [job]).contentBlocks?.map(value => [value.mediaRef, value.localFileRef, value.sortOrder]))
      .toEqual([
        ['fresh-b', undefined, 0], ['local', 'local', 1], ['fresh-a', undefined, 2], ['cached-missing', undefined, 3],
      ])
    expect(projectRecordReedit(item, [{ ...job, attachments: [] }]).contentBlocks).toEqual([])
  })
})
