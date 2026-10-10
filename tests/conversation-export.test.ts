import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { ArkmeSourceItem, ArkmeTimelineCursor, ArkmeTimelineItem, ArkmeTimelinePage } from '../src/types.js'
import {
  arkmeConversationExportFileName,
  arkmeConversationExportMarkdown,
  collectArkmeConversationExportItems,
} from '../src/client/conversation-export.js'

const source: ArkmeSourceItem = {
  sourceRef: 'self', kind: 'send_to_self', displayName: '发给自己', activeAtMillis: 0, unreadCount: 0,
}

function item(uid: string, sendAtMillis: number, overrides: Partial<ArkmeTimelineItem> = {}): ArkmeTimelineItem {
  return {
    itemUid: uid, senderName: 'Tison@即我', isMe: true, sendAtMillis, title: '', textContent: '', status: 1,
    ...overrides,
  }
}

describe('conversation Markdown export', () => {
  it('keeps long-running export feedback non-blocking', () => {
    const sidebarSource = readFileSync(new URL('../src/client/ArkmeSidebar.tsx', import.meta.url), 'utf8')
    expect(sidebarSource).toContain('data-arkme-conversation-export-progress="true"')
    expect(sidebarSource).toContain("pointerEvents: 'none'")
    expect(sidebarSource).toContain('<Toast')
    expect(sidebarSource).not.toContain('conversationExport?.open')
  })

  it('reads every page, removes duplicates, and sorts from oldest to newest', async () => {
    const pages = new Map<string, ArkmeTimelinePage>([
      ['first', { source, items: [item('b', 200), item('a', 100)], hasMore: true, nextCursor: { sendAtMillis: 100, itemUid: 'a' } }],
      ['100:a', { source, items: [item('a', 100), item('c', 50)], hasMore: false }],
    ])
    const progress: number[] = []
    const result = await collectArkmeConversationExportItems(async (cursor?: ArkmeTimelineCursor) => {
      const key = cursor === undefined ? 'first' : `${String(cursor.sendAtMillis)}:${cursor.itemUid ?? ''}`
      return pages.get(key)!
    }, undefined, value => progress.push(value.itemCount))
    expect(result.map(value => value.itemUid)).toEqual(['c', 'a', 'b'])
    expect(progress).toEqual([2, 3])
  })

  it('exports complete topic paths plus voice duration and transcription', () => {
    const parent: ArkmeSourceItem = {
      sourceRef: 'parent', topicHierarchyKey: 'parent-key', kind: 'topic', displayName: '想写/可写的文章', activeAtMillis: 0, unreadCount: 0,
    }
    const child: ArkmeSourceItem = {
      sourceRef: 'child', topicHierarchyKey: 'child-key', parentTopicHierarchyKey: 'parent-key', parentSourceRef: 'parent',
      kind: 'topic', displayName: '自我表达与自我实现', activeAtMillis: 0, unreadCount: 0,
    }
    const exportedAt = new Date(2026, 8, 16, 14, 45, 30)
    const markdown = arkmeConversationExportMarkdown({ source, exportedAt, topics: [parent, child], items: [item('voice', exportedAt.getTime(), {
      textContent: '先完成再完美。', selfTopic: { topicHierarchyKey: 'child-key', title: child.displayName },
      contentBlocks: [{ kind: 'audio', mediaRef: 'voice-ref', fileName: '语音.m4a', mimeType: 'audio/mp4', size: 1, durationSec: 16, sortOrder: 0 }],
    })] })
    expect(markdown).toContain('- 语音：语音\\.m4a · 时长：00:16')
    expect(markdown).toContain('**转写内容：**\n\n先完成再完美。')
    expect(markdown).toContain('- 主题：想写/可写的文章 / 自我表达与自我实现')
    expect(arkmeConversationExportFileName(source, exportedAt, [parent, child])).toBe('发给自己-全部-20260916-144530.md')
  })

  it('states explicitly when a voice item has no transcription', () => {
    const markdown = arkmeConversationExportMarkdown({ source, exportedAt: new Date(2026, 8, 16), items: [item('voice', 1, {
      recordDurationMillis: 31_000,
      contentBlocks: [{ kind: 'audio', mediaRef: 'voice-ref', fileName: '', mimeType: 'audio/mp4', size: 1, sortOrder: 0 }],
    })] })
    expect(markdown).toContain('时长：00:31')
    expect(markdown).toContain('暂无转写内容')
  })
})
