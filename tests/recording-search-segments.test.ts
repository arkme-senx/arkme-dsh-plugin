import {parseRecordingSearchItem} from '../src/recording-search-result.js'
import { describe, expect, it, vi } from 'vitest'
import { SearchService } from '../src/services/search-service.js'
import { recordingSearchVersion, recordingSearchIdentityHash } from '../src/recording-search-version.js'
import { resolveRecordingSearchTarget } from '../src/client/recordings/recording-search-target.js'
const segment = { session_id: 's', child_id: 'c', item_index: 0, transcript_source: 'system', transcript_version: 'v', start_at: 1000, end_at: 2000, text: ' 😀内容'.repeat(400), speaker: { speaker_id: 'sp', label: '张三' } }
describe('recording segment search', () => {
  it('requests segments, preserves full text, neighbors and rune ranges', async () => {
    const post = vi.fn(async () => ({items: [{session_id: 's', date_stamp: 0, match: segment, previous: {...segment, item_index: 1}, snippet: segment.text, highlight_ranges: [{start_index: 1, length: 1}]}]}))
    const service = new SearchService({ requireSession: async () => ({userId: 42}), authenticatedPost: post } as never, {} as never, {} as never)
    const result = await service.searchRecordings({query: '内容', limit: 30})
    expect(post.mock.calls[0]?.[1]).toMatchObject({result_mode:'segments'})
    expect(result.items[0]).toMatchObject({snippet: segment.text, match: {childId:'c', itemIndex:0, text:segment.text, speaker:{label:'张三'}}, previous:{itemIndex:1}, highlightRanges:[{start:1,length:1}]})
  })
  it('rejects old summary-only responses rather than quietly rendering an inaccurate hit', async () => {
    const service = new SearchService({ requireSession: async () => ({userId: 42}), authenticatedPost: async () => ({items:[{session_id:'s', snippet:'old summary'}]}) } as never, {} as never, {} as never)
    await expect(service.searchRecordings({query:'内容',limit:30})).rejects.toThrow()
  })
  it('hydrates each distinct speaker through the existing profile cache, without borrowing the creator avatar', async () => {
    const publicProfileSummariesByUserIds = vi.fn(async () => new Map([[7,{displayName:'公开姓名',nickname:'昵称',avatarUrl:'https://avatar'}]]))
    const sealProfileImageRef = vi.fn(async () => 'opaque-profile-ref')
    const runtime = {requireSession:async()=>({userId:42}),authenticatedPost:async()=>({items:[{session_id:'s',match:{...segment,speaker:{speaker_id:'sp',user_id:7,label:'手工说话人'}},previous:{...segment,item_index:1,speaker:{speaker_id:'unknown',label:'未知说话人'}},next:{...segment,item_index:2,speaker:{speaker_id:'sp',user_id:7,label:'手工说话人'}}}]})}
    const service = new SearchService(runtime as never,{} as never,{} as never,undefined,undefined,{publicProfileSummariesByUserIds,sealProfileImageRef} as never)
    const result = await service.searchRecordings({query:'内容',limit:30})
    expect(publicProfileSummariesByUserIds).toHaveBeenCalledExactlyOnceWith([7],{userId:42},undefined)
    expect(sealProfileImageRef).toHaveBeenCalledExactlyOnceWith(42,7)
    expect(result.items[0]?.match.speaker).toMatchObject({label:'手工说话人',avatarRef:'opaque-profile-ref'})
    expect(result.items[0]?.next?.speaker?.avatarRef).toBe('opaque-profile-ref')
    expect(result.items[0]?.previous?.speaker?.avatarRef).toBeUndefined()
  })
  it('matches the shared hash including whitespace, astral characters and source', () => {
    expect(recordingSearchVersion({sessionId:'s',childId:'c',asrItemIndex:0,transcriptSource:'system',startAtMillis:1000,endAtMillis:2000,text:' 😀内容 '})).toBe('5c97dcdf1ef544e4890034c535538c0846ecaf97739cc8db537f91cb54ba4628')
  })
  it('locates exact identity/version and never falls back to an overlapping timestamp', async () => {
    const target = {dateStamp:0,startAtMillis:1000,sessionId:'s',childId:'c',itemIndex:0,transcriptSource:'system',transcriptVersion:'v'} as const
    const item = {itemId:'i',startAtMillis:1000,endAtMillis:2000,transcriptSource:'system',searchIdentityHash:recordingSearchIdentityHash(target),searchVersion:target.transcriptVersion} as never
    expect((await resolveRecordingSearchTarget([item],target))?.itemId).toBe('i')
    expect(await resolveRecordingSearchTarget([item],{...target,transcriptVersion:'changed'})).toBeUndefined()
    expect(await resolveRecordingSearchTarget([item],{...target,sessionId:'other'})).toBeUndefined()
  })
})

it('accepts same-day neighbours from other recordings while retaining match navigation identity', () => {
  const raw = {session_id:'s', date_stamp:1, match:segment, previous:{...segment,session_id:'prev',start_at:900},next:{...segment,session_id:'next',start_at:2100,end_at:2200}}
  const item=parseRecordingSearchItem(raw)
  expect(item.sessionId).toBe('s')
  expect(item.previous?.sessionId).toBe('prev')
  expect(item.next?.sessionId).toBe('next')
  expect(()=>parseRecordingSearchItem({...raw,next:{...raw.next,start_at:86_400_001,end_at:86_400_002}})).toThrow()
  expect(()=>parseRecordingSearchItem({...raw,next:{...raw.next,transcript_source:'doubao'}})).toThrow()
})
