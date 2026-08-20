import type {
  ArkmeExtensionCatalogItem, ArkmeExtensionIconResult, ArkmeExtensionMetadataUpdateInput,
} from '../extensions/types.js'
import type { ArkmeExtensionEditFormValue } from './ArkmeExtensionEditDialog.js'
import type { ArkmeMyExtensionItem } from '../extensions/owned-types.js'

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
  | { kind: 'saved'; extension: ArkmeExtensionCatalogItem; icon?: ArkmeExtensionIconResult }
  | { kind: 'metadata-saved-icon-failed'; extension: ArkmeExtensionCatalogItem; error: string }

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
  if (input.value.iconFile === undefined) return { kind: 'saved', extension }
  try {
    const icon = await dependencies.setIcon(input.extension.extension_id, input.value.iconFile)
    return { kind: 'saved', extension: { ...extension, icon_ref: icon.icon_ref, updated_at: icon.updated_at }, icon }
  } catch (error) {
    if (!metadataChanged) throw error
    return {
      kind: 'metadata-saved-icon-failed',
      extension,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
