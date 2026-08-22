import type { ArkmeExtensionPreviewItem, ArkmeExtensionShare, ArkmeExtensionSource, ArkmeExtensionVisibility } from './types.js'

export type ArkmeMyExtensionState = 'cordis' | 'persisted' | 'published'
export type ArkmeMyExtensionWarning = 'cloud-unavailable' | 'cordis-unavailable' | 'profile-entry-invalid'
export type ArkmeExtensionPublishRoute = 'dynamic-cordis-v2' | 'profile-native-v3'
export type ArkmeExtensionPublishArtifactKind = 'dsh-bundle-tgz' | 'dsh-native-package-tgz'

export type ArkmeMyExtensionPublishState =
  | {
      allowed: true
      mode: 'new' | 'version'
      route: ArkmeExtensionPublishRoute
      artifactContractVersion: 2 | 3
      artifactKind: ArkmeExtensionPublishArtifactKind
    }
  | { allowed: false; reason: string }

export interface ArkmeMyExtensionItem {
  ownedRef: string
  name: string
  description: string
  states: ArkmeMyExtensionState[]
  halves: { host: boolean; client: boolean }
  cordis?: { packageCount: number; active: boolean }
  persisted?: { packageName: string; version?: string; active: boolean; artifactContractVersion?: 2 | 3 }
  published?: {
    extensionId: string
    version?: string
    visibility: ArkmeExtensionVisibility
    iconRef?: string
    previewImages?: ArkmeExtensionPreviewItem[]
    previewRevision?: number
		source?: ArkmeExtensionSource
		share?: ArkmeExtensionShare
  }
  publish: ArkmeMyExtensionPublishState
}

export interface ArkmeMyExtensionPage {
  items: ArkmeMyExtensionItem[]
  warnings: ArkmeMyExtensionWarning[]
}

export interface ArkmeMyExtensionPublishInput {
  ownedRef: string
  extensionId?: string
  name: string
  description: string
  version: string
  visibility: ArkmeExtensionVisibility
  changelog?: string
	githubRepositoryUrl?: string
  clientMutationId: string
}

export interface ArkmePreparedExtensionPublish {
  input: ArkmeMyExtensionPublishInput
  sourceFingerprint: string
  publishRoute: ArkmeExtensionPublishRoute
  artifactContractVersion: 2 | 3
  artifactKind: ArkmeExtensionPublishArtifactKind
  nativeCapabilities?: import('./types.js').ArkmeNativeCapability[]
}
