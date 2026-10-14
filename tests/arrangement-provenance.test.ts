import { describe, expect, it } from 'vitest'
import { arrangementEvidence, exactSummaryEvidence, projectEvidence, sourceDigest } from '../src/arrangement-provenance.js'

describe('arrangement source provenance',()=>{
  it('retains an explicitly identified legacy summary version',()=>{
    const evidence=arrangementEvidence({uid:'a',source_type:5,source_text:'原文',recording_source:{kind:'daily-summary',summary_id:'old-version',date_stamp:1791734400000,tz_offset:28800000}})
    expect(projectEvidence(evidence[0]!)).toMatchObject({canOpen:true,sourceDate:'2026-10-12'})
    expect(evidence[0]!.summary_id).toBe('old-version')
  })
  it('keeps immutable recognition evidence apart from later attached records',()=>{
    const item={source_type:5,source_provenance:{version:1,items:[{id:'original',kind:'audio_summary',role:'initial',text:'明天检查',summary_id:'s',date_stamp:1791734400000}]},related_records:[{uid:'later',text_content:'后加资料'}]}
    expect(arrangementEvidence(item)).toEqual([expect.objectContaining({id:'original',text:'明天检查',kind:'audio_summary'}),expect.objectContaining({role:'related',text:'后加资料',record_uid:'later'})])
    expect(projectEvidence(arrangementEvidence(item)[0]!)).not.toHaveProperty('summary_id')
  })
  it('does not mislabel historical relations as initial recognition evidence',()=>{
    const evidence=arrangementEvidence({source_type:2,record_uids:['home-operation:abc'],related_records:[{uid:'home-operation:abc',text_content:'原记录'}]})
    expect(evidence[0]).toMatchObject({kind:'record',role:'related',record_uid:'home-operation:abc'})
    expect(projectEvidence(evidence[0]!)).toMatchObject({canOpen:true})
    expect(JSON.stringify(evidence.map(projectEvidence))).not.toContain('home-operation:abc')
  })
  it('recovers only a unique owned summary with full identity and verbatim evidence',()=>{
    const id='summary-a',quote='明天检查',title='口腔检查',due=123
    const item={uid:`asumarr:${sourceDigest(id).slice(0,8)}:${sourceDigest(`${id}\n${title}\n${quote}\n${due}`).slice(0,16)}`,source_type:5,title,source_text:quote,due_at:due}
    const summary={id,answer:`待办：${quote}`,date_stamp:1791734400000,tz_offset:28800000}
    expect(exactSummaryEvidence(item,[summary])).toMatchObject({summary_id:id,date_stamp:1791734400000,recovery:'exact_uid_and_quote'})
    expect(exactSummaryEvidence({...item,title:'已修改'},[summary])).toBeUndefined()
    expect(exactSummaryEvidence(item,[{...summary,id:'other'}])).toBeUndefined()
    expect(exactSummaryEvidence(item,[{...summary,answer:'相似但不是原文'}])).toBeUndefined()
  })
})
