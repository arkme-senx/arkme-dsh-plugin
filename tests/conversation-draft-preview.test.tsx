import { afterEach, describe, expect, it } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { ArkmeSourceItem } from '../src/types.js'
import { ArkmeRootChatPreview, ArkmeArkoRow } from '../src/client/ArkmeVirtualWorkspace.js'
import { ArkmeSelfConversationDraftPreview } from '../src/client/ArkmeConversationDraftPreview.js'
import { conversationDraftPreview, selfConversationDraftPreview } from '../src/client/conversation-draft-preview.js'
import { ArkmeComposerDraftStore, arkmeComposerDraftStore as drafts, arkmeSourceComposerDraftKey as key, arkmeArkoComposerDraftKey } from '../src/client/composer-draft-store.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { resetSelfTopicDirectories, selfTopicDirectory } from '../src/client/self-topic-directory-cache.js'
import { arkmeTheme } from '../src/client/arkme-theme.js'
import { arkmeDefaultEmojis } from '../src/client/arkme-emoji.js'

const source = (kind: ArkmeSourceItem['kind'], id: string, displayName = id): ArkmeSourceItem => ({ kind, sourceRef: id, sourceKey: id, displayName, activeAtMillis: 1, latestPreview: '最新消息', unreadCount: 3 })
const privateChat = source('private_chat', 'private')
const group = source('group_chat', 'group')
const self = source('send_to_self', 'self')
const topic = { ...source('topic', 'topic', '工作待办'), topicHierarchyKey: 'topic-stable' }
let mounted: ReactTestRenderer | undefined
afterEach(() => {
  act(() => { mounted?.unmount(); drafts.clearAccount(42); drafts.clearAccount(43); arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' }) })
  mounted = undefined; resetSelfTopicDirectories()
})
function login(userId = 42) { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId }) }
function html() { return JSON.stringify(mounted?.toJSON()) }

describe('conversation draft preview', () => {
  it('updates a mounted row immediately, keeps drafts isolated and restores the latest message on clear', () => {
    act(() => { login(); mounted = create(<><ArkmeRootChatPreview source={privateChat} /><ArkmeRootChatPreview source={group} /></>) })
    act(() => { drafts.setText(key(42, privateChat), '明天下午\n再确认') })
    expect(html()).toContain('明天下午 再确认')
    expect(mounted!.root.findAllByProps({ 'data-arkme-draft-preview': true })).toHaveLength(1)
    const marker = mounted!.root.findByProps({ 'data-arkme-draft-preview': true }).findAllByType('span')[1]!
    expect(marker.props.style.color).toBe(arkmeTheme.danger)
    expect(marker.children).toEqual(['[草稿]'])
    // A newer incoming message must not conceal unfinished input.
    act(() => { mounted!.update(<ArkmeRootChatPreview source={{ ...privateChat, latestPreview: '新收到的消息', activeAtMillis: Date.now() }} />) })
    expect(html()).toContain('[草稿]'); expect(html()).not.toContain('新收到的消息')
    act(() => { drafts.setText(key(42, privateChat), '') })
    expect(html()).not.toContain('[草稿]'); expect(html()).toContain('新收到的消息')
  })

  it('removes a submitted draft and immediately shows it again after failed-send restoration', () => {
    act(() => { login(); drafts.setText(key(42, group), '待发送'); mounted = create(<ArkmeRootChatPreview source={group} />) })
    let submitted = drafts.get(undefined)
    act(() => { submitted = drafts.take(key(42, group)) })
    expect(html()).not.toContain('[草稿]')
    act(() => { drafts.restore(key(42, group), submitted) })
    expect(html()).toContain('待发送')
  })

  it('does not expose another account draft on the same conversation', () => {
    act(() => { login(); drafts.setText(key(42, group), '私有草稿'); mounted = create(<ArkmeRootChatPreview source={group} />) })
    act(() => { login(43) })
    expect(html()).not.toContain('私有草稿'); expect(html()).not.toContain('[草稿]')
  })

  it('uses the existing Arko draft owner too', () => {
    act(() => { login(); mounted = create(<ArkmeArkoRow selected={false} onClick={() => {}} />) })
    act(() => { drafts.setText(arkmeArkoComposerDraftKey(42), '请整理今天的录音') })
    expect(html()).toContain('[草稿]'); expect(html()).toContain('请整理今天的录音')
  })

  it('shows file-only drafts, strips markdown syntax and preserves emoji-only drafts', () => {
    const store = new ArkmeComposerDraftStore(), k = key(42, group)
    store.appendAttachments(k, [{ asset: { fileAssetUid: 'file', fileName: '需求说明.pdf', mimeType: 'application/pdf', size: 10 } }])
    expect(conversationDraftPreview(store.get(k))).toBe('[文件] 需求说明.pdf')
    store.clear(k)
    store.setText(k, '   '); expect(conversationDraftPreview(store.get(k))).toBeUndefined()
    const base = store.get(undefined)
    expect(conversationDraftPreview({ ...base, text: '标题', markdown: { source: '**标题**', mentions: [], document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '标题' }] }] } } })).toBe('标题')
    const emoji = arkmeDefaultEmojis[0]!
    expect(conversationDraftPreview({ ...base, text: '\uFFFC', emojis: [{ emojiId: emoji.id, startIndex: 0 }] })).toBeTruthy()
  })

  it('aggregates the most recently edited visible personal topic and falls back after it is cleared', () => {
    const store = new ArkmeComposerDraftStore()
    store.setText(key(42, self), '主输入框')
    store.setText(key(42, topic), '主题输入框')
    expect(selfConversationDraftPreview(store, 42, [self, topic])?.preview).toBe('工作待办 · 主题输入框')
    store.setText(key(42, self), '更新的主输入框')
    expect(selfConversationDraftPreview(store, 42, [self, topic])?.preview).toBe('更新的主输入框')
    store.clear(key(42, self))
    expect(selfConversationDraftPreview(store, 42, [self, topic])?.source).toBe(topic)
    expect(selfConversationDraftPreview(store, 42, [self])).toBeUndefined()
    expect(selfConversationDraftPreview(store, 43, [self, topic])).toBeUndefined()
  })

  it('reacts to topic metadata changes and hides a draft belonging to an archived topic', () => {
    act(() => {
      login(); selfTopicDirectory(42, 'test').upsert(topic)
      mounted = create(<ArkmeSelfConversationDraftPreview source={self} fallback={<span>最新消息</span>} />)
      drafts.setText(key(42, topic), '还没完成')
    })
    expect(html()).toContain('工作待办 · 还没完成')
    act(() => { selfTopicDirectory(42, 'test').upsert({ ...topic, displayName: '新主题名' }) })
    expect(html()).toContain('新主题名 · 还没完成')
    act(() => { selfTopicDirectory(42, 'test').beginArchive(topic) })
    expect(html()).not.toContain('[草稿]'); expect(html()).toContain('最新消息')
  })
})
