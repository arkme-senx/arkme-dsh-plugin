import { beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeSearchRecordItem } from '../src/types.js'
import { longArticleSearchTimelineItem, resolveLongArticleSource } from '../src/client/long-article-search-item.js'
const mocks=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
const row={recordUid:'same-uid',recordOwnerUserId:7,sourceKind:3,routeTargetKind:'source',sendAtMillis:1,title:'共享长文',snippet:'',textContent:'**正文**',textFormat:'markdown',templateKind:2,displayKind:1,media:[],files:[],targetSource:{kind:'group_chat',sourceRef:'signed-group',displayName:'群聊'}} as ArkmeSearchRecordItem
beforeEach(()=>mocks.call.mockReset())
it('preserves the source grant, owner, Markdown and original template across the native bridge',()=>{
 expect(longArticleSearchTimelineItem({...row,messageActionRef:'signed-relation'})).toMatchObject({itemUid:'same-uid',recordOwnerUserId:7,messageActionRef:'signed-relation',textFormat:'markdown',templateKind:2,displayKind:1,textContent:'**正文**'})
})
it('does not perform any lookup when the list already supplies a signed relation',async()=>{
 const original={...row,messageActionRef:'signed-relation'}
 expect(await resolveLongArticleSource(original,new AbortController().signal)).toBe(original)
 expect(mocks.call).not.toHaveBeenCalled()
})
it('resolves only the clicked recent original by source and exact owner+uid',async()=>{
 mocks.call.mockResolvedValue({items:[{itemUid:'same-uid',recordOwnerUserId:8,messageActionRef:'wrong-owner'},{itemUid:'same-uid',recordOwnerUserId:7,messageActionRef:'correct-owner'}]})
 expect((await resolveLongArticleSource(row,new AbortController().signal)).messageActionRef).toBe('correct-owner')
 expect(mocks.call).toHaveBeenCalledExactlyOnceWith('source.timeline-around',{sourceRef:'signed-group',itemUid:'same-uid',recordOwnerUserId:7,beforeLimit:0,afterLimit:0},expect.any(AbortSignal))
})
it('never falls back to private Record detail when the original source cannot authorize it',async()=>{
 mocks.call.mockResolvedValue({items:[{itemUid:'same-uid',recordOwnerUserId:8,messageActionRef:'wrong-owner'}]})
 await expect(resolveLongArticleSource(row,new AbortController().signal)).rejects.toThrow('当前无法读取')
 expect(mocks.call).toHaveBeenCalledTimes(1)
 expect(mocks.call.mock.calls[0]![0]).toBe('source.timeline-around')
})
