import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { arkmeRootDirectoryLoadState, botActivityAtMillis, sortArkmeBotsByCreatedAt } from '../src/client/ArkmeVirtualWorkspace.js'

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

  it('opens and selects the new Bot through its dedicated private-chat surface', () => {
    expect(workspaceSource).toContain('const createdQuickAddBot = async (bot: ArkmeBotSummary): Promise<void> =>')
    expect(workspaceSource).toContain('setBots(current => sortArkmeBotsByCreatedAt([bot, ...current.filter(item => item.botRef !== bot.botRef)]))')
    expect(workspaceSource).toContain('arkmeUi.openBotConversation(bot)')
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

  it('uses 38px avatars consistently in the conversation directory', () => {
    expect(workspaceSource).toContain("sourceAvatarWrap: { width: 38, height: 38")
    expect(workspaceSource.match(/<ArkmeMark size=\{38\} \/>/g)).toHaveLength(2)
    expect(workspaceSource).toContain('<ArkmeSendToSelfIcon size={38} />')
    expect(workspaceSource).toMatch(/<ArkmeSourceAvatar\s+size=\{38\}/)
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
