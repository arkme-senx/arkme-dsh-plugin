import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import { hydrateRecordReeditEditor, useRecordReeditEditors, type ArkmeRecordReeditComposerState } from '../src/client/record-reedit-editors.js'
import type { ArkmeRecordReeditEditorSnapshot } from '../src/record-reedit-contract.js'

const candidate = (itemUid = 'A', sourceKey = 'chat:one', accountKey = 'test:42'): ArkmeRecordReeditComposerState => ({
  generation: 1, accountKey, sourceKey, sourceRef: `capability:${sourceKey}`, snapshot: undefined,
  item: { itemUid, title: '', textContent: '', senderName: '我', isMe: true, sendAtMillis: 1, status: 1 },
  title: '', textContent: `${accountKey}:${sourceKey}:${itemUid}`, attachments: [],
  persisted: { candidateKey: '', draftRevision: 0, saveTail: Promise.resolve() }, loading: false, busy: false, error: '',
})

describe('record re-edit input owner', () => {
  let renderer: ReactTestRenderer | undefined
  let editors: ReturnType<typeof useRecordReeditEditors>
  const Fixture = () => { editors = useRecordReeditEditors(); return null }
  const mount = () => { act(() => { renderer = create(<Fixture />) }) }
  afterEach(() => { act(() => renderer?.unmount()) })

  it('keeps input identities separate and restores the selected record for each source', () => {
    mount()
    const a = candidate()
    const b = candidate('B')
    const other = candidate('A', 'chat:two')
    const account = candidate('A', 'chat:one', 'production:42')
    for (const value of [a, b, other, account]) act(() => editors.setComposer(value))
    for (const value of [a, b, other, account]) expect(editors.findCandidate(value, value.item.itemUid)).toBe(value)
    act(() => editors.activateScope(a, 9))
    expect(editors.composer).toMatchObject({ item: { itemUid: 'B' }, generation: 9 })
    expect(editors.composerRef.current).toBe(editors.composer)
    expect(editors.composer!.persisted).toBe(b.persisted)
    act(() => editors.activateScope(other, 10))
    expect(editors.composer!.textContent).toBe(other.textContent)
  })

  it('treats a renewed source capability as the same input identity', () => {
    mount()
    const a = candidate()
    act(() => editors.setComposer(a))
    const renewed = { ...a, sourceRef: 'renewed-capability' }
    expect(editors.findCandidate(renewed, a.item.itemUid)).toBe(a)
    act(() => editors.activateScope(renewed, 2))
    expect(editors.composer).toMatchObject({ textContent: a.textContent, sourceRef: a.sourceRef, generation: 2 })
  })

  it('settles an inactive candidate without selecting it or changing the current input', () => {
    mount()
    const a = candidate()
    const b = candidate('B')
    act(() => { editors.setComposer(a); editors.setComposer(b) })
    act(() => editors.updateCandidate(a, current => ({ ...current, error: 'A 保存失败' })))
    expect(editors.composer).toBe(b)
    expect(editors.findCandidate(a, 'A')!.error).toBe('A 保存失败')
    act(() => editors.updateCandidate(a, () => undefined))
    expect(editors.composer).toBe(b)
    expect(editors.findCandidate(a, 'A')).toBeUndefined()
  })

  it('does not reveal another retained candidate when the selected candidate finishes', () => {
    mount()
    const a = candidate()
    const b = candidate('B')
    act(() => { editors.setComposer(a); editors.setComposer(b) })
    act(() => editors.updateCandidate(b, () => undefined))
    expect(editors.composer).toBeUndefined()
    act(() => editors.activateScope(a, 3))
    expect(editors.composer).toBeUndefined()
    const retained = editors.findCandidate(a, 'A')!
    act(() => editors.setComposer({ ...retained, generation: 4 }))
    expect(editors.composer!.textContent).toBe(a.textContent)
  })

  it('ignores completion from a released session when the same record has a new candidate', () => {
    mount()
    const old = candidate()
    act(() => editors.setComposer(old))
    act(() => editors.setComposer(undefined))
    const next = { ...candidate(), generation: 2, textContent: '新的输入' }
    act(() => editors.setComposer(next))
    act(() => editors.updateCandidate(old, () => undefined))
    expect(editors.composer).toBe(next)
  })
  it('releases the input while keeping a failed submission recoverable without selecting it', () => {
    mount()
    const a = candidate()
    act(() => { editors.setComposer(a); editors.detachCandidate(a) })
    expect(editors.composer).toBeUndefined()
    expect(editors.findCandidate(a, 'A')).toBe(a)
    const next = candidate('B')
    act(() => editors.setComposer(next))
    act(() => editors.updateCandidate(a, current => ({ ...current, error: '保存失败' })))
    expect(editors.composer).toBe(next)
    act(() => editors.activateScope(a, 3))
    expect(editors.composer?.item.itemUid).toBe('B')
  })
})

describe('late re-edit hydration', () => {
  const snapshot: ArkmeRecordReeditEditorSnapshot = { sourceRef: 'source', itemUid: 'A', title: '', textContent: '原文',
    sendAtMillis: 1, templateKind: 1, displayKind: 0, version: 3, maxTextLength: 20000, preservesAttachments: false,
    attachments: [], hasVoice: false, maxAttachments: 9 }
  const initial = () => ({ ...candidate(), textContent: '原文', item: { ...candidate().item, textContent: '原文' }, loading: true })
  it('fills untouched input from a saved draft but never overwrites text typed while loading', () => {
    const detail = { ...snapshot, draft: { title: '', textContent: '旧草稿', baseVersion: 3, draftRevision: 2, updatedAtMillis: 1 } }
    const untouched = initial()
    expect(hydrateRecordReeditEditor(untouched, detail).textContent).toBe('旧草稿')
    const typed = { ...untouched, textContent: '刚输入的新文字' }
    const result = hydrateRecordReeditEditor(typed, detail)
    expect(result.textContent).toBe('刚输入的新文字')
    expect(result.loading).toBe(false)
    expect(result.persisted).toBe(untouched.persisted)
    expect(hydrateRecordReeditEditor(untouched, detail, true).textContent).toBe('原文')
  })
  it('retains original mentions through a quick edit and preserves changed mention boundaries', () => {
    const detail = { ...snapshot, textContent: '@小明 原文', mentions: [{ originalIndex: 0, displayName: '小明', startIndex: 0, length: 3 }] }
    const original = { ...initial(), item: { ...initial().item, textContent: detail.textContent } }
    const result = hydrateRecordReeditEditor({ ...original, textContent: '@小明 新内容' }, detail)
    expect(result.mentions).toEqual(detail.mentions)
    expect(hydrateRecordReeditEditor({ ...original, textContent: '@小红 新内容' }, detail).mentions).toEqual([])
  })
  it('keeps a changed remote baseline as a conflict instead of silently rebasing typed text', () => {
    const typed = { ...initial(), textContent: '本地修改' }
    expect(hydrateRecordReeditEditor(typed, { ...snapshot, textContent: '其他入口修改' })).toMatchObject({ textContent: '本地修改', conflict: 'record' })
    typed.persisted.expectedVersion = 2
    expect(hydrateRecordReeditEditor(typed, snapshot).conflict).toBe('record')
  })
})
