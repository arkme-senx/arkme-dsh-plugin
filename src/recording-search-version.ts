import { createHash } from 'node:crypto'
/** Public Audio contract: hash raw decrypted text, retaining whitespace and Unicode. */
export function recordingSearchVersion(item: {sessionId: string; childId: string; asrItemIndex: number; transcriptSource: string; startAtMillis: number; endAtMillis: number; text: string}): string {
  return createHash('sha256').update([item.sessionId, item.childId, item.asrItemIndex, item.transcriptSource, item.startAtMillis, item.endAtMillis, item.text].join('\n'), 'utf8').digest('hex')
}

export function recordingSearchIdentityHash(item: {sessionId:string;childId:string;itemIndex:number;transcriptSource:string}): string {
  return createHash('sha256').update(JSON.stringify([item.sessionId,item.transcriptSource,item.childId,item.itemIndex]), 'utf8').digest('hex')
}
