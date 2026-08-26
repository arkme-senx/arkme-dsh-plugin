import type { ArkmeSearchRecordItem, ArkmeTimelineItem } from '../../../src/types.js'

export const source = { sourceRef: 'fixture-source', kind: 'group_chat' as const, displayName: '语音验收', activeAtMillis: 1, unreadCount: 0 }
export const notes: ArkmeTimelineItem[] = ['123456。', '测试一下。', '测试。', '长语音转写自然换行，内容可以选中。'.repeat(24)].map((textContent, index) => ({
  itemUid: `fixture-${index}`, senderName: 'lucis', isMe: false, sendAtMillis: 1, status: 1, templateKind: index === 3 ? 4 : 3, title: '', textContent,
  contentBlocks: [{ kind: 'audio', mediaRef: `fixture-voice-${index}`, fileAssetUid: `fixture-asset-${index}`, fileName: index === 0 ? '语音.m4a' : '语音.wav', mimeType: index === 0 ? 'audio/mp4' : 'audio/wav', size: 64044, sortOrder: 0, ...(index === 2 ? {} : { durationSec: 2 }) }],
}))
export const hits: ArkmeSearchRecordItem[] = notes.map((note, index) => ({
  recordUid: note.itemUid, sourceKind: 3, sourceUid: 'fixture-source', routeTargetKind: 'chat_timeline', sendAtMillis: 1,
  title: '', nickname: note.senderName, textContent: note.textContent, snippet: note.textContent, templateKind: note.templateKind, media: [], files: [],
  voice: { fileAssetUid: `fixture-asset-${index}`, ...(index === 2 ? {} : { mediaRef: `fixture-voice-${index}`, durationMillis: 2000 }) },
  targetSource: source, sourceTitle: source.displayName,
}))
