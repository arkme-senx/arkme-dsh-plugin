// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readArkoReplyPromptDrafts, saveArkoReplyPromptDraft, officialArkoReplyPrompt, arkoReplyPromptContent } from '../src/client/arko-reply-drafts.js'
beforeEach(() => localStorage.clear())
afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })
it('keeps prompt text and reference revisions per account and scene, and restores official content', () => {
  const one = saveArkoReplyPromptDraft('prod:1', 'record_auto', '我的快记提示词', 0)
  const two = saveArkoReplyPromptDraft('prod:1', 'direct_receive', '我的私聊提示词', one.revision)
  expect(readArkoReplyPromptDrafts('prod:1')).toEqual(two)
  expect(two.scenes.record_auto?.baseRevision).toBeTruthy()
  expect(arkoReplyPromptContent(two, 'record_auto')).toBe('我的快记提示词')
  expect(arkoReplyPromptContent(two, 'group_auto')).toBe(officialArkoReplyPrompt('group_auto'))
  expect(readArkoReplyPromptDrafts('prod:2').scenes).toEqual({})
  const reset = saveArkoReplyPromptDraft('prod:1', 'record_auto', null, two.revision)
  expect(reset.scenes.record_auto).toBeUndefined()
  expect(arkoReplyPromptContent(reset, 'record_auto')).toBe(officialArkoReplyPrompt('record_auto'))
  expect(reset.scenes.direct_receive?.content).toBe('我的私聊提示词')
})
it('rejects stale, blank, oversized and unavailable prompt writes without overwriting content', () => {
  saveArkoReplyPromptDraft('prod:1', 'record_auto', '已有内容', 0)
  expect(() => saveArkoReplyPromptDraft('prod:1', 'record_auto', '旧窗口', 0)).toThrow('其他窗口更新')
  expect(() => saveArkoReplyPromptDraft('prod:1', 'record_auto', ' ', 1)).toThrow('不能为空')
  expect(() => saveArkoReplyPromptDraft('prod:1', 'record_auto', '字'.repeat(20001), 1)).toThrow('20000')
  expect(() => saveArkoReplyPromptDraft('prod:1', 'arko_chat', '虚构默认内容', 1)).toThrow()
  expect(readArkoReplyPromptDrafts('prod:1').scenes.record_auto?.content).toBe('已有内容')
})
it('preserves previous style drafts and rejects unreadable prompt drafts without rewriting storage', () => {
  const legacyKey = 'arkme:arko-reply-drafts:v1:prod:1', legacy = '{"common":{"template":"warm","instruction":"旧偏好"}}'
  localStorage.setItem(legacyKey, legacy)
  expect(readArkoReplyPromptDrafts('prod:1').scenes).toEqual({})
  saveArkoReplyPromptDraft('prod:1', 'record_auto', '新提示词', 0)
  expect(localStorage.getItem(legacyKey)).toBe(legacy)
  const promptKey = 'arkme:arko-reply-prompt-drafts:v1:prod:1'
  localStorage.setItem(promptKey, '{broken')
  expect(() => readArkoReplyPromptDrafts('prod:1')).toThrow('无法读取')
  expect(() => saveArkoReplyPromptDraft('prod:1', 'record_auto', '覆盖', 0)).toThrow('无法读取')
  expect(localStorage.getItem(promptKey)).toBe('{broken')
})
it('does not report success when local storage refuses a write', () => {
  saveArkoReplyPromptDraft('prod:1', 'record_auto', '已有内容', 0)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
  expect(() => saveArkoReplyPromptDraft('prod:1', 'record_auto', '不能保存', 1)).toThrow('quota exceeded')
  expect(readArkoReplyPromptDrafts('prod:1').scenes.record_auto?.content).toBe('已有内容')
})
