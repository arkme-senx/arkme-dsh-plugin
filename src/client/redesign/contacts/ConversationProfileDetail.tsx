import { useEffect, useRef, useState } from 'react'
import { ChatCircle } from '@phosphor-icons/react/ChatCircle'
import type { ArkmeBotSummary, ArkmeDirectoryItem, ArkmeGroupMemberList, ArkmeSourceItem } from '../../../types.js'
import { callArkme } from '../../api.js'
import { ArkmeDefaultAvatarFrame, ArkmeSourceAvatar } from '../../ArkmeAvatar.js'
import { ArkmeDirectoryBotGlyph } from './AlphabeticalContactList.js'

type ConversationItem = Extract<ArkmeDirectoryItem, { kind: 'group' | 'bot' }>

function GroupNickname({ sourceRef }: { sourceRef: string }) {
  const [nickname, setNickname] = useState<string>()
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setNickname(undefined)
    setFailed(false)
    void (async () => {
      try {
        const members = await callArkme<ArkmeGroupMemberList>('group.members', { sourceRef, activeOnly: true }, controller.signal)
        if (!controller.signal.aborted) setNickname(members.items.find(member => member.isSelf)?.memberName?.trim() || '未设置')
      } catch {
        if (!controller.signal.aborted) setFailed(true)
      }
    })()
    return () => { controller.abort() }
  }, [sourceRef, revision])
  return <dl className="arkme-contact-profile-row"><dt>群内昵称</dt><dd>
    {failed ? <span className="arkme-contact-profile-error" role="alert">加载失败<button data-arkme-feedback="neutral" type="button" onClick={() => { setRevision(value => value + 1) }}>重试</button></span>
      : nickname === undefined ? <span role="status">加载中…</span> : nickname}
  </dd></dl>
}

export function ConversationProfileDetail({ item, onSourceActivated, onBotActivated }: {
  item: ConversationItem
  onSourceActivated(source: ArkmeSourceItem): void
  onBotActivated?(bot: ArkmeBotSummary): void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const request = useRef<AbortController>()
  useEffect(() => () => { request.current?.abort() }, [])
  const name = item.kind === 'group' ? item.displayName : item.bot.name
  const available = item.kind === 'group' || (item.bot.directChatAvailable && onBotActivated !== undefined)
  const openMessage = async () => {
    if (request.current !== undefined || !available) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError(undefined)
    try {
      if (item.kind === 'group') {
        const source = await callArkme<ArkmeSourceItem>('directory.group.open-chat', { sourceRef: item.sourceRef }, controller.signal)
        if (!controller.signal.aborted) onSourceActivated(source)
      } else {
        await callArkme('conversation.directory.visibility.set', { entryKind: 'bot', entryRef: item.bot.botRef, hidden: false }, controller.signal)
        if (!controller.signal.aborted) onBotActivated?.(item.bot)
      }
    } catch {
      if (!controller.signal.aborted) setError('暂时无法打开对话，请重试')
    } finally {
      if (!controller.signal.aborted) { request.current = undefined; setBusy(false) }
    }
  }
  return <div className="arkme-contact-detail">
    <section className="arkme-contact-profile" aria-label={item.kind === 'group' ? '群聊资料' : 'Bot 资料'}>
      <header className="arkme-contact-profile-main">
        <span className="arkme-contact-profile-avatar" role="img" aria-label={`${name}的头像`}>
          {item.kind === 'group'
            ? <ArkmeSourceAvatar kind="group" size={72} {...(item.groupAvatar === undefined ? {} : { groupAvatar: item.groupAvatar })} />
            : <ArkmeDefaultAvatarFrame><ArkmeDirectoryBotGlyph size={72} /></ArkmeDefaultAvatarFrame>}
        </span>
        <div className="arkme-contact-profile-identity">
          <h1 className="arkme-contact-profile-name">{name}</h1>
          {item.kind === 'bot' && <span className="arkme-contact-profile-section-title">{item.bot.provider === 'openclaw' ? 'OpenClaw Bot' : 'Webhook Bot'}</span>}
        </div>
      </header>
      <section className="arkme-contact-profile-section">
        <h2 className="arkme-contact-profile-section-title">{item.kind === 'group' ? '群聊资料' : 'Bot 资料'}</h2>
        {item.kind === 'group' ? <GroupNickname key={item.sourceRef} sourceRef={item.sourceRef} />
          : <dl className="arkme-contact-profile-row"><dt>简介</dt><dd>{item.bot.description.trim() || '暂无简介'}</dd></dl>}
      </section>
      <footer className="arkme-contact-profile-actions arkme-conversation-profile-actions" aria-label="联系操作" aria-busy={busy}>
        <button data-arkme-feedback="neutral" type="button" className="arkme-contact-profile-action" disabled={busy || !available} onClick={() => { void openMessage() }}>
          <ChatCircle size={28} weight="regular" aria-hidden /><span>{busy ? '正在打开…' : '发消息'}</span>
        </button>
      </footer>
      {!available && <div className="arkme-contact-profile-status">此 Bot 暂不支持私聊</div>}
      {error !== undefined && <div role="alert" className="arkme-contact-profile-message-error">{error}</div>}
    </section>
  </div>
}
