import { expect, it } from 'vitest'
import type { TeamMessage, TeamTimeline } from '../src/team-app-contract.js'
import { exportTeamHistory, readTeamHistory, teamHistoryActivity, teamHistoryDays, teamHistoryText } from '../src/client/team-history-browser.js'
const message = (seq: number, changes: Partial<TeamMessage> = {}): TeamMessage => ({key:String(seq),ref:`secret-${seq}`,seq,revision:1,version:1,own:false,side:'team',sender:{nickname:'同名',personKey:'a'},state:'published',createdAt:new Date(2026,9,19,10).getTime(),canEdit:false,canDelete:false,contentStatus:'available',content:{text_content:'正文',template_kind:1},media:[],...changes})
const page = (messages: TeamMessage[], hasMore = false, beforeSeq = 0) => ({messages,hasMore,beforeSeq} as TeamTimeline)
it('streams pages, deduplicates overlaps and retains the newer revision within its read boundary', async () => {
  const progress: number[] = [], cursors: number[] = []
  const rows = await readTeamHistory(async before => { cursors.push(before);return before ? page([message(1),message(2,{version:1}),message(4)]) : page([message(2,{version:2}),message(3)],true,2) },new AbortController().signal, items=>progress.push(items.length))
  expect(cursors).toEqual([0,2]);expect(progress).toEqual([2,3]);expect(rows.map(m=>m.seq)).toEqual([1,2,3]);expect(rows[1]!.version).toBe(2)
})
it('does not return a complete result for a stalled cursor and respects cancellation', async () => {
  let calls=0
  await expect(readTeamHistory(async()=>{calls++;return page([message(2)],true,2)},new AbortController().signal,()=>{})).rejects.toThrow('分页异常')
  expect(calls).toBe(2)
  const c=new AbortController();calls=0
  await expect(readTeamHistory(async()=>{calls++;c.abort();return page([message(1)])},c.signal,()=>{})).rejects.toThrow()
  expect(calls).toBe(1)
})
it('includes attachment-only messages, excludes inaccessible/invalid dates, and never merges people by nickname', () => {
  const rows=[message(1),message(2,{sender:{nickname:'同名',personKey:'b'},content:undefined,media:[{ref:'SECRET',key:'m',url:'https://secret',name:'合同.pdf',mimeType:'application/pdf',size:1,kind:3}]}),message(3,{sender:{nickname:'未知'}}),message(4,{own:true}),message(5,{contentStatus:'deleted'}),message(6,{createdAt:0}),message(1)]
  const result=teamHistoryActivity(rows)
  expect(result).toMatchObject({totalMessages:4,participants:3,activeDays:1})
  expect(result.hourly[10]!.messages).toBe(4);expect(result.weekly.reduce((n,b)=>n+b.messages,0)).toBe(4)
  expect(teamHistoryText(rows[1]!)).toContain('合同.pdf')
  expect(teamHistoryDays(rows.slice(0,-1))).toEqual([expect.objectContaining({bucketDate:'2026-10-19',count:4})])
})
it('exports readable text and filenames, never media credentials or inaccessible text', () => {
  const output=exportTeamHistory([message(1,{media:[{ref:'SEALED',key:'asset',url:'https://secret/token',name:'附件.png',mimeType:'image/png',kind:1,size:3}]}),message(2,{contentStatus:'deleted',content:{text_content:'已撤回秘密',template_kind:1}})],'访客')
  expect(output).toContain('正文');expect(output).toContain('附件.png')
  for(const secret of ['secret-1','SEALED','https://secret/token','已撤回秘密'])expect(output).not.toContain(secret)
})
