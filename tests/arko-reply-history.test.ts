import {beforeEach,expect,it,vi} from 'vitest'
const mock=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mock.call}))
import {readArkoReplyHistory} from '../src/client/arko-reply-history.js'
beforeEach(()=>{mock.call.mockReset()})
it('passes the server cursor and preserves its page order without a local registry',async()=>{const items=[{key:'later-page-501'},{key:'same-time-502'}];mock.call.mockResolvedValue({accountScope:'prod:1',items,nextCursor:'signed-next'});const page=await readArkoReplyHistory('prod:1','group_mention','signed-current',new AbortController().signal);expect(page.items).toEqual(items);expect(mock.call).toHaveBeenCalledWith('arko.replies.page',{expectedAccountScope:'prod:1',query:{scene:'group_mention',cursor:'signed-current',limit:50}},expect.any(AbortSignal),{priority:'background'})})
it('propagates temporary owner errors so the original cursor can be retried',async()=>{mock.call.mockRejectedValue(Error('owner unavailable'));await expect(readArkoReplyHistory('prod:1','all','same-cursor',new AbortController().signal)).rejects.toThrow('owner unavailable')})
it('rejects a late page for another account',async()=>{mock.call.mockResolvedValue({accountScope:'prod:2',items:[]});await expect(readArkoReplyHistory('prod:1','all','',new AbortController().signal)).rejects.toThrow('账号已切换')})
