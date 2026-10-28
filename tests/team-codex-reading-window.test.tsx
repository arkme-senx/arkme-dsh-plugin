// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {TeamCodexConversation,newCodexReadingState,mergeCodexEvents} from '../src/client/redesign/contacts/TeamCodexConversation.js'
import {fitCodexReadingWindow,CODEX_READING_BYTES,CODEX_READING_MESSAGES} from '../src/client/redesign/contacts/codex-reading-window.js'
import type {TeamCodexTask,TeamCodexEvent} from '../src/team-codex-contract.js'
const mocks=vi.hoisted(()=>({api:vi.fn(),clipboard:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.api}))
const event=(n:number,text='正文 '+n):TeamCodexEvent=>({eventId:'e'+n,cursor:'c_'+n,sequence:n,turnSequence:n,messageSequence:0,turnId:'turn'+n,kind:'Stop',text,at:1700000000000+n,truncated:false,version:1})
const task:TeamCodexTask={id:'task',title:'历史',state:'finished',status:'active',updatedAt:1,eventCount:5000,member:{userRef:'7',displayName:'本人',role:'member',joinedAtMillis:1,identityState:'ready'},cloud:{sourceId:'source',taskId:'task',ownerRef:'7',sourceName:'来源',remote:true}}
let host:HTMLDivElement,root:ReturnType<typeof createRoot>,rows:TeamCodexEvent[]
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('navigator',{clipboard:{writeText:mocks.clipboard}});mocks.clipboard.mockReset();mocks.clipboard.mockResolvedValue(undefined);mocks.api.mockReset();rows=Array.from({length:5000},(_,i)=>event(i+1));mocks.api.mockImplementation(async(_op,params)=>{
 let candidates=rows
 const seq=(v:string)=>Number(v.slice(2))
 if(params.from)candidates=candidates.filter(e=>e.sequence>=seq(params.from))
 if(params.through)candidates=candidates.filter(e=>e.sequence<=seq(params.through))
 if(params.after)candidates=candidates.filter(e=>e.sequence>seq(params.after))
 const forward=!!(params.from||params.after)
 if(params.cursor)candidates=candidates.filter(e=>forward?e.sequence>seq(params.cursor):e.sequence<seq(params.cursor))
 const items=forward?candidates.slice(0,50):candidates.slice(-50)
 return {items,...(candidates.length>50?{nextCursor:forward?items.at(-1)!.cursor:items[0]!.cursor}:{})}
 });host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals()})
const click=async(label:string)=>{const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===label);expect(button).toBeTruthy();await act(async()=>button!.click())}
it('bounds a million-message traversal by current-window count and bytes, retaining both directions',()=>{
 let window:TeamCodexEvent[]=[]
 for(let page=0;page<20000;page++){window=fitCodexReadingWindow(mergeCodexEvents(window,Array.from({length:50},(_,i)=>event(1000000-page*50-i))), 'older').items;expect(window.length).toBeLessThanOrEqual(CODEX_READING_MESSAGES)}
 expect(window[0]?.sequence).toBe(1)
 const large=Array.from({length:50},(_,i)=>event(i,'x'.repeat(256*1024)))
 const result=fitCodexReadingWindow(large,'newer');expect(result.items).toHaveLength(8);expect(result.items.reduce((sum,e)=>sum+e.text.length,0)).toBe(CODEX_READING_BYTES)
 expect(()=>fitCodexReadingWindow([event(1,'x'.repeat(CODEX_READING_BYTES+1))],'newer')).toThrow('读取上限')
},60000)
it('keeps the existing older/scroll/latest interactions while evicting bodies and limits refresh requests',async()=>{
 const reading=newCodexReadingState();await act(async()=>root.render(<TeamCodexConversation teamRef="team" task={task} reading={reading} inputName="本人"/>))
 for(let i=0;i<8;i++)await click('加载更早记录')
 expect(reading.items).toHaveLength(200);expect(host.querySelectorAll('[data-codex-row]')).toHaveLength(200);expect(reading.newer).toBe(true)
 const last=reading.items.at(-1)!.sequence,el=host.querySelector<HTMLElement>('.arkme-codex-transcript')!
 Object.defineProperties(el,{scrollHeight:{configurable:true,value:2000},clientHeight:{configurable:true,value:400}});el.scrollTop=1600
 await act(async()=>el.dispatchEvent(new Event('scroll')))
 expect(reading.items.at(-1)!.sequence).toBeGreaterThan(last);expect(reading.items.length).toBeLessThanOrEqual(200)
 const before=mocks.api.mock.calls.length;await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(mocks.api.mock.calls.length-before).toBeLessThanOrEqual(6)
 await click('有新内容 ↓')
 expect(reading.items.at(-1)?.sequence).toBe(5000);expect(reading.newer).toBe(false);expect(reading.items.length).toBeLessThanOrEqual(200)
})
it('retains selected message snapshots after their page leaves the bounded window and clears on access denial',async()=>{
 const reading=newCodexReadingState();await act(async()=>root.render(<TeamCodexConversation teamRef="team" task={task} reading={reading} inputName="本人"/>))
 const article=host.querySelector<HTMLElement>('[data-codex-row="e5000"] article')!;await act(async()=>article.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true})))
 const select=Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(b=>b.textContent?.includes('多选'))!;expect(select).toBeTruthy();await act(async()=>select.click())
 for(let i=0;i<5;i++)await click('加载更早记录')
 expect(reading.items.some(e=>e.sequence===5000)).toBe(false)
 await click('复制文本');expect(mocks.clipboard).toHaveBeenCalledWith('正文 5000')
 mocks.api.mockRejectedValue({code:'TEAM_FORBIDDEN',status:403,message:'denied'})
 await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(reading.items).toEqual([]);expect(host.textContent).not.toContain('已选 1 条')
})
