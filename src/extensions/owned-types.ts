import type { ArkmeExtensionPreviewItem, ArkmeExtensionVisibility } from './types.js'

export type ArkmeMyExtensionState = 'cordis' | 'persisted' | 'published'
export type ArkmeMyExtensionWarning = 'cloud-unavailable' | 'cordis-unavailable' | 'profile-entry-invalid'

export interface ArkmeMyExtensionItem {
  ownedRef: string
  name: string
  description: string
  states: ArkmeMyExtensionState[]
  halves: { host: boolean; client: boolean }
  cordis?: { packageCount: number; active: boolean }
  persisted?: { packageName: string; version?: string; active: boolean }
  published?: {
    extensionId: string
    version?: string
    visibility: ArkmeExtensionVisibility
    iconRef?: string
    previewImages?: ArkmeExtensionPreviewItem[]
    previewRevision?: number
  }
  publish: { allowed: boolean; mode?: 'new' | 'version'; reason?: string }
}

export interface ArkmeMyExtensionPage {
  items: ArkmeMyExtensionItem[]
  warnings: ArkmeMyExtensionWarning[]
}

export interface ArkmeMyExtensionPublishInput {
  ownedRef: string
  name: string
  description: string
  version: string
  visibility: ArkmeExtensionVisibility
  changelog?: string
  clientMutationId: string
}

export interface ArkmePreparedExtensionPublish {
  input: ArkmeMyExtensionPublishInput
  sourceFingerprint: string
}
