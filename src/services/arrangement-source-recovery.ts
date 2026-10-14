import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { exactSummaryEvidence, sourceDigest, type ArrangementEvidenceData } from '../arrangement-provenance.js'
import { ServiceRuntime, objectValue, stringValue } from './service.js'

/** Verified local compatibility index. No guessed references or server writes. */
export class ArrangementSourceRecovery {
  private writeTail: Promise<void> = Promise.resolve()
  private readonly days = new Map<string, Promise<Record<string, unknown>[]>>()
  constructor(private readonly runtime: ServiceRuntime) {}
  private path(session: ArkmeSessionCredentials) {
    return join(this.runtime.config.fileStateDirectory ?? join(homedir(), '.arkme'), 'arrangement-sources', `${sourceDigest(`${this.runtime.config.intelligentBaseUrl}:${this.runtime.config.audioBaseUrl}:${session.userId}`)}.json`)
  }
  private key(item: Record<string, unknown>) { return sourceDigest(JSON.stringify([item.uid,item.title,item.source_text,item.source_items,item.due_at])) }
  async cached(item: Record<string, unknown>, session: ArkmeSessionCredentials): Promise<ArrangementEvidenceData | undefined> {
    try { const data=JSON.parse(await readFile(this.path(session),'utf8')); return data.version===1 ? data.entries[this.key(item)]?.evidence : undefined } catch { return undefined }
  }
  async recover(item: Record<string, unknown>, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<ArrangementEvidenceData | undefined> {
    const cached=await this.cached(item,session); if(cached) return cached
    if(![5,6].includes(Number(item.source_type)) || objectValue(item.source_provenance).version===1) return undefined
    const at=Number(item.create_at); if(!Number.isSafeInteger(at)||at<=0) return undefined
    // Bounded compatibility lookup; the date only limits candidates. Identity and
    // source quote, never proximity, decide whether a link is accepted.
    const offset=28_800_000, day=86_400_000, start=Math.floor((at+offset)/day)*day-offset
    let evidence: ArrangementEvidenceData | undefined
    if (item.source_type === 6) evidence = await this.recoverCall(item, session, start, signal)
    else {
    const candidates: Record<string,unknown>[]=[]
    for(let ago=0; ago<7; ago++) {
      signal?.throwIfAborted()
      const date=start-ago*day, key=`${this.runtime.config.audioBaseUrl}:${session.userId}:${date}`
      let pending=this.days.get(key)
      if(!pending) {
        pending=this.runtime.authenticatedAudioPost<Record<string,unknown>>('/api/v1/summary/list-timeline-by-range', {from_stamp:date,to_stamp:date+day,date_stamp:date,kind:2},session,undefined,{lane:'interactive-read'})
          .then(data=>Array.isArray(data.audio_summary_ls)?data.audio_summary_ls.map(objectValue):[]).catch(error=>{this.days.delete(key);throw error})
        if(this.days.size>100) this.days.delete(this.days.keys().next().value!)
        this.days.set(key,pending)
      }
      candidates.push(...await pending)
    }
    evidence=exactSummaryEvidence(item,candidates)
    }
    if(!evidence) return undefined
    const current=await this.runtime.requireSession(); if(current.userId!==session.userId || current.refreshToken!==session.refreshToken) return undefined
    const file=this.path(session), key=this.key(item)
    const write=this.writeTail.then(async()=>{
      let data: {version:number;entries:Record<string,unknown>}={version:1,entries:{}}
      try { const existing=JSON.parse(await readFile(file,'utf8')); if(existing.version===1) data=existing } catch {}
      data.entries[key]={arrangementUid:item.uid,verifiedAt:Date.now(),evidence}
      await mkdir(join(file,'..'),{recursive:true,mode:0o700})
      const tmp=`${file}.${randomUUID()}.tmp`; await writeFile(tmp,JSON.stringify(data),{mode:0o600}); await rename(tmp,file)
    })
    this.writeTail=write.catch(()=>{}); await write
    return evidence
  }
  private async recoverCall(item: Record<string,unknown>, session: ArkmeSessionCredentials, start: number, signal?: AbortSignal): Promise<ArrangementEvidenceData | undefined> {
    const quote=stringValue(item.source_text)
    if(!quote) return undefined
    let cursor=''
    const rooms=new Set<string>()
    for(let page=0;page<20;page++) {
      const data=await this.runtime.authenticatedDataPost<Record<string,unknown>>('/api/v1/call/history-aggregate', {limit:50,start_at:start-7*86400000,end_at:start+86400000,direction:'desc',...(cursor?{cursor}:{})},session,signal,{lane:'interactive-read'})
      const values=data.items??data.records??data.histories??data.call_history_items
      if(!Array.isArray(values)) return undefined
      for(const value of values) {
        const raw=objectValue(value), r={...raw,...objectValue(raw.trtc??raw.call??raw.call_record)}, room=stringValue(r.room_id??r.roomId).trim()
        if(room && item.uid===`cuttarr:${sourceDigest(room).slice(0,8)}:${sourceDigest(`${room}\n${session.userId}\n${stringValue(item.title).trim()}\n${quote.trim()}\n${Number(item.due_at)||0}`).slice(0,16)}`) rooms.add(room)
      }
      const next=stringValue(data.next_cursor??data.nextCursor??data.cursor)
      if(data.has_more!==true && data.hasMore!==true) break
      if(!next || next===cursor) return undefined
      cursor=next
    }
    if(rooms.size!==1) return undefined
    const room=[...rooms][0]!
    const detail=await this.runtime.authenticatedWebrtcPost<Record<string,unknown>>('/api/v1/trtc/call-detail',{room_id:room},session,signal,{lane:'interactive-read'})
    const rows=detail.segments??detail.transcript_segments??detail.room_transcript_segments
    if(!Array.isArray(rows)) return undefined
    const originals=Array.isArray(item.source_items)?item.source_items.map(objectValue).map(x=>stringValue(x.text).trim()).filter(Boolean):[quote.trim()]
    // Full UID proves the call; exact original snippets are required for recovery.
    if(!originals.every(text=>rows.some(row=>stringValue(objectValue(row).text??objectValue(row).transcript??objectValue(row).content).includes(text)))) return undefined
    const matched=rows.map(objectValue).filter(row=>stringValue(row.text??row.transcript??row.content).includes(originals[0]!))
    const e:ArrangementEvidenceData={id:sourceDigest(`call:${room}:${item.uid}`),kind:'call',role:'initial',text:quote,room_id:room,recovery:'exact_uid_and_quote'}
    if(matched.length===1 && typeof matched[0]!.start_ms==='number') e.start_ms=matched[0]!.start_ms
    return e
  }

}
