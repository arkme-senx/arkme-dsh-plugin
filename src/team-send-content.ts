import {arkmeBackgroundSoundContent} from './record-background-sound.js'
import type { ArkmeUploadedAsset } from './types.js'
import type { TeamContent } from './team-app-contract.js'

export function teamContentWithAssets(content: TeamContent, assets: readonly ArkmeUploadedAsset[], backgroundSound?: import('./types.js').ArkmeRichBackgroundSoundInput): TeamContent {
  if (!assets.length && !backgroundSound) return content
  const existing = content.content_payload?.media_refs
  const refs = Array.isArray(existing) ? existing : []
  const background = arkmeBackgroundSoundContent(backgroundSound,refs.length + assets.length)
  return { ...content, template_kind: assets.length ? 2 : content.template_kind, content_payload: {
    ...content.content_payload, payload_kind: assets.length ? 2 : content.content_payload?.payload_kind ?? 1, schema_version: 1, text_state: content.text_content.trim() ? 1 : 3,
    media_refs: [...refs, ...assets.map((file, index) => ({ file_asset_uid: file.fileAssetUid, render_role: 1,
      sort_order: refs.length + index, file_name: file.fileName })), ...background.refs],
    ...(background.amplitudes.length ? {background_sound_amplitudes:background.amplitudes} : {}),
  } }
}
