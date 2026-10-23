import type { ArkmeMessageQuote } from './message-quote.js'
import type { MessageUnderlineSnapshot } from './message-annotations.js'

export interface NativeAnnotationTarget { runtimeRef?: string; sessionRef: string; eventSeq: number; role: 'user' | 'assistant' }
export interface NativeAnnotationContext extends NativeAnnotationTarget { messageRef: string; canonicalText: string; sourceDigest: string }
export type NativeAnnotationRequest =
  | { action: 'capabilities' }
  | { action: 'contexts'; targets: NativeAnnotationTarget[] }
  | { action: 'list'; messageRefs: string[] }
  | { action: 'changes'; watches: { messageRef: string; revision: number }[] }
  | { action: 'add'; messageRef: string; operationId: string; anchor: ArkmeMessageQuote }
  | { action: 'remove'; messageRef: string; operationId: string; annotationId: string }
export interface NativeAnnotationCapabilities { supported: boolean; protocolVersion: 1; maxLength: number; refreshMillis: number }
export type NativeAnnotationSnapshot = MessageUnderlineSnapshot & { messageRef: string; syncState?: 'synced' | 'cached' }
export interface NativeAnnotationsPort { nativeAnnotations(request: NativeAnnotationRequest, signal?: AbortSignal): Promise<unknown> }
