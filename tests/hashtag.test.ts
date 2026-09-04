import { describe, expect, it } from 'vitest'
import {
  arkmeHashTagContentPayload,
  arkmeHashTagMatches,
  arkmeHashTagRanges,
  arkmeHashTagSearchKey,
  arkmeHashTagSearchQuery,
  arkmeHashTagTrigger,
  arkmeMergeHashTagSuggestions,
  arkmeReconcileHashTagSuggestionSnapshots,
} from '../src/hashtag.js'
import { arkmeComposerTextRuns } from '../src/client/ArkmeMentionTextarea.js'
import { ArkmeComposerDraftStore, arkmeSourceComposerDraftKey } from '../src/client/composer-draft-store.js'

describe('Flutter-compatible hashtags', () => {
  it('recognizes half/full-width anchors and the Flutter punctuation terminators', () => {
    const text = '开会#项目，下一项 ＃待办!尾部#版本🚀'
    expect(arkmeHashTagRanges(text)).toEqual([
      { tag: '项目', startIndex: text.indexOf('#项目'), length: '#项目'.length },
      { tag: '待办', startIndex: text.indexOf('＃待办'), length: '＃待办'.length },
      { tag: '版本🚀', startIndex: text.indexOf('#版本🚀'), length: '#版本🚀'.length },
    ])
  })

  it('opens immediately for a bare anchor and closes after whitespace or punctuation', () => {
    expect(arkmeHashTagTrigger('#', 1)).toEqual({ startIndex: 0, endIndex: 1, query: '' })
    expect(arkmeHashTagTrigger('前缀＃项', 4)).toEqual({ startIndex: 2, endIndex: 4, query: '项' })
    expect(arkmeHashTagTrigger('#项目 ', 4)).toBeUndefined()
    expect(arkmeHashTagTrigger('#项目，', 4)).toBeUndefined()
    expect(arkmeHashTagTrigger('#项目', 1, 2)).toBeUndefined()
  })

  it('filters candidates by case-insensitive containment', () => {
    expect(arkmeHashTagMatches('ProjectAlpha', 'alpha')).toBe(true)
    expect(arkmeHashTagMatches('ProjectAlpha', 'beta')).toBe(false)
  })

  it('normalizes half/full-width rendered tags for exact search', () => {
    expect(arkmeHashTagSearchQuery('＃项目')).toBe('#项目')
    expect(arkmeHashTagSearchKey(' #项目 ')).toBe('项目')
    expect(arkmeHashTagSearchKey('项目')).toBeUndefined()
    expect(arkmeHashTagSearchQuery('#')).toBeUndefined()
  })

  it('rebuilds one candidate snapshot from the remote projection and current records', () => {
    expect(arkmeMergeHashTagSuggestions([{
      normalizedTag: 'project', tagText: 'Project', recordCount: 2,
      latestRecordUid: 'remote-record', latestSendAtMillis: 10,
    }], [{
      itemUid: 'local-record', textContent: '#project #新标签', sendAtMillis: 20,
    }])).toEqual([{
      normalizedTag: 'project', tagText: 'Project', recordCount: 3,
      latestRecordUid: 'local-record', latestSendAtMillis: 20,
    }, {
      normalizedTag: '新标签', tagText: '新标签', recordCount: 1,
      latestRecordUid: 'local-record', latestSendAtMillis: 20,
    }])
  })

  it('keeps an account-local candidate while the remote projection is pending without double counting', () => {
    const pending = [{
      normalizedTag: 'new', tagText: 'New', recordCount: 1,
      latestRecordUid: 'local-record', latestSendAtMillis: 20,
    }]
    expect(arkmeReconcileHashTagSuggestionSnapshots([], pending)).toEqual(pending)
    expect(arkmeReconcileHashTagSuggestionSnapshots([{
      normalizedTag: 'new', tagText: 'New', recordCount: 1,
      latestRecordUid: 'remote-record', latestSendAtMillis: 10,
    }], pending)).toEqual(pending)
  })

  it('rebuilds pasted hashtag spans from plain text without clipboard metadata', () => {
    expect(arkmeComposerTextRuns('粘贴 #项目，继续 ＃待办', [], [])).toEqual([
      { kind: 'text', text: '粘贴 ' },
      { kind: 'tag', text: '#项目' },
      { kind: 'text', text: '，继续 ' },
      { kind: 'tag', text: '＃待办' },
    ])
    expect(arkmeComposerTextRuns('#', [], [], 0)).toEqual([{ kind: 'tag', text: '#' }])
    expect(arkmeComposerTextRuns('# ', [], [])).toEqual([{ kind: 'text', text: '# ' }])
  })

  it('replaces the active fragment with an ASCII tag and trailing space', () => {
    const store = new ArkmeComposerDraftStore()
    const key = arkmeSourceComposerDraftKey(42, { kind: 'topic', sourceRef: 'topic:1' })!
    store.setText(key, '今天处理＃项后续')
    expect(store.insertHashTag(key, '项目', 4, 6)).toBe(8)
    expect(store.get(key).text).toBe('今天处理#项目 后续')
  })

  it('creates UTF-16 hash_tags evidence for sending', () => {
    expect(arkmeHashTagContentPayload('🚀 #项目，#版本2')).toEqual({
      payload_kind: 1,
      schema_version: 1,
      text_state: 1,
      hash_tags: [
        { tag: '项目', start_index: 3, length: 3 },
        { tag: '版本2', start_index: 7, length: 4 },
      ],
    })
  })
})
