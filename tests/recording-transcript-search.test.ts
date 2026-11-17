import { describe, expect, it } from 'vitest'
import { findRecordingTranscriptMatches, recordingTranscriptSearchHits } from '../src/client/recordings/recording-transcript-search.js'
import type { ArkmeRecordingWorkbenchItem } from '../src/types.js'

describe('loaded recording transcript search', () => {
  it('locates each non-overlapping occurrence with Unicode code-point offsets', () => {
    expect(findRecordingTranscriptMatches([{ itemId: 'a', text: '😀开始开始' }], '开始')).toEqual([
      { itemId: 'a', start: 1, length: 2 }, { itemId: 'a', start: 3, length: 2 },
    ])
  })
  it('matches same-length Chinese homophones without enabling one-character or Latin phonetic search', () => {
    const items = [{ itemId: 'a', text: '会议记路' }]
    expect(findRecordingTranscriptMatches(items, '记录')).toEqual([{ itemId: 'a', start: 2, length: 2 }])
    expect(findRecordingTranscriptMatches(items, '录')).toEqual([])
    expect(findRecordingTranscriptMatches(items, 'jilu')).toEqual([])
  })
  it('preserves paragraph boundaries, literal case and unique paragraph identities', () => {
    const items = [{ itemId: 'a', text: '测试A' }, { itemId: 'b', text: 'BC' }, { itemId: 'a', text: '测试A' }]
    expect(findRecordingTranscriptMatches(items, 'ABC')).toEqual([])
    expect(findRecordingTranscriptMatches(items, 'a')).toEqual([])
    expect(findRecordingTranscriptMatches(items, ' 测试 ')).toHaveLength(1)
    expect(findRecordingTranscriptMatches(items, ' ')).toEqual([])
  })

  it('uses the loaded personal text for real rows and keeps unloaded same-day hits addressable', () => {
    const items = [
      { itemId: 'a', searchIdentityHash: 'a-hash', startAtMillis: 100, text: '更正后的原句', textEndOffset: 6, textTotalLength: 6 },
      { itemId: 'b', searchIdentityHash: 'b-hash', startAtMillis: 300, text: '郭老师', textEndOffset: 3, textTotalLength: 3 },
    ] as ArkmeRecordingWorkbenchItem[]
    const candidates = [
      { identityHash: 'b-hash', startAtMillis: 300, snippet: '郭老师' },
      { identityHash: 'a-hash', startAtMillis: 100, snippet: '郭老师' },
      { identityHash: 'c-hash', startAtMillis: 200, snippet: '郭老师，郭老师' },
      { identityHash: 'other', startAtMillis: 50, snippet: '只在服务端模糊匹配' },
    ]
    const hits = recordingTranscriptSearchHits(items, findRecordingTranscriptMatches(items, '郭老师'), candidates, '郭老师')
    expect(hits.map(hit => hit.key)).toEqual(['c-hash:0', 'c-hash:1', 'b-hash:0'])
    expect(hits[2]?.matchIndex).toBe(0)
  })
})
