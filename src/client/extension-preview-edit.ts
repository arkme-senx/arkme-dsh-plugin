import type { ArkmeExtensionPreviewItem } from '../extensions/types.js'

export type ExtensionPreviewDraftItem =
  | { kind: 'remote'; id: string; preview: ArkmeExtensionPreviewItem }
  | { kind: 'local'; id: string; file: File; mutationId: string }

export interface ExtensionPreviewDraft {
  revision: number
  initialRemoteRefs: string[]
  items: ExtensionPreviewDraftItem[]
}

export function createExtensionPreviewDraft(previews: readonly ArkmeExtensionPreviewItem[], revision: number): ExtensionPreviewDraft {
  return {
    revision,
    initialRemoteRefs: previews.map(item => item.preview_ref),
    items: previews.map(item => ({ kind: 'remote', id: item.preview_ref, preview: item })),
  }
}

export function appendExtensionPreviewFiles(
  draft: ExtensionPreviewDraft,
  files: readonly File[],
  createId: () => string,
  createMutationId: () => string,
): ExtensionPreviewDraft {
  if (draft.items.length + files.length > 20) throw new Error('扩展预览图最多只能有 20 张')
  const additions = files.map(file => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type.toLowerCase())) throw new Error('预览图只支持 PNG、JPEG 或 WebP')
    if (file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error('单张预览图必须在 5 MiB 以内')
    return { kind: 'local' as const, id: createId(), file, mutationId: createMutationId() }
  })
  return { ...draft, items: [...draft.items, ...additions] }
}

export function removeExtensionPreviewDraftItem(draft: ExtensionPreviewDraft, id: string): ExtensionPreviewDraft {
  return { ...draft, items: draft.items.filter(item => item.id !== id) }
}

export function moveExtensionPreviewDraftItem(draft: ExtensionPreviewDraft, id: string, targetIndex: number): ExtensionPreviewDraft {
  const current = draft.items.findIndex(item => item.id === id)
  if (current < 0 || !Number.isSafeInteger(targetIndex) || targetIndex < 0 || targetIndex >= draft.items.length) return draft
  const items = [...draft.items]
  const [item] = items.splice(current, 1)
  items.splice(targetIndex, 0, item!)
  return { ...draft, items }
}
