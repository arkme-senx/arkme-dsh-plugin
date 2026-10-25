import type { DatabaseSync } from 'node:sqlite'
import { readSelectedTextNoteQuote, selectedTextNoteHeader, selectedTextNotePresentation, type SelectedTextNoteQuote, type SelectedTextNotePresentation } from './selected-text-note.js'

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
  project(scope: string, recordUid: string, text: string): SelectedTextNotePresentation | undefined {
    const row = this.db.prepare('SELECT payload FROM self_note_quotes WHERE scope=? AND record_uid=?').get(scope, recordUid) as { payload: string } | undefined
    if (!row) return undefined
    try {
      const value = JSON.parse(row.payload) as { quote: unknown; header: string; kind?: 'forward' }
      const quote = readSelectedTextNoteQuote(value.quote)
      if (!quote || typeof value.header !== 'string') return undefined
      return selectedTextNotePresentation(text, { quote, header: value.header, noteText: '', storage: 'local', ...(value.kind === 'forward' ? { kind: 'forward' } : {}) })
    } catch { return undefined }
  }
}
