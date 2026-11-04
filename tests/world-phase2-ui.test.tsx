// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamWorldFeedback } from '../src/client/TeamWorldFeedback.js'
import { TeamWorldManagement } from '../src/client/TeamWorldManagement.js'
import { ArkmeDayTimeline } from '../src/client/ArkmeDayTimeline.js'
import { WorldCard, WorldTeamReplyContext } from '../src/client/ArkmeWorldSurface.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { worldReactionContexts, worldCloudReactionPreview } from '../src/client/world-reactions.js'
import { reactionLibrary } from '../src/client/reaction-library.js'
import { reactionFixture } from './reaction-fixture.js'
const {call}=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',async original=>({...await original<object>(),callArkme:(...args:unknown[])=>call(...args)}))
const context={teamRef:'team',jotmoId:'team-id',name:'即我团队',capabilities:{publish:true,manage:true,feedback:true,reply:true}}
const post={recordRef:'public-note',authorName:'即我团队',teamAuthor:{jotmoId:'team-id',name:'即我团队'},publisher:{name:'小林'},headline:'原快记',textContent:'仍然公开的正文',tags:[],templateKind:0,imageRefs:[],imageCount:0,videoCount:0,voiceCount:0,extendCount:0,createdAtMillis:1,publishedAtMillis:1}
const original={contentRef:'original',recordRef:'public-note',revision:3,title:'保留标题',text:'原始正文',format:'markdown' as const,sourceKind:'record',assets:[],deleted:false,publicRequested:true,pending:false,updatedAt:1}
let host:HTMLDivElement,root:Root
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);call.mockReset();reactionFixture.reset()
 arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:8})
 call.mockImplementation(async(op,input)=>op==='world.replies'?{items:[],hasMore:false}:op==='world.reactions.prepare'?{items:[{recordRef:post.recordRef,target:{id:'target',worldRecordRef:'sealed'},visibility:'published'}],unavailableRecordRefs:[]}:reactionFixture.call(op,input))
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();worldReactionContexts.setScope(undefined);worldCloudReactionPreview.setScope(undefined);reactionLibrary.setScope(undefined);vi.unstubAllGlobals()})
const button=(text:string)=>[...document.querySelectorAll('button')].find(item=>item.textContent===text||item.getAttribute('aria-label')===text)!
const mount=async(ui:React.ReactNode)=>act(async()=>root.render(ui))
const click=async(text:string)=>act(async()=>button(text).click())
function mockPagingObserver() {
 const observers: { callback: IntersectionObserverCallback; target?: Element; disconnected?: boolean }[] = []
 vi.stubGlobal('IntersectionObserver', class {
  entry: typeof observers[number]
  constructor(callback: IntersectionObserverCallback) { this.entry = { callback }; observers.push(this.entry) }
  observe(target: Element) { this.entry.target = target }
  disconnect() { this.entry.disconnected = true }
 })
 return async () => act(async () => {
  const observer = observers.findLast(value => !value.disconnected && value.target?.hasAttribute('data-world-load-more-sentinel'))!
  observer.callback([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver)
  observer.callback([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver)
 })
}
it('groups across renewed capabilities, previews actual comments, and removes withdrawn public bodies',async()=>{
 const bottom=mockPagingObserver()
 const event={key:'event',sequence:1,contentRef:'random-a',contentKey:'stable',kind:'reaction',isMe:false,at:1,eventRef:'feedback-ref',actorName:'小陈',preview:{teamName:'团队',title:'私有标题',text:'不得替代公开的内部原稿',imageCount:0,deleted:false,publicRequested:true},publication:post,reaction:{active:true,expression:{text:'赞'}}}
 let revoked=false
 call.mockImplementation(async(op,input)=>op==='team.world'?{items:revoked?[{...event,publication:undefined}]:input.afterSequence?[{...event,sequence:2,contentRef:'random-b',reaction:{active:false,expression:{text:'赞'}}}]:[event],hasMore:!revoked&&!input.afterSequence,afterSequence:input.afterSequence?2:1,seenThrough:0,offeredThrough:input.afterSequence?2:1}:op==='world.reactions.prepare'?{items:[],unavailableRecordRefs:[]}:reactionFixture.call(op,input))
 const open=vi.fn();await mount(<TeamWorldFeedback accountKey="test:8" context={context} onOpen={open} refreshKey={0}/>);await bottom()
 expect(document.querySelectorAll('[data-team-feedback-group]')).toHaveLength(1)
 expect(button('查看快记：原快记')).toBeDefined();await click('查看快记：原快记');expect(open).toHaveBeenCalledWith(post)
 expect(document.body.textContent).toContain('添加了表态');expect(document.body.textContent).toContain('取消了表态');expect(document.body.textContent).not.toContain('不得替代')
 revoked=true;await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(document.body.textContent).not.toContain('仍然公开的正文');expect(document.body.textContent).toContain('当前未公开')
})
it('keeps original title and markdown when editing through the shared editor',async()=>{
 call.mockImplementation(async(op,input)=>input.action==='originals'?{items:[original],hasMore:false}:input.action==='submit'?{pending:false,result:{visibility:'published'}}:{})
 await mount(<TeamWorldManagement accountKey="test:8" context={context} onClose={()=>{}} onChanged={()=>{}}/>);await click('编辑');await click('发布')
 const command=call.mock.calls.find(([op,input])=>op==='team.world'&&input.action==='submit')![1]
 expect(command).toMatchObject({change:'edit',expectedRevision:3,draft:{title:'保留标题',text:'原始正文',format:'markdown',imageRefs:[]}})
})
it('withdraw confirmation uses the distinct actor count rather than expression totals',async()=>{
 call.mockImplementation(async(op,input)=>input.action==='originals'?{items:[original],hasMore:false}:op==='world.reactions.prepare'?{items:[{recordRef:'public-note',target:{id:'target',worldRecordRef:'sealed'},visibility:'published'}]}:op==='world.reactions.archive'?{items:[{actor_count:2,groups:[{count:3},{count:4}]}]}:{})
 await mount(<TeamWorldManagement accountKey="test:8" context={context} onClose={()=>{}} onChanged={()=>{}}/>);await click('更多内容操作');await click('取消公开')
 expect(document.querySelector('[aria-modal="true"]')?.textContent).toContain('2 人表态')
 expect(call.mock.calls.some(([,input])=>input.action==='submit')).toBe(false)
})
it('team replies use one source and retain the exact uncertain request; personal comments stay on their owner',async()=>{
 const base=call.getMockImplementation()!;let attempts=0
 call.mockImplementation(async(op,input)=>{
  if(op==='team.world'&&input.action==='source')return{sourceRef:'verified-reply-source'}
  if(op==='team.world'&&input.action==='submit'){if(!attempts++)throw Error('结果未知');return{pending:false,result:{visibility:'published'}}}
  return base(op,input)
 })
 await mount(<WorldTeamReplyContext.Provider value={context}><WorldCard item={post} detail playable={false} voiceprintActive={false} voiceprintLoading={false} interactionsOpen onOpenInteractions={()=>{}} onInteractionCreated={()=>{}} onToggleVoiceprint={()=>{}}/></WorldTeamReplyContext.Provider>)
 await click('回复身份');await act(async()=>document.querySelector<HTMLButtonElement>('[data-role-action="team"]')!.click())
 await act(async()=>{const area=document.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,'团队接续回复');area.dispatchEvent(new Event('input',{bubbles:true}))})
 await click('发送');expect(document.querySelector('textarea')?.value).toBe('团队接续回复');await click('发送')
 const writes=call.mock.calls.filter(([op,input])=>op==='team.world'&&input.action==='submit')
 expect(writes).toHaveLength(2);expect(writes[0]![1]).toEqual(writes[1]![1]);expect(writes[0]![1].draft).toMatchObject({sourceRef:'verified-reply-source',parentRef:'public-note',text:'团队接续回复'})
 expect(document.querySelector('textarea')?.value).toBe('');expect(call.mock.calls.filter(([,input])=>input.action==='source')).toHaveLength(1)
})
it('offers one self-retraction for an effective World expression even when its body is inaccessible',async()=>{
 const at=Date.now(),target={id:'world-target',worldRecordRef:'opaque'},state={revision:3,selections:[{key:'yes',expression:{text:'赞'},at}]}
 call.mockImplementation(async(op,input)=>input.action==='set'?{outcome:'updated',state:{revision:4,selections:[]}}:op==='reactions'?{items:[],has_more:false}:{items:[{event_uid:'a',target_id:target.id,target,state,expression:{text:'赞'},active:true,at,restricted:true},{event_uid:'b',target_id:target.id,target,state,expression:{text:'赞'},active:true,at:at-1,restricted:true}],has_more:false})
 await mount(<ArkmeDayTimeline query={{accountScope:'test:8',bucketDate:new Date(at).toISOString().slice(0,10),timezone:'UTC',mode:'activities',kind:'all',includeBackground:false}} onQueryChange={()=>{}}/>);await act(async()=>document.querySelector<HTMLButtonElement>('.arkme-day-entry-content')!.click())
 expect([...document.querySelectorAll('button')].filter(item=>item.textContent==='取消我的表态')).toHaveLength(1)
 await click('取消我的表态');expect(document.body.textContent).not.toContain('取消我的表态')
 expect(call.mock.calls.find(([,input])=>input.action==='set')?.[1]).toMatchObject({target,active:false,expected_revision:3})
})
it('renews expired archive capabilities and removes a revoked archive on focus', async()=>{
 const {WorldReactionArchive}=await import('../src/client/NoteWorldReactionArchive.js')
 const target={id:'current-version',worldRecordRef:'expired'},archiveContext={recordRef:'original',target,visibility:'unpublished' as const}
 let denied=false
 call.mockImplementation(async(op,input)=>{
  if(op==='world.reactions.prepare')return{items:denied?[]:[{...archiveContext,target:{...target,worldRecordRef:'renewed'}}]}
  if(op==='world.reactions.versions'){if(input.target.worldRecordRef==='expired')throw Error('归档凭证已过期');return{items:[],hasMore:false}}
  if(op==='world.reactions.archive')return{items:[{target_id:target.id,revision:1,mine:{revision:1,selections:[]},groups:[],actor_count:2}]}
  return{}
 })
 await mount(<WorldReactionArchive accountKey="test:8" context={archiveContext}/>);await click('重试')
 expect(call.mock.calls.some(([op,input])=>op==='world.reactions.versions'&&input.target.worldRecordRef==='renewed')).toBe(true)
 denied=true;await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(document.body.textContent).toContain('当前无法读取这份原件')
 expect(document.body.textContent).not.toContain('当前版本')
})
it('bounds private image reads and cancels queued requests without issuing them', async()=>{
 const {readTeamWorldImage}=await import('../src/client/TeamWorldImages.js')
 const finish: (()=>void)[]=[]
 call.mockImplementation(()=>new Promise(resolve=>finish.push(()=>resolve({mediaType:'image/png',dataBase64:''}))))
 const first=readTeamWorldImage('first',new AbortController().signal),second=readTeamWorldImage('second',new AbortController().signal)
 const abort=new AbortController(),third=readTeamWorldImage('third',abort.signal).catch(()=>undefined)
 expect(call.mock.calls).toHaveLength(2);abort.abort();finish.forEach(resolve=>resolve());await Promise.all([first,second,third])
 expect(call.mock.calls).toHaveLength(2)
})
it('uses World thumbnails for team detail comments; image Escape retains the comment panel',async()=>{
 const {WorldInteractionThreadList}=await import('../src/client/ArkmeWorldSurface.js')
 const comment={interactionRef:'comment',parentRef:'root',authorName:'小陈',isSelf:false,textContent:'图片建议',imageRefs:['comment-image'],createdAtMillis:1,publishedAtMillis:1}
 await mount(<WorldTeamReplyContext.Provider value={context}><WorldInteractionThreadList rootRef="root" items={[comment]}/></WorldTeamReplyContext.Provider>)
 await click('预览小陈发布的图片 1')
 expect(document.querySelector('[aria-label="世界图片预览"]')).not.toBeNull()
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
 expect(document.querySelector('[aria-label="世界图片预览"]')).toBeNull();expect(document.body.textContent).toContain('图片建议')
 await mount(<WorldInteractionThreadList rootRef="root" items={[comment]}/>);expect(button('预览小陈发布的图片 1')).toBeUndefined()
})
it('previews visible team comments despite absent counts, keeps images independent and clears revoked previews',async()=>{
 const observers: { callback: IntersectionObserverCallback; target?: Element }[]=[]
 vi.stubGlobal('IntersectionObserver',class {
  entry:{callback:IntersectionObserverCallback;target?:Element}
  constructor(callback:IntersectionObserverCallback){this.entry={callback};observers.push(this.entry)}
  observe(target:Element){this.entry.target=target} disconnect(){} unobserve(){}
 })
 const base=call.getMockImplementation()!,open=vi.fn()
 let denied=false
 const comment={interactionRef:'preview-comment',parentRef:post.recordRef,authorName:'小陈',isSelf:false,textContent:'图片建议',imageRefs:['preview-image'],createdAtMillis:1,publishedAtMillis:1}
 call.mockImplementation(async(op,input,...rest)=>{
  if(op==='world.replies'){if(denied)throw Error('祖先未公开');return{items:[comment],hasMore:true,nextCursor:'more'}}
  return base(op,input,...rest)
 })
 const card=(version:number)=><WorldCard item={post} teamCommentPreview commentPreviewVersion={version} playable={false} voiceprintActive={false} voiceprintLoading={false} interactionsOpen={false} onOpenInteractions={open} onOpenDetail={open} onInteractionCreated={()=>{}} onToggleVoiceprint={()=>{}}/>
 await mount(card(0));expect(call.mock.calls.filter(([op])=>op==='world.replies')).toHaveLength(0)
 const visible=()=>{const observer=observers.findLast(value=>value.target?.hasAttribute('data-world-team-comments'))!;observer.callback([{isIntersecting:true}] as IntersectionObserverEntry[],{} as IntersectionObserver)}
 await act(async()=>visible())
 const reads=call.mock.calls.filter(([op])=>op==='world.replies')
 expect(reads).toHaveLength(1);expect(reads[0]![1]).toEqual({recordRef:post.recordRef,limit:3});expect(reads[0]![3]).toEqual({priority:'background'})
 expect(document.body.textContent).toContain('图片建议')
 await click('预览小陈发布的图片 1');expect(open).not.toHaveBeenCalled();expect(document.querySelector('[aria-label="世界图片预览"]')).not.toBeNull()
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
 expect(document.querySelector('[aria-label="世界图片预览"]')).toBeNull()
 await act(async()=>document.querySelector<HTMLElement>('[data-world-comment-level]')!.click());expect(open).toHaveBeenCalledOnce()
 expect(call.mock.calls.some(([,input])=>input.action==='feedback-read')).toBe(false)
 denied=true;await mount(card(1));await act(async()=>visible())
 expect(document.body.textContent).not.toContain('图片建议');expect(button('预览小陈发布的图片 1')).toBeUndefined()
})
it('moves the ordered feedback ledger to More and never acknowledges unseen feed events',async()=>{
 const {TeamWorldSurface}=await import('../src/client/TeamWorldSurface.js')
 const base=call.getMockImplementation()!
 let allowed=true
 call.mockImplementation(async(op,input,...rest)=>{
  if(op==='team.app.world.view')return{state:'ready',team:context,memberTeam:allowed?context:undefined,context:{...context,capabilities:{publish:allowed,manage:allowed,feedback:allowed,reply:allowed}},feed:{items:[post],hasMore:false}}
  if(op==='team.world'&&input.action==='feedback')return{items:[],hasMore:true,afterSequence:7,offeredThrough:99,seenThrough:0}
  if(op==='team.world'&&input.action==='feedback-read')return{}
  return base(op,input,...rest)
 })
 await mount(<TeamWorldSurface accountKey="test:8" target={context} onBack={()=>{}}/>)
 expect(document.querySelector('nav[aria-label="团队世界内容"]')).toBeNull();expect(button('共同反馈')).toBeUndefined()
 expect(call.mock.calls.some(([,input])=>input.action==='feedback')).toBe(false)
 await click('更多团队世界操作');await click('反馈记录')
 expect((document.querySelector('[aria-label="反馈记录"]') as HTMLElement).style.top).toBe('0px')
 expect(call.mock.calls.some(([,input])=>input.action==='feedback-read')).toBe(false)
 await click('标记已读')
 expect(call.mock.calls.find(([,input])=>input.action==='feedback-read')![1]).toMatchObject({throughSequence:7,teamRef:context.teamRef,accountKey:'test:8'})
 allowed=false;await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(document.querySelector('[aria-label="反馈记录"]')).toBeNull();expect(button('更多团队世界操作')).toBeUndefined()
 expect(document.body.textContent).toContain('仍然公开的正文')
})
it('labels integrated feedback and identifies a comment by its original note and operation',async()=>{
 const base=call.getMockImplementation()!,open=vi.fn()
 const comment={...post,recordRef:'comment',authorName:'小陈',headline:'',textContent:'请把图片放大一点',imageRefs:[]}
 call.mockImplementation(async(op,input,...rest)=>op==='team.world'?{items:[{key:'one',sequence:1,contentRef:'private-ref',contentKey:'stable',kind:'comment',isMe:false,at:1,eventRef:'event',actorName:'小陈',preview:{teamName:'团队',title:'内部标题',text:'私有原文不可回退',imageCount:0,deleted:false,publicRequested:true},publication:post,comment}],hasMore:false,afterSequence:1,seenThrough:0,offeredThrough:1}:base(op,input,...rest))
 await mount(<TeamWorldFeedback accountKey="test:8" context={context} onOpen={open} refreshKey={0}/>);
 expect(button('查看快记：原快记')).toBeDefined();expect(document.body.textContent).toContain('小陈 评论了这条快记');expect(document.body.textContent).toContain('请把图片放大一点')
 await click('小陈 评论了这条快记');expect(open).toHaveBeenCalledWith(post,'comment');expect(document.body.textContent).not.toContain('私有原文不可回退')
 await mount(<WorldCard item={post} teamCommentPreview playable={false} voiceprintActive={false} voiceprintLoading={false} interactionsOpen={false} onOpenInteractions={()=>{}} onInteractionCreated={()=>{}} onToggleVoiceprint={()=>{}}/>);
 expect([...document.querySelectorAll('h3')].map(e=>e.textContent)).toContain('共同反馈')
})
it('omits the repeated team name only inside a scoped team activity view',async()=>{
 const {TeamWorldActivity}=await import('../src/client/TeamWorldActivity.js')
 call.mockResolvedValue({items:[{requestUid:'publish-1',contentRef:'original',revision:1,acceptedAt:1,pending:false,action:'publish',preview:{teamName:'即我团队',title:'封面说明',text:'蓝色主色',imageCount:0,deleted:false,publicRequested:true}}],hasMore:false})
 await mount(<TeamWorldActivity team={context} onClose={()=>{}}/>);
 expect(document.body.textContent).toContain('发布了快记');expect(document.body.textContent).not.toContain('即我团队');expect(call.mock.calls.at(-1)![1]).toMatchObject({teamRef:context.teamRef})
 await mount(<TeamWorldActivity onClose={()=>{}}/>);
 expect(document.body.textContent).toContain('即我团队 · 发布了快记');expect(call.mock.calls.at(-1)![1]).not.toHaveProperty('teamRef')
})

it.each(['activity', 'originals'])('automatically pages %s in a bounded window and revalidates retained pages', async action => {
 const bottom = mockPagingObserver()
 const { TeamWorldActivity } = await import('../src/client/TeamWorldActivity.js')
 let revoked = false
 call.mockImplementation(async (op, input) => {
  if (revoked) throw Error('团队权限已失效')
  const page = Number(input.cursor ?? 0)
  return { items: Array.from({ length: 20 }, (_, offset) => action === 'activity'
   ? { requestUid: `event-${page * 20 + offset}`, action: 'publish', acceptedAt: 1, preview: { teamName: '团队', title: `条目-${page * 20 + offset}`, text: '', imageRefs: [] } }
   : { ...original, recordRef: `record-${page * 20 + offset}`, title: `条目-${page * 20 + offset}` }), hasMore: true, nextCursor: String(page + 1) }
 })
 await mount(action === 'activity' ? <TeamWorldActivity team={context} onClose={()=>{}}/> : <TeamWorldManagement accountKey="test:8" context={context} onClose={()=>{}} onChanged={()=>{}}/>)
 expect((document.querySelector('[role="dialog"]') as HTMLElement).style.top).toBe('0px')
 expect(button('下一页')).toBeUndefined();expect(button('加载更多')).toBeUndefined();expect(button('返回第一页')).toBeUndefined()
 await bottom();expect(document.querySelectorAll('[data-team-page-row]')).toHaveLength(40)
 for (let i=0;i<4;i++) await bottom()
 expect(document.querySelectorAll('[data-team-page-row]')).toHaveLength(100)
 expect(document.body.textContent).not.toContain('条目-0');expect(document.body.textContent).toContain('条目-119')
 call.mockClear();await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(call.mock.calls.map(([,input])=>input.cursor)).toEqual(['1','2','3','4','5'])
 expect(document.querySelectorAll('[data-team-page-row]')).toHaveLength(100)
 revoked=true;await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(document.querySelectorAll('[data-team-page-row]')).toHaveLength(0)
 expect(document.querySelector('[data-world-load-more-sentinel]')).toBeNull()
 expect(document.body.textContent).toContain('团队权限已失效')
})
it('shows the team publisher beside the time in both list and detail', async()=>{
 const { ArkmeWorldRecordDetail }=await import('../src/client/ArkmeWorldRecordDetail.js')
 const base=call.getMockImplementation()!
 await mount(<WorldCard item={post} playable={false} voiceprintActive={false} voiceprintLoading={false} interactionsOpen={false} onOpenInteractions={()=>{}} onInteractionCreated={()=>{}} onToggleVoiceprint={()=>{}}/>)
 expect(document.body.textContent).toContain('即我团队')
 expect(document.querySelector('header time')?.parentElement?.textContent).toContain(' · 小林 发布')
 expect(document.querySelectorAll('header time')).toHaveLength(1)
 call.mockImplementation(async(op,input,...rest)=>op==='world.record.read'?post:base(op,input,...rest))
 await mount(<ArkmeWorldRecordDetail item={post} onClose={()=>{}} renderAvatar={()=>null} renderContent={()=>null}/>)
 const author=document.querySelector('[data-arkme-detail-author]')!
 expect(author.textContent).toContain(' · 小林 发布')
 expect(document.body.textContent).not.toContain('由小林发布')
 const personal={...post,teamAuthor:undefined}
 await mount(<WorldCard item={personal} playable={false} voiceprintActive={false} voiceprintLoading={false} interactionsOpen={false} onOpenInteractions={()=>{}} onInteractionCreated={()=>{}} onToggleVoiceprint={()=>{}}/>)
 expect(document.querySelector('header')?.textContent).not.toContain(' 发布')
 expect(document.querySelector('header')?.lastElementChild?.tagName).toBe('TIME')
 call.mockImplementation(async(op,input,...rest)=>op==='world.record.read'?personal:base(op,input,...rest))
 await mount(<ArkmeWorldRecordDetail key="personal" item={personal} onClose={()=>{}} renderAvatar={()=>null} renderContent={()=>null}/>)
 expect(document.querySelector('[data-arkme-detail-author]')?.textContent).not.toContain(' 发布')
})

it('switches the three More views without stacking side panels', async()=>{
 const { TeamWorldSurface }=await import('../src/client/TeamWorldSurface.js')
 const base=call.getMockImplementation()!
 call.mockImplementation(async(op,input,...rest)=>op==='team.app.world.view'?{state:'ready',team:context,memberTeam:context,context,feed:{items:[],hasMore:false}}:op==='team.world'?{items:[],hasMore:false,afterSequence:0,offeredThrough:0,seenThrough:0}:base(op,input,...rest))
 await mount(<TeamWorldSurface accountKey="test:8" target={context} onBack={()=>{}}/>)
 for(const label of ['团队内容','我的团队操作','团队内容','反馈记录','我的团队操作']){
  await click('更多团队世界操作');await click(label)
  const panels=document.querySelectorAll('[data-arkme-note-detail]')
  expect(panels).toHaveLength(1);expect(panels[0]?.getAttribute('aria-label')).toBe(label)
  expect((panels[0] as HTMLElement).style.top).toBe('0px')
 }
})

it('opens deleted content in place and discards stale reads when returning', async()=>{
 let finishDeleted: ((value: unknown)=>void) | undefined
 call.mockImplementation(async(op,input)=>input.action==='originals'&&input.deleted
  ? new Promise(resolve=>{finishDeleted=resolve})
  : {items:[original],hasMore:false})
 await mount(<TeamWorldManagement accountKey="test:8" context={context} onClose={()=>{}} onChanged={()=>{}}/>)
 expect(document.querySelector('[aria-label="团队内容筛选"]')).toBeNull()
 await click('更多团队内容操作');await click('已删除')
 expect(document.querySelector('[data-arkme-right-panel-header]')?.textContent).toContain('已删除')
 expect(document.body.textContent).not.toContain('原始正文');expect(button('返回团队内容').disabled).toBe(false)
 const pendingRead=call.mock.calls.find(([,input])=>input.action==='originals'&&input.deleted)!
 await click('返回团队内容');expect(pendingRead[2].aborted).toBe(true)
 await act(async()=>finishDeleted!({items:[{...original,deleted:true,text:'过期的已删除内容'}],hasMore:false}))
 expect(document.body.textContent).toContain('原始正文');expect(document.body.textContent).not.toContain('过期的已删除内容')
 call.mockResolvedValue({items:[],hasMore:false});await click('更多团队内容操作');await click('已删除')
 expect(document.body.textContent).toContain('暂无已删除内容')
})

it('keeps management actions in the existing menu and preserves the original body in the editor',async()=>{
 call.mockImplementation(async(op,input)=>input.action==='originals'?{items:[original],hasMore:false}:{})
 await mount(<TeamWorldManagement accountKey="test:8" context={context} onClose={()=>{}} onChanged={()=>{}}/>)
 expect(button('取消公开')).toBeUndefined();expect(button('删除')).toBeUndefined()
 const text=document.querySelector('[data-team-page-row] p') as HTMLElement
 expect(text.style.webkitLineClamp).toBe('3')
 await click('更多内容操作');expect(button('取消公开')).toBeDefined();expect(button('世界表态归档')).toBeDefined();expect(button('删除')).toBeDefined()
 await click('删除');expect(document.querySelector('[aria-modal="true"]')?.textContent).toContain('删除团队内容')
 expect(call.mock.calls.some(([,input])=>input.action==='submit')).toBe(false)
})
it('restores and revalidates the retained main window after visiting deleted content',async()=>{
 const bottom=mockPagingObserver()
 call.mockImplementation(async(op,input)=>input.deleted?{items:[],hasMore:false}:{items:[{...original,recordRef:input.cursor?'second':'first'}],hasMore:!input.cursor,nextCursor:'next'})
 await mount(<TeamWorldManagement accountKey="test:8" context={context} onClose={()=>{}} onChanged={()=>{}}/>)
 await bottom();expect(document.querySelectorAll('[data-team-page-row]')).toHaveLength(2)
 await click('更多团队内容操作');await click('已删除');call.mockClear();await click('返回团队内容')
 expect(call.mock.calls.map(([,input])=>input.cursor)).toEqual([undefined,'next'])
 expect(document.querySelectorAll('[data-team-page-row]')).toHaveLength(2)
})
it('shows one compact private thumbnail with a count and keeps every image accessible in the existing preview',async()=>{
 const BaseURL=URL
 vi.stubGlobal('URL',class extends BaseURL {static createObjectURL=vi.fn(()=> 'blob:private-image');static revokeObjectURL=vi.fn()})
 const close=vi.fn(),assets=[1,2,3].map(n=>({imageRef:`private-${n}`,mimeType:'image/png',size:1}))
 call.mockImplementation(async(op,input)=>input.action==='originals'?{items:[{...original,assets}],hasMore:false}:op==='image.read'?{mediaType:'image/png',dataBase64:'AA=='}:{})
 await mount(<TeamWorldManagement accountKey="test:8" context={context} onClose={close} onChanged={()=>{}}/>)
 expect(document.querySelectorAll('[data-team-page-row] img')).toHaveLength(1);expect(document.body.textContent).toContain('+2')
 await click('预览图片 1');await click('下一张图片')
 expect(call.mock.calls.some(([op,input])=>op==='image.read'&&input.imageRef==='private-2')).toBe(true)
 const {invalidateWorldImages}=await import('../src/client/world-image-cache.js')
 await act(async()=>invalidateWorldImages(['private-2']))
 expect(document.querySelector('[aria-label="世界图片预览"] img')).toBeNull()
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
 expect(close).not.toHaveBeenCalled();expect(document.querySelector('[aria-label="世界图片预览"]')).toBeNull()
})
