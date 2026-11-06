import { describe, expect, it } from 'vitest'
import { ArkmeComposerDraftStore, serializeArkmeComposerDraft } from '../src/client/composer-draft-store.js'
import { prepareRunnerDecisionDraft } from '../src/client/runner-decision-draft.js'
import type { ArkmeTimelineItem, ArkmeGroupBotCandidate } from '../src/types.js'

const item: ArkmeTimelineItem = { itemUid: 'question', messageActionRef: 'opaque-action', senderKind: 'bot', senderBotDirectoryKey: 'original-bot', senderName: '旧管家名称', isMe: false, sendAtMillis: 1, title: '', textContent: '请确认', status: 0 }
const bot: ArkmeGroupBotCandidate = { botRef: 'account-bound-bot', directoryKey: 'original-bot', name: '新管家名称', installed: true, description: '' }
const answer = '同意'
describe('Runner decision composer', () => {
  it('normal extension mentions its exact Bot without replacing text, attachments or quote', () => {
    const store = new ArkmeComposerDraftStore()
    store.setText('group', '这是补充，不是另一项任务')
    store.setExtensionTarget('group', item)
    expect(store.mentionExtensionBot('group', [bot, { ...bot, directoryKey: 'other', botRef: 'other' }])).toBe(true)
    expect(store.mentionExtensionBot('group', [bot])).toBe(true)
    const draft = store.get('group')
    expect(draft.text).toBe('@新管家名称 这是补充，不是另一项任务')
    expect(draft.mentions).toHaveLength(1)
    expect(draft.extensionTarget?.item.itemUid).toBe(item.itemUid)
    expect(store.get('other-group').text).toBe('')
  })
  it('normal extension cannot infer an unbound or ambiguous Bot from its name', () => {
    for (const bots of [[], [{ ...bot, installed: false }], [bot, bot]]) {
      const store = new ArkmeComposerDraftStore()
      store.setText('group', '保留草稿')
      store.setExtensionTarget('group', item)
      expect(store.mentionExtensionBot('group', bots)).toBe(false)
      expect(store.get('group').text).toBe('保留草稿')
    }
  })
  it('serializes a structured mention of the original Bot and a correlated quoted reply', () => {
    const store = new ArkmeComposerDraftStore()
    prepareRunnerDecisionDraft(store, 'group', item, answer, [bot, { ...bot, directoryKey: 'other', botRef: 'other' }])
    const draft = store.get('group'), serialized = serializeArkmeComposerDraft(draft)
    expect(draft.extensionTarget?.item.itemUid).toBe('question')
    expect(serialized.text).toBe(`@新管家名称 ${answer}`)
    expect(serialized.mentions).toEqual([{ botRef: bot.botRef, displayName: bot.name, startIndex: 0, length: 6 }])
    expect(store.get('other-group').text).toBe('')
  })
  it('does not guess a Bot by display name or use a removed/foreign identity', () => {
    for (const bots of [[], [{ ...bot, installed: false }], [{ ...bot, directoryKey: 'foreign' }]]) {
      const store = new ArkmeComposerDraftStore()
      expect(() => prepareRunnerDecisionDraft(store, 'group', item, answer, bots)).toThrow('无法确认')
      expect(store.get('group').extensionTarget).toBeUndefined()
      expect(store.get('group').text).toBe('')
    }
  })
  it('preserves an existing draft or a different quote without overwriting it', () => {
    const store = new ArkmeComposerDraftStore()
    store.setText('group', '正在编辑')
    expect(() => prepareRunnerDecisionDraft(store, 'group', item, answer, [bot])).toThrow('当前草稿')
    expect(store.get('group').text).toBe('正在编辑')
    store.setText('group', '')
    store.setExtensionTarget('group', { ...item, itemUid: 'another-question' })
    expect(() => prepareRunnerDecisionDraft(store, 'group', item, answer, [bot])).toThrow('当前草稿')
    expect(store.get('group').extensionTarget?.item.itemUid).toBe('another-question')
  })
})
