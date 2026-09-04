import { describe, expect, it } from 'vitest'
import { findRecordingTranscriptMatches } from '../src/client/recordings/recording-transcript-search.js'

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
})
