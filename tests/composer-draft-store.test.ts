import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeUploadedAsset } from '../src/types.js'
import {
  ArkmeComposerDraftStore,
  reconcileArkmeComposerMentions, insertArkmeComposerMentionToken,
  ARKME_COMPOSER_EMOJI_PLACEHOLDER,
  arkmeComposerCanSend,
  arkmeComposerAtomicDeletion,
  arkmeArkoComposerDraftKey,
  arkmeSourceComposerDraftKey,
  releaseArkmeComposerDraft,
  serializeArkmeComposerDraft,
  type ArkmeComposerAttachment,
} from '../src/client/composer-draft-store.js'
import { arkmeMentionTextRuns } from '../src/client/ArkmeMentionTextarea.js'
import { arkmeDefaultEmojis } from '../src/client/arkme-emoji.js'

function attachment(uid: string, previewUrl?: string): ArkmeComposerAttachment {
  return {
    asset: { fileAssetUid: uid, fileName: `${uid}.png`, mimeType: 'image/png', size: 10 } as ArkmeUploadedAsset,
    ...(previewUrl === undefined ? {} : { previewUrl }),
  }
}

describe('Arkme composer draft store', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('preserves source-range identities when re-editing escaped Markdown mentions', () => {
    const mentions = [{ originalIndex: 0, displayName: 'A_B', startIndex: 0, length: 5 }]
    expect(reconcileArkmeComposerMentions(String.raw`@A\_B`, String.raw`前 @A\_B`, mentions, 'markdown'))
      .toEqual([{ ...mentions[0], startIndex: 2 }])
    const inserted = insertArkmeComposerMentionToken({ text: String.raw`@A\_B `, mentions, emojis: [] },
      { mentionRef: 'new' }, 'C_D', 6, 6, 'markdown')
    expect(inserted?.text).toBe(String.raw`@A\_B @C\_D `)
    expect(inserted?.mentions).toEqual([mentions[0], { mentionRef: 'new', displayName: 'C_D', startIndex: 6, length: 5 }])
  })

  it('removes mention identity when Markdown editing turns it into code', () => {
    const mentions = [{ originalIndex: 0, displayName: '小明', startIndex: 1, length: 3 }]
    expect(reconcileArkmeComposerMentions('`@小明', '`@小明`', mentions, 'markdown')).toEqual([])
  })

  it('allows keyboard submission when either text or an attachment is ready', () => {
    expect(arkmeComposerCanSend('文字', 0, false)).toBe(true)
    expect(arkmeComposerCanSend('', 1, false)).toBe(true)
    expect(arkmeComposerCanSend('   ', 0, false)).toBe(false)
    expect(arkmeComposerCanSend('文字', 1, true)).toBe(false)
  })

  it('builds stable, account/source isolated keys and rejects incomplete targets', () => {
    const a = arkmeSourceComposerDraftKey(1001, { kind: 'group_chat', sourceRef: 'group:8' })
    expect(a).toBe(arkmeSourceComposerDraftKey(1001, { kind: 'group_chat', sourceRef: 'group:8' }))
    expect(a).not.toBe(arkmeSourceComposerDraftKey(1002, { kind: 'group_chat', sourceRef: 'group:8' }))
    expect(a).not.toBe(arkmeSourceComposerDraftKey(1001, { kind: 'private_chat', sourceRef: 'group:8' }))
    expect(arkmeArkoComposerDraftKey(1001)).not.toBe(a)
    expect(arkmeSourceComposerDraftKey(undefined, { kind: 'group_chat', sourceRef: 'group:8' })).toBeUndefined()
    expect(arkmeSourceComposerDraftKey(1001, undefined)).toBeUndefined()
    expect(arkmeSourceComposerDraftKey(1001, {
      kind: 'group_chat', sourceRef: 'group:before-activity', sourceKey: 'chat:stable-group',
    })).toBe(arkmeSourceComposerDraftKey(1001, {
      kind: 'group_chat', sourceRef: 'group:after-activity', sourceKey: 'chat:stable-group',
    }))
  })

  it('keeps text and attachments isolated while switching draft keys', () => {
    const store = new ArkmeComposerDraftStore()
    const a = arkmeSourceComposerDraftKey(1001, { kind: 'group_chat', sourceRef: 'a' })
    const b = arkmeSourceComposerDraftKey(1001, { kind: 'group_chat', sourceRef: 'b' })
    store.setText(a, '会话 A')
    store.appendAttachments(a, [attachment('asset-a')])
    store.setText(b, '会话 B')

    expect(store.get(a)).toMatchObject({ text: '会话 A', attachments: [{ asset: { fileAssetUid: 'asset-a' } }] })
    expect(store.get(b)).toMatchObject({ text: '会话 B', attachments: [] })
  })

  it('writes a delayed attachment result to the key captured before conversation switching', async () => {
    const store = new ArkmeComposerDraftStore()
    const a = arkmeSourceComposerDraftKey(1001, { kind: 'group_chat', sourceRef: 'a' })
    const b = arkmeSourceComposerDraftKey(1001, { kind: 'group_chat', sourceRef: 'b' })
    const uploadTargetKey = a
    let selectedKey = a
    const uploaded = Promise.resolve(attachment('delayed-a'))
    selectedKey = b

    store.appendAttachments(uploadTargetKey, [await uploaded])

    expect(selectedKey).toBe(b)
    expect(store.get(a).attachments.map(item => item.asset.fileAssetUid)).toEqual(['delayed-a'])
    expect(store.get(b).attachments).toEqual([])
  })

  it('deduplicates and caps attachments while releasing rejected previews', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const store = new ArkmeComposerDraftStore()
    const key = arkmeArkoComposerDraftKey(1001)
    store.appendAttachments(key, [attachment('a', 'blob:a')], 1)
    store.appendAttachments(key, [attachment('a', 'blob:duplicate'), attachment('b', 'blob:overflow')], 1)

    expect(store.get(key).attachments.map(item => item.asset.fileAssetUid)).toEqual(['a'])
    expect(revoke).toHaveBeenCalledWith('blob:duplicate')
    expect(revoke).toHaveBeenCalledWith('blob:overflow')
  })

  it('takes only one draft and restores it without deleting newer input', () => {
    const store = new ArkmeComposerDraftStore()
    const a = arkmeArkoComposerDraftKey(1001)
    const b = arkmeArkoComposerDraftKey(2002)
    store.setText(a, '待发送')
    store.setText(b, '另一个账号')
    const pending = store.take(a)
    store.setText(a, '发送后的新输入')
    store.restore(a, pending)

    expect(store.get(a).text).toBe('发送后的新输入')
    expect(store.get(b).text).toBe('另一个账号')
  })

  it('retains the same submission identity when an unchanged draft is restored after a failed extension send', () => {
    const ids = [
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444',
    ]
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => ids.shift()) })
    const store = new ArkmeComposerDraftStore()
    const key = arkmeSourceComposerDraftKey(1001, { kind: 'private_chat', sourceRef: 'source-a' })!
    store.setText(key, '待延展内容')
    const first = store.beginFileSend(key)
    const pending = store.take(key)
    store.restore(key, pending)

    expect(store.beginFileSend(key)).toEqual(first)
    store.setText(key, '内容已修改')
    expect(store.beginFileSend(key)).not.toEqual(first)
  })

  it('does not reuse a submission identity across extension targets or normal sends', () => {
    const ids = [
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666',
    ]
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => ids.shift()) })
    const store = new ArkmeComposerDraftStore()
    const key = arkmeSourceComposerDraftKey(1001, { kind: 'private_chat', sourceRef: 'source-a' })!
    store.setText(key, '同一份草稿')
    const targetA = store.beginFileSend(key, 'extension:source-a:action-a')
    expect(store.beginFileSend(key, 'extension:source-a:action-b')).not.toEqual(targetA)
    expect(store.beginFileSend(key)).not.toEqual(targetA)
  })

  it('removes an attachment idempotently and releases its preview exactly once', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const store = new ArkmeComposerDraftStore()
    const key = arkmeArkoComposerDraftKey(1001)
    store.setText(key, '保留文字')
    store.appendAttachments(key, [attachment('remove-me', 'blob:remove-me')])

    store.removeAttachment(key, 'remove-me')
    store.removeAttachment(key, 'remove-me')

    expect(store.get(key)).toMatchObject({ text: '保留文字', attachments: [] })
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('clears exactly one account and releases each stored preview once', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const store = new ArkmeComposerDraftStore()
    const a = arkmeSourceComposerDraftKey(1001, { kind: 'group_chat', sourceRef: 'a' })
    const arkoA = arkmeArkoComposerDraftKey(1001)
    const b = arkmeSourceComposerDraftKey(2002, { kind: 'group_chat', sourceRef: 'b' })
    store.appendAttachments(a, [attachment('a', 'blob:a')])
    store.setText(arkoA, 'Arko A')
    store.setText(b, '账号 B')
    store.clearAccount(1001)
    store.clearAccount(1001)

    expect(store.get(a)).toMatchObject({ text: '', attachments: [] })
    expect(store.get(arkoA).text).toBe('')
    expect(store.get(b).text).toBe('账号 B')
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('releases detached send snapshots explicitly after success', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const store = new ArkmeComposerDraftStore()
    const key = arkmeArkoComposerDraftKey(1001)
    store.appendAttachments(key, [attachment('sent', 'blob:sent')])
    const pending = store.take(key)
    releaseArkmeComposerDraft(pending)
    expect(revoke).toHaveBeenCalledOnce()
  })

  it('inserts an opaque member mention at the current selection and tracks later text shifts', () => {
    const store = new ArkmeComposerDraftStore()
    const key = arkmeSourceComposerDraftKey(1001, { kind: 'group_chat', sourceRef: 'group:8' })
    store.setText(key, '请处理')

    expect(store.insertMention(key, 'mention-ref', '小林', 1, 1)).toBe(5)
    expect(store.get(key)).toMatchObject({
      text: '请@小林 处理',
      mentions: [{ mentionRef: 'mention-ref', displayName: '小林', startIndex: 1, length: 3 }],
    })

    store.setText(key, `好的，${store.get(key).text}`)
    expect(store.get(key).mentions).toEqual([
      { mentionRef: 'mention-ref', displayName: '小林', startIndex: 4, length: 3 },
    ])
  })

  it('uses explicit selection ranges to preserve distinct adjacent emoji when replacing any subset', () => {
    const choices = arkmeDefaultEmojis.slice(0, 3)
    for (let start = 0; start <= choices.length; start++) {
      for (let end = start; end <= choices.length; end++) {
        const store = new ArkmeComposerDraftStore()
        const key = arkmeArkoComposerDraftKey(1001)
        store.setRichText(key, '\uFFFC'.repeat(choices.length), choices.map((item, startIndex) => ({ emojiId: item.id, startIndex })))
        store.insertEmoji(key, arkmeDefaultEmojis[3]!, start, end)
        expect(serializeArkmeComposerDraft(store.get(key)).text).toBe([
          ...choices.slice(0, start), arkmeDefaultEmojis[3]!, ...choices.slice(end),
        ].map(item => item.token).join(''))
      }
    }
  })

  it('stores rich emoji as an inline object and serializes desktop tokens with shifted mentions', () => {
    const store = new ArkmeComposerDraftStore()
    const key = arkmeSourceComposerDraftKey(1001, { kind: 'group_chat', sourceRef: 'group:8' })
    store.setText(key, '请处理')
    expect(store.insertEmoji(key, arkmeDefaultEmojis[0]!, 1)).toBe(2)
    expect(store.insertMention(key, 'mention-ref', '小林', 2)).toBe(6)

    const snapshot = store.get(key)
    expect(snapshot.text).toBe(`请${ARKME_COMPOSER_EMOJI_PLACEHOLDER}@小林 处理`)
    expect(snapshot.emojis).toEqual([{ emojiId: 'angry_face', startIndex: 1 }])
    expect(serializeArkmeComposerDraft(snapshot)).toEqual({
      text: '请[jm_emoji:angry_face]@小林 处理',
      mentions: [{
        mentionRef: 'mention-ref',
        displayName: '小林',
        startIndex: 1 + '[jm_emoji:angry_face]'.length,
        length: 3,
      }],
    })
  })

  it('preserves untouched chat mentions and removes their metadata when emoji insertion edits the label', () => {
    for (const [start, end, intact] of [[0, 0, true], [2, 2, false], [1, 4, false], [4, 4, true]] as const) {
      const store = new ArkmeComposerDraftStore()
      const key = arkmeSourceComposerDraftKey(1001, { kind: 'group_chat', sourceRef: 'group:8' })
      store.setText(key, '前后')
      store.insertMention(key, 'mention-ref', '小林', 1)
      const original = store.get(key).text
      const chosen = arkmeDefaultEmojis[0]!
      store.insertEmoji(key, chosen, start, end)
      const sent = serializeArkmeComposerDraft(store.get(key))
      expect(sent.text).toBe(original.slice(0, start) + chosen.token + original.slice(end))
      expect(sent.mentions).toEqual(intact ? [{ mentionRef: 'mention-ref', displayName: '小林', startIndex: sent.text.indexOf('@小林'), length: 3 }] : [])
    }
  })

  it('drops mention metadata when the visible mention token is edited', () => {
    const store = new ArkmeComposerDraftStore()
    const key = arkmeSourceComposerDraftKey(1001, { kind: 'group_chat', sourceRef: 'group:8' })
    store.insertMention(key, 'mention-ref', '小林', 0)
    store.setText(key, '@小李 ')
    expect(store.get(key).mentions).toEqual([])
  })

  it('inserts @所有人 as an atomic all mention without a member reference', () => {
    const store = new ArkmeComposerDraftStore()
    const key = arkmeSourceComposerDraftKey(1001, { kind: 'group_chat', sourceRef: 'group:8' })
    store.setText(key, '提醒开会')

    expect(store.insertAllMention(key, 0)).toBe(5)
    expect(store.get(key)).toMatchObject({
      text: '@所有人 提醒开会',
      mentions: [{ all: true, displayName: '所有人', startIndex: 0, length: 4 }],
    })
    expect(store.deleteMentionAtSelection(key, 4, 4, 'backward')).toBe(0)
    expect(store.get(key)).toMatchObject({ text: '提醒开会', mentions: [] })
  })

  it('inserts a Bot mention with its opaque Bot reference and text range', () => {
    const store = new ArkmeComposerDraftStore()
    const key = arkmeSourceComposerDraftKey(1001, { kind: 'private_chat', sourceRef: 'chat:bot' })
    store.setText(key, '帮我总结')

    expect(store.insertBotMention(key, 'bot-ref', '总结助手', 0)).toBe(6)
    expect(store.get(key)).toMatchObject({
      text: '@总结助手 帮我总结',
      mentions: [{ botRef: 'bot-ref', displayName: '总结助手', startIndex: 0, length: 5 }],
    })
  })

  it('renders structured mention ranges as blue-ready runs without guessing plain @ text', () => {
    const mentions = [{ mentionRef: 'mention-ref', displayName: '小林', startIndex: 1, length: 3 }]
    expect(arkmeMentionTextRuns('请@小林 处理 @普通文字', mentions)).toEqual([
      { kind: 'text', text: '请' },
      { kind: 'mention', text: '@小林' },
      { kind: 'text', text: ' 处理 @普通文字' },
    ])
  })

  it('deletes a mention and its separator atomically with Backspace', () => {
    const text = '请@小林 处理'
    const mentions = [{ mentionRef: 'mention-ref', displayName: '小林', startIndex: 1, length: 3 }]
    expect(arkmeComposerAtomicDeletion(text, mentions, 5, 5, 'backward')).toEqual({
      text: '请处理',
      caretIndex: 1,
    })
  })

  it('expands forward and range deletion to the whole mention while preserving adjacent text', () => {
    const text = '前@小林 后@阿周 尾'
    const mentions = [
      { mentionRef: 'mention-a', displayName: '小林', startIndex: 1, length: 3 },
      { mentionRef: 'mention-b', displayName: '阿周', startIndex: 6, length: 3 },
    ]
    expect(arkmeComposerAtomicDeletion(text, mentions, 1, 1, 'forward')).toEqual({ text: '前后@阿周 尾', caretIndex: 1 })
    expect(arkmeComposerAtomicDeletion(text, mentions, 2, 8, 'backward')).toEqual({ text: '前尾', caretIndex: 1 })
  })

  it('keeps the caret stable after the store removes a selected mention', () => {
    const store = new ArkmeComposerDraftStore()
    const key = arkmeSourceComposerDraftKey(1001, { kind: 'group_chat', sourceRef: 'group:8' })
    store.setText(key, '前后')
    store.insertMention(key, 'mention-ref', '小林', 1)

    expect(store.deleteMentionAtSelection(key, 5, 5, 'backward')).toBe(1)
    expect(store.get(key)).toMatchObject({ text: '前后', mentions: [] })
  })
})
