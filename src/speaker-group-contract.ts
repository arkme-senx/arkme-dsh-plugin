import type {ArkmeRecordingWorkbenchItem} from './types.js'
export interface SpeakerGroupMembers {items:ArkmeRecordingWorkbenchItem[];snapshotRef:string;totalCount:number;firstAt:number;lastAt:number;requiresReview:boolean;nextCursor?:string}
export interface SpeakerGroupConflict {conflictRef:string}
export interface SpeakerGroupConflictItem {item:ArkmeRecordingWorkbenchItem}
export interface SpeakerGroupPreview {conflicts:SpeakerGroupConflict[];commandRef:string;affectedCount:number;firstAt:number;lastAt:number;conflictCount:number;sourceCounts:number[];expiresAt:number}
export interface SpeakerGroupJob {conflicts:SpeakerGroupConflict[];jobRef:string;action:'apply'|'undo';state:'preview'|'queued'|'preparing'|'publishing'|'complete'|'failed'|'conflict'|'cancelled';preparedCount:number;totalCount:number;conflictCount:number;error?:string}

export interface SpeakerGroupJobs {items:SpeakerGroupJob[];nextCursor?:string}
