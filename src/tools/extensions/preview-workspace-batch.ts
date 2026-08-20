import type { Agent } from '@deepseek-ai/dsh-agent'
import { readWorkspaceExtensionPreview } from '../../extensions/workspace-icon.js'
import type { ArkmeExtensionManager } from '../../extensions/manager.js'
import {
  addResolvedPreviewBatch,
  previewImageDigest,
  type PreviewBatchResult,
  type ResolvedPreviewImage,
} from './preview-batch.js'

export async function resolvePreviewWorkspaceImages(input: {
  workspacePaths: readonly string[]
  agent: Agent
  signal?: AbortSignal
}): Promise<ResolvedPreviewImage[]> {
  if (input.workspacePaths.length === 0 || input.workspacePaths.length > 20
    || new Set(input.workspacePaths).size !== input.workspacePaths.length) {
    throw new Error('workspace_paths must contain 1 to 20 unique relative image paths')
  }

  const resolved: ResolvedPreviewImage[] = []
  const contentDigests = new Set<string>()
  for (const [offset, path] of input.workspacePaths.entries()) {
    input.signal?.throwIfAborted()
    const image = await readWorkspaceExtensionPreview(input.agent, path, input.signal)
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mediaType)) {
      throw new Error(`第 ${String(offset + 1)} 张工作区图片不符合 PNG/JPEG/WebP、5 MiB 预览图限制`)
    }
    const digest = previewImageDigest(image.data)
    if (contentDigests.has(digest)) throw new Error('workspace_paths cannot contain duplicate image content')
    contentDigests.add(digest)
    resolved.push({
      index: offset + 1,
      mediaType: image.mediaType as 'image/png' | 'image/jpeg' | 'image/webp',
      data: image.data,
      digest,
    })
  }
  return resolved
}

export async function addPreviewWorkspaceBatch(input: {
  extensionId: string
  workspacePaths: readonly string[]
  agent: Agent
  manager: ArkmeExtensionManager
  signal?: AbortSignal
}): Promise<PreviewBatchResult> {
  const images = await resolvePreviewWorkspaceImages(input)
  return await addResolvedPreviewBatch({
    extensionId: input.extensionId,
    images,
    manager: input.manager,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
}
