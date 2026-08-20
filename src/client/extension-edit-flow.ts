import type {
  ArkmeExtensionCatalogItem, ArkmeExtensionIconResult, ArkmeExtensionMetadataUpdateInput, ArkmeExtensionPreviewGallery,
} from '../extensions/types.js'
import type { ArkmeExtensionEditFormValue } from './ArkmeExtensionEditDialog.js'
import type { ArkmeMyExtensionItem } from '../extensions/owned-types.js'
import type { ExtensionPreviewDraft, ExtensionPreviewDraftItem } from './extension-preview-edit.js'

export interface ExtensionEditMutation {
  signature: string
  id: string
}

export function nextExtensionEditMutation(
  previous: ExtensionEditMutation | undefined,
  extensionId: string,
  value: Pick<ArkmeExtensionEditFormValue, 'name' | 'description' | 'visibility'>,
  createId: () => string,
): ExtensionEditMutation {
  const signature = JSON.stringify([extensionId, value.name.trim(), value.description.trim(), value.visibility])
  return previous?.signature === signature ? previous : { signature, id: createId() }
}

export type ExtensionEditSaveResult =
  | { kind: 'saved'; extension: ArkmeExtensionCatalogItem; icon?: ArkmeExtensionIconResult; previews?: ArkmeExtensionPreviewGallery }
  | { kind: 'metadata-saved-icon-failed'; extension: ArkmeExtensionCatalogItem; error: string }
  | { kind: 'profile-saved-preview-failed'; extension: ArkmeExtensionCatalogItem; icon?: ArkmeExtensionIconResult; previews?: ArkmeExtensionPreviewGallery; previewDraft: ExtensionPreviewDraft; error: string }

function reconciledPreviewDraft(
  draft: ExtensionPreviewDraft,
  gallery: ArkmeExtensionPreviewGallery,
  appliedRefs: ReadonlyMap<string, string>,
): ExtensionPreviewDraft {
  const server = new Map(gallery.preview_images.map(item => [item.preview_ref, item]))
  const items: ExtensionPreviewDraftItem[] = []
  const included = new Set<string>()
  for (const item of draft.items) {
    const ref = item.kind === 'remote' ? item.preview.preview_ref : appliedRefs.get(item.id)
    const preview = ref === undefined ? undefined : server.get(ref)
    if (preview !== undefined) {
      items.push({ kind: 'remote', id: preview.preview_ref, preview })
      included.add(preview.preview_ref)
    } else if (item.kind === 'local') items.push(item)
  }
  for (const preview of gallery.preview_images) if (!included.has(preview.preview_ref)) {
    items.push({ kind: 'remote', id: preview.preview_ref, preview })
  }
  return {
    revision: gallery.preview_revision,
    initialRemoteRefs: gallery.preview_images.map(item => item.preview_ref),
    items,
  }
}

export function applyEditedMyExtension(
  item: ArkmeMyExtensionItem,
  extension: ArkmeExtensionCatalogItem,
): ArkmeMyExtensionItem {
  if (item.published?.extensionId !== extension.extension_id) return item
  return {
    ...item,
    name: extension.name,
    description: extension.description,
    published: {
      ...item.published,
      visibility: extension.visibility,
      ...(extension.icon_ref === undefined ? {} : { iconRef: extension.icon_ref }),
      ...(extension.preview_images === undefined ? {} : { previewImages: extension.preview_images }),
      ...(extension.preview_revision === undefined ? {} : { previewRevision: extension.preview_revision }),
    },
  }
}

