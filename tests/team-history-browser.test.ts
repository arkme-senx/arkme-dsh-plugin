import { expect,it } from 'vitest'
import { teamHistoryDate } from '../src/client/team-history-browser.js'
it('labels actual local dates and keeps invalid timestamps unknown',()=>{
 expect(teamHistoryDate(new Date(2026,9,19,10).getTime())).toBe('2026-10-19')
 for(const at of [0,-1,NaN,Infinity])expect(teamHistoryDate(at)).toBe('')
})

import type { TeamMessage } from '../src/team-app-contract.js'
import { teamHistoryText } from '../src/client/team-history-browser.js'
it('renders the complete server excerpt once instead of appending its title and attachment metadata again',()=>{
 const message={historyPreview:true,content:{title:'标题',text_content:'标题\n正文\n附件.pdf'},historyMedia:[{name:'附件.pdf',kind:'file'}],media:[]} as TeamMessage
 expect(teamHistoryText(message)).toBe('标题\n正文\n附件.pdf')
})
