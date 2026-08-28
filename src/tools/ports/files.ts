import type { ArkmeFilePolicy, ArkmeFileSendInput, ArkmeFileSendTask, ArkmeFileReception, ArkmeLocalFile } from '../../file-transfer-contract.js'
import type { ArkmeRecordSearchResult } from '../../types.js'
export interface ArkmeFileToolPort {
  fileCapabilities(): ArkmeFilePolicy
  fileList(): Promise<ArkmeLocalFile[]>
  fileOpenLocal(fileRef: string): Promise<import('../../file-transfer-contract.js').ArkmeFileOpenResult>
  fileSearch(options: { query?: string; limit: number; cursor?: string; signal?: AbortSignal }): Promise<ArkmeRecordSearchResult>
  fileStageBytes(contentBase64: string, metadata: Pick<ArkmeLocalFile, 'fileName' | 'mimeType'>): Promise<ArkmeLocalFile>
  fileRemove(fileRef: string): Promise<void>
  fileSend(input: ArkmeFileSendInput): Promise<ArkmeFileSendTask>
  fileSendTasks(sourceRef?: string): Promise<ArkmeFileSendTask[]>
  fileSendRetry(taskRef: string): Promise<ArkmeFileSendTask>
  fileSendDiscard(taskRef: string): Promise<void>
  fileSendReconcile(taskRef: string): Promise<ArkmeFileSendTask>
  fileReceive(mediaRef: string, start?: boolean): Promise<ArkmeFileReception>
}
