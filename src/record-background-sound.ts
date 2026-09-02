import type { ArkmeFileBackgroundSoundInput, ArkmeLocalFile } from './file-transfer-contract.js'
import type { ArkmeRichBackgroundSoundInput, ArkmeUploadedAsset } from './types.js'
import { ArkmePluginError } from './services/service.js'

const LOCAL_FILE_REF = /^arkme-file-v1\.[0-9a-f-]{36}$/
const ASSET_REF = /^[A-Za-z0-9._:-]{8,256}$/
const MAX_AMPLITUDES = 4_096

function invalid(message: string): ArkmePluginError {
  return new ArkmePluginError('background-sound-invalid', message, false, 400)
}

function invalidFile(message: string): ArkmePluginError {
  return new ArkmePluginError('background-sound-file-invalid', message, false, 400)
}

export function arkmeBackgroundSoundAmplitudes(values: readonly number[]): number[] {
  if (!Array.isArray(values) || values.length > MAX_AMPLITUDES
    || values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) {
    throw invalid('背景音振幅数量不能超过 4096，且每项必须是 0 到 1 之间的有限数字')
  }
  return [...values]
}

export function arkmeFileBackgroundSound(
  value: ArkmeFileBackgroundSoundInput | undefined,
  allFileRefs: readonly string[],
): ArkmeFileBackgroundSoundInput | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value.fileRefs) || value.fileRefs.length === 0
    || value.fileRefs.some(ref => typeof ref !== 'string' || !LOCAL_FILE_REF.test(ref))
    || new Set(value.fileRefs).size !== value.fileRefs.length) {
    throw invalid('背景音文件引用为空、重复或无效')
  }
  const allowed = new Set(allFileRefs)
  if (value.fileRefs.some(ref => !allowed.has(ref))) throw invalid('背景音文件必须属于同一发送任务')
  return { fileRefs: [...value.fileRefs], amplitudes: arkmeBackgroundSoundAmplitudes(value.amplitudes) }
}

export function assertArkmeBackgroundSoundLocalFiles(
  backgroundSound: ArkmeFileBackgroundSoundInput | undefined,
  files: readonly ArkmeLocalFile[],
): void {
  if (backgroundSound === undefined) return
  const byRef = new Map(files.map(file => [file.fileRef, file]))
  for (const ref of backgroundSound.fileRefs) {
    const file = byRef.get(ref)
    if (file === undefined || file.fileKind !== 4 || !file.mimeType.trim().toLowerCase().startsWith('audio/')) {
      throw invalidFile('背景音只能使用同一任务中已暂存的普通音频文件')
    }
  }
}

function normalizedBackgroundAsset(asset: ArkmeUploadedAsset): ArkmeUploadedAsset {
  if (asset === null || typeof asset !== 'object'
    || typeof asset.fileAssetUid !== 'string' || typeof asset.fileName !== 'string'
    || typeof asset.mimeType !== 'string') {
    throw invalidFile('背景音资产参数无效')
  }
  const fileAssetUid = asset.fileAssetUid.trim()
  const fileName = asset.fileName.trim()
  const mimeType = asset.mimeType.trim().toLowerCase()
  if (!ASSET_REF.test(fileAssetUid) || fileName === '' || fileName.length > 255
    || mimeType.length > 200 || !mimeType.startsWith('audio/') || ![2, 4].includes(asset.fileKind)
    || !Number.isSafeInteger(asset.size) || asset.size < 0) {
    throw invalidFile('背景音只能使用已上传完成的音频资产')
  }
  return { fileAssetUid, fileName, mimeType, size: asset.size, fileKind: asset.fileKind }
}

export function arkmeRichBackgroundSound(
  value: ArkmeRichBackgroundSoundInput | undefined,
): ArkmeRichBackgroundSoundInput | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value.assets) || value.assets.length === 0 || value.assets.length > 20) {
    throw invalid('背景音资产为空或数量超限')
  }
  const assets = value.assets.map(normalizedBackgroundAsset)
  const identities = assets.map(asset => asset.fileAssetUid)
  if (new Set(identities).size !== identities.length) throw invalid('背景音资产不能重复')
  return { assets, amplitudes: arkmeBackgroundSoundAmplitudes(value.amplitudes) }
}
