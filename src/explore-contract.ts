import type { ArkmeRecordingSearchIdentity, ArkmeRecordingWorkbenchItem, ArkmeSourceItem, ArkmeTimelineItem } from './types.js'

export const EXPLORE_MODULES = ['profile', 'relations', 'events', 'goals', 'anniversaries'] as const
export type ExploreModule = typeof EXPLORE_MODULES[number]
export const EXPLORE_LABELS: Record<ExploreModule | 'world', string> = {
  profile: '个人档案', relations: '关系', events: '事件', goals: '目标', anniversaries: '纪念日', world: '世界',
}
export interface ExploreItem {
  key: string
  ref: string
  title: string
  summary: string
  category: string
  status: string
  date: number
  dateLabel?: string
  linkedContactName?: string
  count?: number
}
export interface ExploreFilter { key: string; label: string; count?: number }
export interface ExploreAction {
  id: 'activate' | 'refresh' | 'pause' | 'resume' | 'correct' | 'delete' | 'confirm' | 'dismiss' | 'subscribe' | 'unsubscribe' | 'supplement' | 'create' | 'reclassify' | 'stop'
  label: string
  destructive?: boolean
}
export interface ExploreProgress { label: string; active: boolean; updatedAt: number; completed?: number; total?: number }
export interface ExplorePage {
  module: ExploreModule
  items: ExploreItem[]
  filters: ExploreFilter[]
  total: number
  nextCursor?: string
  contextRef: string
  actions: ExploreAction[]
  /** null means authorization could not be read; saved content remains readable. */
  analysisEnabled?: boolean | null
  progress?: ExploreProgress
  notice?: string
  emptyMessage?: string
}
export interface ExploreEvidence {
  key: string
  label: string
  speaker: string
  text: string
  date: number
  anchor: boolean
  ref?: string
  unavailableReason?: string
}
export interface ExploreDetail {
  item: ExploreItem
  fields: Array<{ label: string; value: string }>
  evidence: ExploreEvidence[]
  actions: ExploreAction[]
  nextCursor?: string
  dateInput?: { calendarType: 'solar' | 'lunar'; year?: number; month?: number; day?: number; leapMonth?: boolean }
  reclassifyTargets?: Array<{ref:string;label:string}>
  notice?: string
}
export interface ExploreQuery { module: ExploreModule; filter?: string; query?: string; cursor?: string }
export interface ExploreMutation { ref: string; action: ExploreAction['id']; value?: string; title?: string; calendarType?: 'solar' | 'lunar'; year?: number; month?: number; day?: number; leapMonth?: boolean; targetRef?: string }
export type ExploreSource =
  | { kind: 'record'; item: ArkmeTimelineItem }
  | { kind: 'conversation'; source: ArkmeSourceItem; itemUid: string; sendAtMillis: number }
  | { kind: 'recording'; dateStamp: number; focusItemId: string; items: ArkmeRecordingWorkbenchItem[]; playbackTargets?: Array<{itemId:string;item:ArkmeRecordingWorkbenchItem}>; segment?: ArkmeRecordingSearchIdentity }
export interface ExploreSettings {
  ref: string
  models: Array<{ ref: string; label: string; selected: boolean }>
  sources: Array<{ key: string; label: string; description: string; enabled: boolean }>
}
