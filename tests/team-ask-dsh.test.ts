// @vitest-environment jsdom
import {expect,it,vi} from 'vitest'
import {prepareTeamAskDshNotes} from '../src/client/team-ask-dsh.js'
import type {TeamMessage} from '../src/team-app-contract.js'

const message=(text:string):TeamMessage=>({ref:'message',key:'key',seq:1,revision:1,side:'team',sender:{nickname:'成员'},own:false,state:'published',createdAt:1,canEdit:false,canDelete:false,version:3,contentStatus:'available',mediaComplete:true,media:[],content:{text_content:text,template_kind:1}})
const text=async(file:File)=>await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsText(file)})

it('preflights pure text and gives only authoritative returned text to the shared preparer',async()=>{
 const preflight=vi.fn(async()=>[message('服务器当前正文')]),original=vi.fn(async()=>new Blob())
 const files=await prepareTeamAskDshNotes('conversation',[message('旧缓存')],'团队',new AbortController().signal,undefined,{preflight,original})
 expect(preflight).toHaveBeenCalledWith('conversation',[{messageRef:'message',version:3}],expect.any(AbortSignal))
 const markdown=await text(files[0]!)
 expect(markdown).toContain('服务器当前正文');expect(markdown).not.toContain('旧缓存')
 expect(original).not.toHaveBeenCalled()
})

it('rejects a version change before preparing or reading any attachment',async()=>{
 const preflight=vi.fn(async()=>[{...message('新正文'),version:4}]),original=vi.fn(async()=>new Blob())
 await expect(prepareTeamAskDshNotes('conversation',[message('旧缓存')],'团队',new AbortController().signal,undefined,{preflight,original})).rejects.toThrow('已变化')
 expect(original).not.toHaveBeenCalled()
})

it('uses the exact Team original grant, retains attachment completeness checks and stops after revocation',async()=>{
 const selected={...message('附件'),media:[{ref:'team-app-media.old',key:'asset-key',url:'/team/media',name:'原件.txt',mimeType:'text/plain',size:3,kind:4}]}
 const fresh={...selected,media:[{...selected.media[0]!,ref:'team-app-media.fresh'}]}
 const original=vi.fn(async()=>new Blob(['abc'],{type:'text/plain'}))
 const files=await prepareTeamAskDshNotes('conversation',[selected],'团队',new AbortController().signal,undefined,{preflight:async()=>[fresh],original})
 expect(files.map(file=>file.name)).toEqual(['快记摘录.md','原件.txt'])
 expect(original).toHaveBeenCalledWith(expect.objectContaining({originalRef:'team-app-media.old'}),expect.any(AbortSignal))
 const denied=vi.fn(async()=>{throw new Error('无权访问')})
 await expect(prepareTeamAskDshNotes('conversation',[selected],'团队',new AbortController().signal,undefined,{preflight:denied,original})).rejects.toThrow('无权访问')
 expect(original).toHaveBeenCalledOnce()
 await expect(prepareTeamAskDshNotes('conversation',[selected],'团队',new AbortController().signal,undefined,{preflight:async()=>[{...fresh,mediaComplete:false}],original})).rejects.toThrow('完整附件')
})

it('exports complete forward bodies and each authorized original without alias collisions between long articles',async()=>{
 const media=(key:string)=>({key,ref:`team-app-media.${key}`,url:'/team/media',name:`${key}.png`,mimeType:'image/png',size:3,kind:1})
 const fresh:TeamMessage={...message('转发摘要'),media:[media('one'),media('two')],forwardRecords:{title:'合并转发',createdAtMillis:1,summaryLines:['摘要'],items:['one','two'].map(key=>({senderName:'原作者',sendAtMillis:1,title:key,textContent:`${key}完整正文 ![图](arkme-asset:media-0)`,textFormat:'markdown',displayKind:1,sourceType:'team_message',contentBlocks:[{kind:'image',mediaRef:`team-app-media.${key}`,fileAssetUid:'media-0',fileName:`${key}.png`,mimeType:'image/png',size:3,sortOrder:0}]}))}}
 const original=vi.fn(async()=>new Blob(['abc'],{type:'image/png'}))
 const files=await prepareTeamAskDshNotes('conversation',[message('旧摘要')],'团队',new AbortController().signal,undefined,{preflight:async()=>[fresh],original})
 expect(files.map(file=>file.name)).toEqual(['快记摘录.md','one.png','two.png'])
 const markdown=await text(files[0]!)
 expect(markdown).toContain('one完整正文 ![图](one.png)');expect(markdown).toContain('two完整正文 ![图](two.png)')
 expect(markdown).not.toContain('旧摘要');expect(markdown).not.toContain('arkme-asset:')
 expect(original.mock.calls.map(call=>call[0].originalRef)).toEqual(['team-app-media.one','team-app-media.two'])
})

it.each(['summary','truncated','missing-original'] as const)('rejects incomplete forward material before preparing any original: %s',async kind=>{
 const fresh:TeamMessage={...message('卡片'),forwardRecords:{title:'转发',createdAtMillis:1,summaryLines:['摘要'],items:kind==='summary'?[]:[{senderName:'原作者',sendAtMillis:1,title:'',textContent:'正文',contentBlocks:[{kind:'file',mediaRef:'missing',fileName:'附件',mimeType:'text/plain',size:1,sortOrder:0}]}],...(kind==='truncated'?{truncated:true as const}:{})}}
 const original=vi.fn(async()=>new Blob())
 await expect(prepareTeamAskDshNotes('conversation',[message('卡片')],'团队',new AbortController().signal,undefined,{preflight:async()=>[fresh],original})).rejects.toThrow(/完整/)
 expect(original).not.toHaveBeenCalled()
})
