import {expect,it,vi} from 'vitest'
const mock=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mock.call}))
import {writeCloudReplyPrompt} from '../src/client/arko-reply-api.js'
it('cloud acknowledgement and revision conflict stay distinct and exact user text is transmitted',async()=>{const input={scene:'record_auto' as const,expectedRevision:3,baseOfficialRevision:'official-v1',body:'  完整正文 100%\n🐱\n'};mock.call.mockResolvedValue({accountScope:'prod:1',conflict:true,current:{revision:4}});expect((await writeCloudReplyPrompt('prod:1',input,false,new AbortController().signal)).conflict).toBe(true);expect(mock.call).toHaveBeenCalledWith('arko.reply-prompts.save',{expectedAccountScope:'prod:1',input},expect.any(AbortSignal))})
