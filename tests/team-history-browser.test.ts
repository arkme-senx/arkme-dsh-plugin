import { expect,it } from 'vitest'
import { teamHistoryDate } from '../src/client/team-history-browser.js'
it('labels actual local dates and keeps invalid timestamps unknown',()=>{
 expect(teamHistoryDate(new Date(2026,9,19,10).getTime())).toBe('2026-10-19')
 for(const at of [0,-1,NaN,Infinity])expect(teamHistoryDate(at)).toBe('')
})
