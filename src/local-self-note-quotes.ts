import {createHash} from 'node:crypto'
import type {RecordExcerpt} from './record-excerpt.js'
import type { DatabaseSync } from 'node:sqlite'
import { readSelectedTextNoteQuote, selectedTextNoteHeader, selectedTextNotePresentation, selectedTextNotePrefix, selectedTextForwardPrefix, type SelectedTextNoteQuote, type SelectedTextNotePresentation } from './selected-text-note.js'

/** Durable account data. Unlike a cache, quotations are never evicted on an age/size budget. */
export class LocalSelfNoteQuotes {
  constructor(private readonly db: DatabaseSync) {
    db.exec('CREATE TABLE IF NOT EXISTS self_note_quotes (scope TEXT NOT NULL, record_uid TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(scope, record_uid))')
  }
  prepare(scope: string, recordUid: string, quote: SelectedTextNoteQuote, noteText: string, forward?: { targetKey: string; relationUid: string }) {
    const existing = this.db.prepare('SELECT payload FROM self_note_quotes WHERE scope=? AND record_uid=?').get(scope, recordUid) as { payload: string } | undefined
    const payload = JSON.stringify({ quote, header: selectedTextNoteHeader(quote), noteText, ...(forward ? { kind: 'forward', ...forward } : {}) })
    if (existing) {
      if (existing.payload !== payload) throw new Error('发送内容已冻结，请使用原内容重试')
      return
    }
    this.db.prepare('INSERT INTO self_note_quotes(scope,record_uid,payload) VALUES(?,?,?)').run(scope, recordUid, payload)
  }
  migrationCandidates(scope:string,limit=4,after=''):string[] {
    return (this.db.prepare(`SELECT record_uid FROM self_note_quotes WHERE scope=?
      AND COALESCE(json_extract(payload,'$.migration.status'),'pending')='pending' AND record_uid>? ORDER BY record_uid LIMIT ?`).all(scope,after,limit) as {record_uid:string}[]).map(row=>row.record_uid)
  }
  migration(scope:string,recordUid:string,text:string,version:number):{record_uid:string;expected_version:number;text_digest:string;excerpt:RecordExcerpt}|undefined {
    const row=this.db.prepare('SELECT payload FROM self_note_quotes WHERE scope=? AND record_uid=?').get(scope,recordUid) as {payload:string}|undefined
    if(!row)return
    const saved=JSON.parse(row.payload),presentation=this.project(scope,recordUid,text)
    if(!presentation||!presentation.noteText.trim()||!Number.isSafeInteger(version)||version<1)return
    const prefix=presentation.kind==='forward'?selectedTextForwardPrefix(presentation.quote,presentation.header):selectedTextNotePrefix(presentation.quote,presentation.header)
    const body={record_uid:recordUid,expected_version:version,text_digest:createHash('sha256').update(text).digest('hex'),excerpt:{schema_version:1 as const,header_end:presentation.header.length,
      quote_start:presentation.header.length+1,quote_end:presentation.header.length+1+presentation.quote.text.length,note_start:prefix.length,
      frozen_digest:createHash('sha256').update(prefix).digest('hex'),...(presentation.quote.source?{source:presentation.quote.source}:{})}}
    if(saved.migration){
      if(saved.migration.status!=='pending')return
      if(saved.migration.body.text_digest!==body.text_digest){this.migrationResult(scope,recordUid,'conflict');return}
      return saved.migration.body
    }
    saved.migration={status:'pending',body}
    this.db.prepare('UPDATE self_note_quotes SET payload=? WHERE scope=? AND record_uid=? AND payload=?').run(JSON.stringify(saved),scope,recordUid,row.payload)
    const staged=this.db.prepare('SELECT payload FROM self_note_quotes WHERE scope=? AND record_uid=?').get(scope,recordUid) as {payload:string}|undefined
    return staged?JSON.parse(staged.payload).migration?.body:undefined
  }
  migrationResult(scope:string,recordUid:string,status:'done'|'conflict') {
    const row=this.db.prepare('SELECT payload FROM self_note_quotes WHERE scope=? AND record_uid=?').get(scope,recordUid) as {payload:string}|undefined
    if(!row)return
    const saved=JSON.parse(row.payload)
    if(status==='done'){this.db.prepare('DELETE FROM self_note_quotes WHERE scope=? AND record_uid=? AND payload=?').run(scope,recordUid,row.payload);return}
    saved.migration={...saved.migration,status}
    this.db.prepare('UPDATE self_note_quotes SET payload=? WHERE scope=? AND record_uid=? AND payload=?').run(JSON.stringify(saved),scope,recordUid,row.payload)
  }
  project(scope: string, recordUid: string, text: string): SelectedTextNotePresentation | undefined {
    const row = this.db.prepare('SELECT payload FROM self_note_quotes WHERE scope=? AND record_uid=?').get(scope, recordUid) as { payload: string } | undefined
    if (!row) return undefined
    try {
      const value = JSON.parse(row.payload) as { quote: unknown; header: string; kind?: 'forward'; migration?:{status?:string} }
      const quote = readSelectedTextNoteQuote(value.quote)
      if (!quote || typeof value.header !== 'string') return undefined
      return selectedTextNotePresentation(text, { quote, header: value.header, noteText: '', storage: 'local',...(value.migration?.status==='conflict'?{migrationConflict:true}:{}), ...(value.kind === 'forward' ? { kind: 'forward' } : {}) })
    } catch { return undefined }
  }
}
