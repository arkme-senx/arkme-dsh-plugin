import type { ArkmeLongArticleImage, ArkmeLongArticleDetail, ArkmeUploadedAsset } from '../types.js'
import type { TeamContent } from '../team-app-contract.js'
import { longArticleImageDestinations } from '../long-article-content.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

export interface ComposerDocumentInput {
  expectedUserId: number
  kind: 'existing' | 'new'
  itemUid?: string
  version?: number
  title?: string
  textContent?: string
  textFormat?: 'plain' | 'markdown'
  images?: ArkmeLongArticleImage[]
}
export interface PreparedComposerDocument { content: TeamContent; fileRefs: string[] }
export async function prepareComposerDocument(runtime: ServiceRuntime, input: ComposerDocumentInput, ports: {
  own(uid: string, user: number, signal?: AbortSignal): Promise<{ detail: ArkmeLongArticleDetail }>
  local(ref: string): Promise<{ file: { fileKind: number; mimeType: string } }>
}, signal?: AbortSignal): Promise<PreparedComposerDocument> {
  const session = await runtime.requireSession()
  const fail = (message: string) => new ArkmePluginError('composer-document-invalid', message, false, 409)
  if (session.userId !== input.expectedUserId) throw fail('账号已切换，请重新选择文档')
  let title: string, text: string, format: 'plain' | 'markdown', images = input.images ?? [], assets: ArkmeUploadedAsset[] = []
  if (input.kind === 'existing') {
    const { detail } = await ports.own(input.itemUid ?? '', session.userId, signal)
    if (detail.version !== input.version) throw fail('文档已更新，请重新选择当前版本')
    title = detail.title; text = detail.textContent; format = detail.textFormat ?? 'plain'
    assets = (detail.contentBlocks ?? []).flatMap(block => block.fileAssetUid ? [{ fileAssetUid: block.fileAssetUid, fileName: block.fileName,
      mimeType: block.mimeType ?? 'image/png', size: block.size ?? 0, fileKind: 1 as const }] : [])
    images = assets.map(asset => ({ fileAssetUid: asset.fileAssetUid }))
  } else if (input.kind === 'new') { title = input.title?.trim() ?? ''; text = input.textContent ?? ''; format = input.textFormat ?? 'plain' }
  else throw fail('请选择要发送的文档')
  if (!title || title.length > 100 || !text.trim() || text.length > 40000 || images.length > 9) throw fail('文档标题、正文或图片数量无效')
  const fileRefs: string[] = []
  for (const image of images) {
    if (image.fileRef) {
      const { file } = await ports.local(image.fileRef)
      if (file.fileKind !== 1 || !file.mimeType.startsWith('image/')) throw fail('文档图片不可用，请重新添加')
      if (!fileRefs.includes(image.fileRef)) fileRefs.push(image.fileRef)
    }
  }
  if (input.kind === 'new' && images.some(image => image.fileAssetUid && !image.fileRef)) throw fail('此草稿的云端图片需要重新添加')
  for (const destination of format === 'markdown' ? longArticleImageDestinations(text) : []) {
    if (destination.url.startsWith('arkme-local:') && !fileRefs.includes(destination.url.slice('arkme-local:'.length))) throw fail('文档图片尚未准备完成')
    if (destination.url.startsWith('arkme-asset:') && !assets.some(asset => asset.fileAssetUid === destination.url.slice('arkme-asset:'.length))) throw fail('文档图片暂不可用，请重新选择')
  }
  if ((await runtime.requireSession()).userId !== session.userId) throw fail('账号已切换，请重新选择文档')
  return { fileRefs, content: { title, text_content: text, template_kind: images.length ? 2 : 1, display_kind: 1,
    content_payload: { payload_kind: images.length ? 2 : 1, schema_version: 1, text_state: 1, text_format: format,
      media_refs: assets.map((asset, index) => ({ file_asset_uid: asset.fileAssetUid, render_role: 1, content_file_role: 1, sort_order: index, file_name: asset.fileName })) } } }
}