export async function saveExtensionEdit(input: {
  extension: ArkmeExtensionCatalogItem
  value: ArkmeExtensionEditFormValue
  clientMutationId: string
}, dependencies: {
  updateMetadata(extensionId: string, input: ArkmeExtensionMetadataUpdateInput): Promise<ArkmeExtensionCatalogItem>
  setIcon(extensionId: string, file: File): Promise<ArkmeExtensionIconResult>
  addPreview?(extensionId: string, file: File, mutationId: string): Promise<ArkmeExtensionPreviewGallery>
  deletePreview?(extensionId: string, previewRef: string, revision: number): Promise<ArkmeExtensionPreviewGallery>
  reorderPreviews?(extensionId: string, refs: string[], revision: number): Promise<ArkmeExtensionPreviewGallery>
}): Promise<ExtensionEditSaveResult> {
  const normalized = {
    name: input.value.name.trim(),
    description: input.value.description.trim(),
    visibility: input.value.visibility,
  }
  const metadataChanged = normalized.name !== input.extension.name
    || normalized.description !== input.extension.description
    || normalized.visibility !== input.extension.visibility
  const extension = metadataChanged
    ? await dependencies.updateMetadata(input.extension.extension_id, {
        ...normalized,
        clientMutationId: input.clientMutationId,
      })
    : input.extension
  let icon: ArkmeExtensionIconResult | undefined
  if (input.value.iconFile !== undefined) {
    try {
      icon = await dependencies.setIcon(input.extension.extension_id, input.value.iconFile)
    } catch (error) {
      if (!metadataChanged) throw error
      return { kind: 'metadata-saved-icon-failed', extension, error: error instanceof Error ? error.message : String(error) }
    }
  }
  const withIcon = icon === undefined ? extension : { ...extension, icon_ref: icon.icon_ref, updated_at: icon.updated_at }
  const draft = input.value.previewDraft
  if (draft === undefined) return { kind: 'saved', extension: withIcon, ...(icon === undefined ? {} : { icon }) }
  if ((input.extension.preview_revision ?? draft.revision) !== draft.revision) {
    throw new Error('预览图已在其他位置更新，请刷新后重新编辑')
  }
  let gallery: ArkmeExtensionPreviewGallery = {
    extension_id: input.extension.extension_id,
    preview_images: draft.items.filter(item => item.kind === 'remote').map(item => item.preview),
    preview_revision: draft.revision,
  }
  const refs = new Map(draft.items.filter(item => item.kind === 'remote').map(item => [item.id, item.preview.preview_ref]))
  try {
    const desiredRemote = new Set(draft.items.filter(item => item.kind === 'remote').map(item => item.preview.preview_ref))
    for (const ref of draft.initialRemoteRefs.filter(ref => !desiredRemote.has(ref)
      && gallery.preview_images.some(item => item.preview_ref === ref))) {
      if (dependencies.deletePreview === undefined) throw new Error('preview delete adapter unavailable')
      gallery = await dependencies.deletePreview(input.extension.extension_id, ref, gallery.preview_revision)
    }
    for (const item of draft.items) if (item.kind === 'local') {
      if (dependencies.addPreview === undefined) throw new Error('preview upload adapter unavailable')
      const before = new Set(gallery.preview_images.map(current => current.preview_ref))
      gallery = await dependencies.addPreview(input.extension.extension_id, item.file, item.mutationId)
      const applied = gallery.applied_preview_ref ?? gallery.preview_images.find(current => !before.has(current.preview_ref))?.preview_ref
      if (applied === undefined) throw new Error('preview upload response is missing the applied ref')
      refs.set(item.id, applied)
    }
    const ordered = draft.items.map(item => refs.get(item.id)).filter((ref): ref is string => ref !== undefined)
    const current = gallery.preview_images.map(item => item.preview_ref)
    if (ordered.length > 0 && JSON.stringify(ordered) !== JSON.stringify(current)) {
      if (dependencies.reorderPreviews === undefined) throw new Error('preview reorder adapter unavailable')
      gallery = await dependencies.reorderPreviews(input.extension.extension_id, ordered, gallery.preview_revision)
    }
    const updated = { ...withIcon, preview_images: gallery.preview_images, preview_revision: gallery.preview_revision }
    return { kind: 'saved', extension: updated, ...(icon === undefined ? {} : { icon }), previews: gallery }
  } catch (error) {
    if (!metadataChanged && icon === undefined && gallery.preview_revision === draft.revision) throw error
    return {
      kind: 'profile-saved-preview-failed',
      extension: { ...withIcon, preview_images: gallery.preview_images, preview_revision: gallery.preview_revision },
      ...(icon === undefined ? {} : { icon }), previews: gallery, previewDraft: reconciledPreviewDraft(draft, gallery, refs),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
