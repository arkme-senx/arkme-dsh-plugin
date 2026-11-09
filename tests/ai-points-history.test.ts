import {expect,it,vi} from 'vitest'
import {PointsHistoryReader,pointsWindow,pointsDateKey,aggregatePointsView,pointsCategory} from '../src/client/ai-points-history.js'
import type {ArkmeAiPointsStatistics,ArkmeAiPointsRangePage} from '../src/ai-points-statistics.js'
const scope='test:42', now=Date.parse('2026-01-02T00:01:00+08:00')
function snapshot(grain:'day'|'week'|'month'='day'):ArkmeAiPointsStatistics {
 const w=pointsWindow(grain,0,now)
 return {accountScope:scope,unit:'ai_points',query:{fromDate:pointsDateKey(w.from),untilDate:pointsDateKey(w.until),timezone:'Asia/Shanghai',grain},observedAt:now,chargedPoints:'0.0000001',buckets:w.periods.map((p,i)=>({fromDate:pointsDateKey(p.from),untilDate:pointsDateKey(p.until),chargedPoints:i===w.periods.length-1?'0.0000001':'0',types:i===w.periods.length-1?[{businessCode:'agent',chargedPoints:'0.0000001'}]:[]}))}
}
function range():ArkmeAiPointsRangePage {const w=pointsWindow('day',0,now);return {accountScope:scope,unit:'ai_points',fromDate:pointsDateKey(w.from),untilDate:pointsDateKey(w.until),observedAt:now,chargedPoints:'0.0000001',items:[],nextBeforeId:''}}
it('preserves Beijing calendar and exact small amounts across year boundaries',()=>{
 for(const grain of ['day','week','month'] as const){const w=pointsWindow(grain,0,now),s=snapshot(grain);expect(w.periods).toHaveLength(grain==='day'?15:grain==='week'?8:12);expect(aggregatePointsView(s,w,null).selectedPoints).toBe('0.0000001')}
 expect(pointsCategory('agent')).toBe('arko');expect(pointsCategory('unrecognized')).toBe('other')
})
it('reuses one settled snapshot for category selection',async()=>{
 const summary=vi.fn(async()=>snapshot()), reader=new PointsHistoryReader(scope,{summary,range:async()=>range()}),w=pointsWindow('day',0,now)
 const all=await reader.statistics(w,null,new AbortController().signal)
 const selected=await reader.statistics(w,w.periods.at(-1)!.key,new AbortController().signal)
 expect(summary).toHaveBeenCalledOnce();expect(selected.observedAt).toBe(all.observedAt);expect(selected.categories.find(x=>x.category==='arko')?.chargedPoints).toBe('0.0000001')
})
it('does not silently scan old monthly consumption on unsupported service',async()=>{
 const failure=Object.assign(new Error('unsupported'),{code:'ai-points-statistics-unsupported'})
 const reader=new PointsHistoryReader(scope,{summary:async()=>{throw failure},range:async()=>range()})
 await expect(reader.statistics(pointsWindow('day',0,now),null,new AbortController().signal)).rejects.toBe(failure)
})
it('rejects account switches and canceled reads without caching stale results',async()=>{
 const controller=new AbortController();let finish!:(x:ArkmeAiPointsStatistics)=>void
 const reader=new PointsHistoryReader(scope,{summary:()=>new Promise(resolve=>{finish=resolve}),range:async()=>range()})
 const pending=reader.statistics(pointsWindow('day',0,now),null,controller.signal);controller.abort();finish(snapshot())
 await expect(pending).rejects.toThrow()
 const foreign=new PointsHistoryReader(scope,{summary:async()=>({...snapshot(),accountScope:'other'}),range:async()=>range()})
 await expect(foreign.statistics(pointsWindow('day',0,now),null,new AbortController().signal)).rejects.toMatchObject({reason:'invalid'})
})
it('requires matching cutoff, scope and total for drilldown and late settlements',async()=>{
 const page=range(),query={fromDate:page.fromDate,untilDate:page.untilDate,timezone:'Asia/Shanghai' as const,settledBefore:now}
 for(const patch of [{observedAt:now+1},{accountScope:'other'},{chargedPoints:'0.0000002'}]){
 const reader=new PointsHistoryReader(scope,{summary:async()=>snapshot(),range:async()=>({...page,...patch})})
 await expect(reader.details(query,'0.0000001',new AbortController().signal)).rejects.toThrow()
 }
})
