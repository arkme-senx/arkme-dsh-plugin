// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { nativeDictationTarget } from '../src/client/HarnessDictationInput.js'
it('uses the public native insertion seam to revise only its own range, guarded by draft revision', () => {
  let draft = '前文后文', revision = 1
  const actions = {
    captureInsertion: () => ({ start: 2, end: 2, draftRev: revision }),
    insertText: vi.fn((text, span) => {
      if (span.draftRev !== revision) return false
      draft = draft.slice(0, span.start) + text + draft.slice(span.end); revision++; return true
    }), persistDraft: vi.fn(),
  }
  const target = nativeDictationTarget(actions, () => true)
  expect(target.replace('你')).toBe(true); expect(target.replace('你好！')).toBe(true)
  expect(draft).toBe('前文你好！后文'); expect(actions.persistDraft).toHaveBeenCalledTimes(2)
  draft += '手动修改'; revision++
  expect(target.replace('旧响应')).toBe(false); expect(draft).toBe('前文你好！后文手动修改')
  target.close(); expect(target.replace('过期')).toBe(false)
})
