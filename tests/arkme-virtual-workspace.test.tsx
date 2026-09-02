import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  arkmeOfficialAuthorSource,
  arkmeRootDirectoryLoadState,
  botActivityAtMillis,
  sortArkmeBotsByCreatedAt,
} from '../src/client/ArkmeVirtualWorkspace.js'

const workspaceSource = readFileSync(new URL('../src/client/ArkmeVirtualWorkspace.tsx', import.meta.url), 'utf8')

describe('Arkme conversation directory load state', () => {
  it('shows a blocking loader only while there is no usable directory content', () => {
    expect(arkmeRootDirectoryLoadState({
      authenticated: true, directory: 'root', baselineReady: false, isRefreshing: true, hasSources: false, error: '',
    })).toBe('loading')
    expect(arkmeRootDirectoryLoadState({
      authenticated: true, directory: 'root', baselineReady: false, isRefreshing: true, hasSources: true, error: '',
    })).toBe('updating')
    expect(arkmeRootDirectoryLoadState({
      authenticated: true, directory: 'root', baselineReady: false, isRefreshing: false, hasSources: true, error: 'network unavailable',
    })).toBe('error')
    expect(arkmeRootDirectoryLoadState({
      authenticated: true, directory: 'root', baselineReady: true, isRefreshing: true, hasSources: true, error: '',
    })).toBe('updating')
    expect(arkmeRootDirectoryLoadState({
      authenticated: true, directory: 'root', baselineReady: true, isRefreshing: false, hasSources: true, error: '',
    })).toBe('idle')
  })

  it('keeps embedded directory refresh failures out of the visible sidebar', () => {
    const embeddedStatuses = workspaceSource.slice(
      workspaceSource.indexOf("rootDirectoryState === 'loading'"),
      workspaceSource.indexOf('{lockedDirectory ? <>'),
    )
    expect(embeddedStatuses).not.toContain("rootDirectoryState === 'error'")
    expect(embeddedStatuses).not.toContain('加载失败')
    expect(embeddedStatuses).not.toContain('重试')
  })

  it('opens and selects the new Bot through its dedicated private-chat surface', () => {
    expect(workspaceSource).toContain('const createdQuickAddBot = async (bot: ArkmeBotSummary): Promise<void> =>')
    expect(workspaceSource).toContain('setBots(current => sortArkmeBotsByCreatedAt([bot, ...current.filter(item => item.botRef !== bot.botRef)]))')
    expect(workspaceSource).toContain('arkmeUi.openBotConversation(bot)')
    expect(workspaceSource).toContain('const badgeUnreadCount = arkmeBadgeUnreadCount(bot)')
    expect(workspaceSource).toContain("unreadPlacement === 'avatar' && <span style={styles.mentionUnread}")
    expect(workspaceSource).toContain("unreadPlacement === 'dot' && <span style={styles.mutedUnreadDot}")
    expect(workspaceSource).toContain('bot.isMuted === true')
    expect(workspaceSource).toContain("callArkme<{ items: ArkmeBotSummary[] }>('bots.private-chat.directory'")
  })

  it('keeps Bot entries in newest-first creation order', () => {
    expect(sortArkmeBotsByCreatedAt([
      { botRef: 'older', name: '旧 Bot', provider: 'openclaw', description: '', status: 'offline', directChatAvailable: true, createdAtMillis: 100 },
      { botRef: 'newer', name: '新 Bot', provider: 'openclaw', description: '', status: 'offline', directChatAvailable: true, createdAtMillis: 200 },
    ]).map(item => item.botRef)).toEqual(['newer', 'older'])
  })

  it('uses the newer of a Bot creation and message time in the shared conversation order', () => {
    expect(botActivityAtMillis({
      botRef: 'bot', name: 'Bot', provider: 'openclaw', description: '', status: 'offline', directChatAvailable: true,
      createdAtMillis: 100, latestMessageAtMillis: 200,
    })).toBe(200)
  })

  it('keeps the Bot badge beside its name while the activity time stays at the right edge', () => {
    expect(workspaceSource).toContain('<span style={styles.entryName}>{bot.name}</span><span style={styles.botBadge}>BOT</span>')
    expect(workspaceSource).toContain("<span style={{ ...styles.chatTime, marginLeft: 'auto' }}>{timeLabel(row.activeAtMillis)}</span>")
  })

  it('announces unread counts on the row while keeping avatar badges decorative', () => {
    expect(workspaceSource).toContain('`${bot.name}，${String(badgeUnreadCount)} 条未读`')
    expect(workspaceSource).toContain('`${source.displayName}，${String(badgeUnreadCount)} 条未读`')
    expect(workspaceSource).toContain('<span style={styles.sourceAvatarWrap} aria-hidden>')
  })

  it('uses 38px avatars consistently in the conversation directory', () => {
    expect(workspaceSource).toContain("sourceAvatarWrap: { width: 38, height: 38")
    expect(workspaceSource.match(/<ArkmeMark size=\{38\} \/>/g)).toHaveLength(3)
    expect(workspaceSource).toContain('<ArkmeSendToSelfIcon size={38} />')
    expect(workspaceSource).toContain('<ArkmeDirectorySourceAvatar source={source} size={38} />')
  })

  it('does not own account-scoped avatar or periodic presentation infrastructure', () => {
    expect(workspaceSource).not.toContain('avatarCacheUserIdRef')
    expect(workspaceSource).not.toContain('arkmeAvatarImages')
    expect(workspaceSource).not.toContain('10 * 60 * 1000')
  })

  it('renders every eligible unread badge on the avatar and never beside the preview', () => {
    expect(workspaceSource).toContain("if (arkmeBadgeUnreadCount(source) > 0) return 'avatar'")
    expect(workspaceSource).toContain("? 'dot'")
    expect(workspaceSource).not.toContain("unreadPlacement === 'inline'")
  })

  it('renders the muted unread dot in unread red instead of mention green', () => {
    const mutedUnreadDotStyle = workspaceSource.slice(
      workspaceSource.indexOf('mutedUnreadDot: {'),
      workspaceSource.indexOf('avatar: {', workspaceSource.indexOf('mutedUnreadDot: {')),
    )
    expect(mutedUnreadDotStyle).toContain("background: '#ff5f57'")
    expect(mutedUnreadDotStyle).not.toContain('background: colors.mention')
  })

  it('shows the shared notification permission recovery prompt above root conversations', () => {
    expect(workspaceSource).toContain("import { ArkmeNotificationPermissionBanner }")
    expect(workspaceSource).toContain('authenticated && <ArkmeNotificationPermissionBanner />')
  })

  it('hides the contact-author guide when the ordinary directory already contains the author chat', () => {
    const author = { sourceRef: 'author-chat', kind: 'private_chat' as const, peerUserId: 11, displayName: '作者', activeAtMillis: 1, unreadCount: 0 }
    const peer = { sourceRef: 'peer-chat', kind: 'private_chat' as const, peerUserId: 12, displayName: '朋友', activeAtMillis: 2, unreadCount: 0 }
    expect(arkmeOfficialAuthorSource([peer, author], 11)).toBe(author)
    expect(arkmeOfficialAuthorSource([peer], 11)).toBeUndefined()
    expect(workspaceSource).toContain("officialAuthorSource === undefined && <ArkmeOfficialAuthorRow")
    expect(workspaceSource).toContain("callArkme<ArkmeOfficialAuthorProfile>('chat.official-author.profile'")
    expect(workspaceSource).toContain('<ArkmeUserAvatar')
  })

  it('keeps DeepSeek Harness ahead of every root-directory guide', () => {
    const rootDirectory = workspaceSource.slice(workspaceSource.indexOf("{directory === 'root' && <>"))
    expect(rootDirectory.indexOf('<DeepSeekHarnessRow')).toBeLessThan(rootDirectory.indexOf('<ArkmeDSHBetaCommunityEntry'))
    expect(rootDirectory.indexOf('<DeepSeekHarnessRow')).toBeLessThan(rootDirectory.indexOf('<ArkmeOfficialAuthorRow'))
  })

  it('provides right-click pin and remove actions for chat and Bot rows', () => {
    expect(workspaceSource).toContain("'source.directory.policy.set'")
    expect(workspaceSource).toContain('directoryContextRequestRef.current += 1')
    expect(workspaceSource).toContain("setDirectoryContextMenu({ kind: 'source', source, x: event.clientX, y: event.clientY })")
    expect(workspaceSource).toContain("setDirectoryContextMenu({ kind: 'bot', bot, x: event.clientX, y: event.clientY })")
    expect(workspaceSource).toContain('const updateBotDirectoryPolicy = async')
    expect(workspaceSource).toContain('botDirectoryIsPinned(botDirectoryPreferences, bot)')
    expect(workspaceSource).not.toContain('bots.private-chat.directory-source')
    expect(workspaceSource).toContain('>移除</button>')
    expect(workspaceSource).toContain('Number(right.pinned) - Number(left.pinned) || right.activeAtMillis - left.activeAtMillis')
  })

  it('closes the directory action menu from a captured outside click', () => {
    expect(workspaceSource).toContain("document.addEventListener('pointerdown', closeIfOutside, true)")
    expect(workspaceSource).toContain("document.removeEventListener('pointerdown', closeIfOutside, true)")
    expect(workspaceSource).toContain("window.addEventListener('blur', close)")
    expect(workspaceSource).toContain("document.addEventListener('visibilitychange', closeWhenHidden)")
  })

  it('keeps the removed conversation card visible for the desktop-style inline feedback animation', () => {
    expect(workspaceSource).toContain('window.setTimeout(resolve, 700)')
    expect(workspaceSource).toContain("transition: 'transform 220ms cubic-bezier(.215, .61, .355, 1), opacity 220ms cubic-bezier(.215, .61, .355, 1)'")
    expect(workspaceSource).toContain("chatRowRemoveContentHidden: { transform: 'translateX(-8%)', opacity: 0 }")
    expect(workspaceSource).toContain('已移除对话，可在联系人中找回')
  })
})
