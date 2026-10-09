import type { ArkmeUploadedAsset } from './types.js'
import type { TeamContent } from './team-app-contract.js'

export function teamContentWithAssets(content: TeamContent, assets: readonly ArkmeUploadedAsset[]): TeamContent {
  if (!assets.length) return content
  const existing = content.content_payload?.media_refs
  const refs = Array.isArray(existing) ? existing : []
  return { ...content, template_kind: 2, content_payload: {
    ...content.content_payload, payload_kind: 2, schema_version: 1, text_state: content.text_content.trim() ? 1 : 3,
    media_refs: [...refs, ...assets.map((file, index) => ({ file_asset_uid: file.fileAssetUid, render_role: 1,
      sort_order: refs.length + index, file_name: file.fileName }))],
  } }
}
