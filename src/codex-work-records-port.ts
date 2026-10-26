import type { TeamCodexState,TeamCodexEventPage } from './team-codex-contract.js'
import type { MessageUnderlineChange,MessageUnderlineSnapshot } from './message-annotations.js'
import type { SelectedTextNoteQuote } from './selected-text-note.js'
import type { ArkmeMessageCopyLinkResult,ArkmeSourceSendResult } from './types.js'
export interface CodexTaskLocator{teamRef:string;id:string;sourceId?:string}
export type CodexReadRequest=
 | {action:'tasks';teamRef:string;page?:number;memberRef?:string;sourceId?:string;projectKey?:string}
 | ({action:'events';cursor?:string;before?:number;after?:string;from?:string;through?:string}&CodexTaskLocator)
 | {action:'marks';sourceRef:string;refs:string[]}
 | {action:'excerpt-source';recordUid:string}
export type CodexWatchRequest=Exclude<CodexReadRequest,{action:'excerpt-source'}>
export type CodexWriteRequest=
 | {action:'mark';sourceRef:string;ref:string;change:MessageUnderlineChange}
 | {action:'settings';teamRef:string;id:string;mode:'enable-cloud'|'disable-cloud'|'pause'|'resume';sourceName?:string}
 | {action:'excerpt';expectedAccountKey:string;recordUid:string;noteText:string;quote:SelectedTextNoteQuote}
 | ({action:'copy-link';snapshot:unknown;expectedUserId:number}&CodexTaskLocator)
 | ({action:'forward';snapshot:unknown;expectedUserId:number;targetSourceRef:string;requestId:string;recordUid:string;sendAtMillis:number;commentRecordUid?:string;commentText?:string}&CodexTaskLocator)
export type CodexWorkRequest=CodexReadRequest|CodexWriteRequest
export type CodexWorkResult=import('./record-excerpt.js').RecordExcerptOriginal|TeamCodexState|TeamCodexEventPage|{actionRef:string;snapshot:MessageUnderlineSnapshot}[]|MessageUnderlineSnapshot|ArkmeMessageCopyLinkResult|ArkmeSourceSendResult|{ok:true}
export interface CodexWorkRecordsPort{codexWorkRecords(request:CodexWorkRequest,signal?:AbortSignal):Promise<CodexWorkResult>}
