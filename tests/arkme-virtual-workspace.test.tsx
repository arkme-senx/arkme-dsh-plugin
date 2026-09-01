import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  arkmeOfficialAuthorSource,
  arkmeChatBotPresentation,
  arkmeReconcileCreatedSourceRefresh,
  arkmeReconciledCreatedSource,
  arkmeRootDirectoryLoadState,
  arkmeSourcesShareIdentity,
  botActivityAtMillis,
  sortArkmeBotsByActivity,
} from '../src/client/ArkmeVirtualWorkspace.js'
import {
  botUsesPrivateConversationSurface,
  botUsesStandardChatSource,
} from '../src/client/bot-conversation-routing.js'

const workspaceSource = readFileSync(new URL('../src/client/ArkmeVirtualWorkspace.tsx', import.meta.url), 'utf8')

describe('Arkme conversation directory load state', () => {
  it('reconciles an optimistic Chat source by its stable key when its display-derived ref changes', () => {
    const optimistic = {
      sourceRef: 'optimistic-ref', sourceKey: 'stable-chat-key', kind: 'private_chat' as const,
      displayName: 'Bot 旧名称', activeAtMillis: 0, unreadCount: 0,
    }
    const canonical = {
      ...optimistic, sourceRef: 'canonical-ref', displayName: 'Bot 新名称', activeAtMillis: 20, unreadCount: 1,
    }
    const differentKind = { ...canonical, sourceRef: 'group-ref', kind: 'group_chat' as const }

    expect(arkmeReconciledCreatedSource(optimistic, [differentKind, canonical])).toBe(canonical)
    expect(arkmeReconciledCreatedSource({ ...optimistic, sourceKey: undefined }, [canonical])).toBeUndefined()
    expect(arkmeSourcesShareIdentity(optimistic, canonical)).toBe(true)
    expect(arkmeSourcesShareIdentity(optimistic, differentKind)).toBe(false)
    expect(workspaceSource).toContain('!arkmeSourcesShareIdentity(item, source)')
  })

  it('retains conversations that arrive while a newly created Chat source is awaiting projection', () => {
    const optimistic = {
      sourceRef: 'optimistic-bot', sourceKey: 'bot-chat-key', kind: 'private_chat' as const,
      displayName: 'Bot', activeAtMillis: 10, unreadCount: 0,
    }
    const concurrentlyArrived = {
      sourceRef: 'new-peer', sourceKey: 'peer-key', kind: 'private_chat' as const,
      displayName: '新会话', activeAtMillis: 20, unreadCount: 1,
    }

    expect(arkmeReconcileCreatedSourceRefresh(optimistic, [concurrentlyArrived])).toEqual({
      sources: [optimistic, concurrentlyArrived],
      selected: optimistic,
    })
  })

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

  it('opens a Chat-owned Bot through the standard Chat source and keeps the dedicated surface for other owners', () => {
    expect(workspaceSource).toContain('const createdQuickAddBot = async (bot: ArkmeBotSummary): Promise<void> =>')
    expect(workspaceSource).toContain('setBots(current => sortArkmeBotsByActivity([bot, ...current.filter(item => item.botRef !== bot.botRef)]))')
    expect(workspaceSource).toContain("'directory.bot.open-chat', { botRef: bot.botRef }, controller.signal")
    expect(workspaceSource).toContain('await createdQuickAddSource(source, controller.signal)')
    expect(workspaceSource).toContain('if (refreshed === undefined || signal?.aborted === true) return')
    expect(workspaceSource).toContain('sourceRef?: string')
    expect(workspaceSource).toContain('const cancelBotOpenRequest = useCallback')
    expect(workspaceSource).toContain('request.controller.signal === preserveSignal')
    expect(workspaceSource).toContain('activateNativeEntry(signal)')
    expect(workspaceSource).toContain('sourceRef: source.sourceRef')
    expect(workspaceSource).toContain('auth?.environment, auth?.userId, currentSessionId')
    expect(workspaceSource).toContain("setDirectoryActionFeedback('正在打开 Bot 会话…')")
    expect(workspaceSource).toContain("directoryActionFeedback === '正在打开 Bot 会话…'")
    expect(workspaceSource).toContain('if (botUsesPrivateConversationSurface(bot))')
    expect(workspaceSource).toContain('if (!botUsesStandardChatSource(bot))')
    const privateBranch = workspaceSource.slice(
      workspaceSource.indexOf('if (botUsesPrivateConversationSurface(bot))'),
      workspaceSource.indexOf('if (!botUsesStandardChatSource(bot))'),
    )
    expect(privateBranch).toContain('activateNativeEntry()')
    expect(workspaceSource).toContain("callArkme<{ items: ArkmeBotSummary[] }>('bots.list'")
    expect(workspaceSource).not.toContain("callArkme<{ items: ArkmeBotSummary[] }>('bots.private-chat.directory'")
  })

  it('keeps canonical Chat sources and shows private Bot shortcuts only for non-Chat owners', () => {
    const base = { botRef: 'bot', name: 'Bot', provider: 'openclaw' as const, description: '', status: 'offline' as const, directChatAvailable: true }
    expect(botUsesStandardChatSource({ ...base, conversationProjection: 'chat', chatSourceKey: 'chat-key' })).toBe(true)
    expect(botUsesStandardChatSource({ ...base, conversationProjection: 'chat' })).toBe(false)
    expect(botUsesStandardChatSource({ ...base, directChatAvailable: false, conversationProjection: 'chat', chatSourceKey: 'chat-key' })).toBe(false)
    expect(botUsesStandardChatSource({ ...base, conversationProjection: 'record' })).toBe(false)
    expect(botUsesStandardChatSource(base)).toBe(false)
    expect(botUsesPrivateConversationSurface(base)).toBe(false)
    expect(botUsesPrivateConversationSurface({ ...base, conversationProjection: 'record' })).toBe(true)
    expect(botUsesPrivateConversationSurface({ ...base, conversationProjection: 'chat' })).toBe(false)
    expect(botUsesPrivateConversationSurface({ ...base, directChatAvailable: false })).toBe(false)
    expect(workspaceSource).toContain('.filter(bot => botUsesPrivateConversationSurface(bot)')
    expect(workspaceSource).not.toContain('projectBotChatDirectory')
  })

  it('decorates an exact canonical Chat source with Bot identity without changing source behavior', () => {
    const source = {
      sourceRef: 'chat-source', sourceKey: 'chat-key', kind: 'private_chat' as const,
      displayName: 'Agent Bot', activeAtMillis: 20, unreadCount: 2,
    }
    const bot = {
      botRef: 'bot', name: 'Agent Bot', provider: 'openclaw' as const, description: '', status: 'online' as const,
      directChatAvailable: true, conversationProjection: 'chat' as const, chatSourceKey: 'chat-key',
    }

    expect(arkmeChatBotPresentation(source, [bot])).toBe(bot)
    expect(arkmeChatBotPresentation({ ...source, kind: 'group_chat' }, [bot])).toBeUndefined()
    expect(arkmeChatBotPresentation(source, [bot, { ...bot, botRef: 'duplicate' }])).toBeUndefined()
    expect(workspaceSource).toContain('const sourceBot = row.bot')
    expect(workspaceSource).toContain('onClick={() => { selectSource(source) }}')
  })

  it('keeps Bot entries in newest-first activity order', () => {
    expect(sortArkmeBotsByActivity([
      { botRef: 'older', name: '旧 Bot', provider: 'openclaw', description: '', status: 'offline', directChatAvailable: true, createdAtMillis: 100 },
      { botRef: 'newer', name: '新 Bot', provider: 'openclaw', description: '', status: 'offline', directChatAvailable: true, createdAtMillis: 200 },
    ]).map(item => item.botRef)).toEqual(['newer', 'older'])
  })

  it('uses the newest creation, owner activity, or opened-message time in the shared conversation order', () => {
    expect(botActivityAtMillis({
      botRef: 'bot', name: 'Bot', provider: 'openclaw', description: '', status: 'offline', directChatAvailable: true,
      createdAtMillis: 100, latestActivityAtMillis: 200, latestMessageAtMillis: 300,
    })).toBe(300)
  })

  it('keeps the Bot badge beside its name while the activity time stays at the right edge', () => {
    expect(workspaceSource).toContain('<span style={styles.entryName}>{bot.name}</span><span style={styles.botBadge}>BOT</span>')
    expect(workspaceSource).toContain("<span style={{ ...styles.chatTime, marginLeft: 'auto' }}>{timeLabel(row.activeAtMillis)}</span>")
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
