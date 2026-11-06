import type { ArkmeContentBlock, ArkmeMessageSnapshotDetail, ArkmeFileAssetDisplayItem, ArkmeRecordSearchResult, ArkmeSearchRecordItem, ArkmeSearchSceneKind, ArkmeTimelineAroundPage, ArkmeTimelineItem } from '../types.js'
import { callArkme } from './api.js'

export type ConversationSearchScope = { kind: 'global' } | { kind: 'conversation'; sourceRef: string }
export type ConversationSearchQuery = { kind: 'keyword'; text: string } | { kind: 'scene'; scene: ArkmeSearchSceneKind }

export interface ConversationSearchReadPort {
  search(scope: ConversationSearchScope, query: ConversationSearchQuery, cursor: string | undefined, signal: AbortSignal): Promise<ArkmeRecordSearchResult>
  readChatMessage(item: ArkmeSearchRecordItem, signal: AbortSignal): Promise<ArkmeTimelineItem>
  readOwnAssetDisplays(fileAssetUids: string[], signal: AbortSignal, onBatch: (items: ArkmeFileAssetDisplayItem[]) => void): Promise<void>
}

/** Dynamic-photo motion is already authorized with its cover, but has its own search asset identity. */
export function conversationSearchAttachments(item: Pick<ArkmeTimelineItem, 'contentBlocks'>): ArkmeContentBlock[] {
  return (item.contentBlocks ?? []).flatMap(block => block.dynamicPhoto?.motion ? [block, block.dynamicPhoto.motion] : [block])
}

export const conversationSearchReadPort: ConversationSearchReadPort = {
  async search(scope, query, cursor, signal) {
    return await callArkme<ArkmeRecordSearchResult>(query.kind === 'scene' ? 'search.scene' : 'search.records', {
      ...(query.kind === 'scene' ? { scene: query.scene, limit: 30 } : { query: query.text, limit: 50 }),
      ...(scope.kind === 'global' ? {} : { sourceRef: scope.sourceRef }),
      ...(cursor === undefined ? {} : { cursor }),
    }, signal)
  },
  async readChatMessage(item, signal) {
    if (item.sourceKind !== 3) throw new Error('仅聊天搜索结果支持读取原消息')
    if (item.targetSource === undefined) throw new Error('原会话暂不可访问，请返回后重试')
    if (item.recordOwnerUserId === undefined) throw new Error('搜索结果缺少消息归属，请返回重新搜索')
    const page = await callArkme<ArkmeTimelineAroundPage>('source.timeline-around', {
      sourceRef: item.targetSource.sourceRef, itemUid: item.recordUid, recordOwnerUserId: item.recordOwnerUserId,
      beforeLimit: 1, afterLimit: 1,
    }, signal)
    signal.throwIfAborted()
    const target = page.items.find(value => value.itemUid === item.recordUid
      && (value.recordOwnerUserId === undefined || String(value.recordOwnerUserId) === String(item.recordOwnerUserId)))
    if (target === undefined) throw new Error('原消息已删除或暂不可访问')
    const expected = [...(item.media ?? []), ...(item.files ?? []), ...(item.voice ? [item.voice] : [])]
    const displayed = new Set(conversationSearchAttachments(target).filter(block => block.mediaRef).map(block => block.fileAssetUid))
    if (!target.messageActionRef || expected.every(asset => displayed.has(asset.fileAssetUid))) return target
    // Around pages may omit delivery URLs. Reuse the relation-bound attachment
    // owner; another sender's assets must never use the viewer's private file API.
    const snapshot = await callArkme<ArkmeMessageSnapshotDetail>('source.message-snapshot.detail', {
      sourceRef: item.targetSource.sourceRef, actionRef: target.messageActionRef, includeAttachments: true,
    }, signal)
    signal.throwIfAborted()
    if (snapshot.itemUid !== item.recordUid) throw new Error('原消息附件身份不匹配，请重试')
    return { ...target, contentBlocks: snapshot.contentBlocks ?? [], ...(snapshot.mediaUnavailable === undefined ? {} : { mediaUnavailable: snapshot.mediaUnavailable }) }
  },
  async readOwnAssetDisplays(fileAssetUids, signal, onBatch) {
    const uids = [...new Set(fileAssetUids)]
    for (let offset = 0; offset < uids.length; offset += 50) {
      signal.throwIfAborted()
      try {
        const display = await callArkme<ArkmeFileAssetDisplayItem[]>('files.assets', { fileAssetUids: uids.slice(offset, offset + 50) }, signal)
        signal.throwIfAborted()
        onBatch(display)
      } catch (error) {
        if (signal.aborted) throw error
        // Optional thumbnails do not prevent reading the original result.
      }
    }
  },
}
