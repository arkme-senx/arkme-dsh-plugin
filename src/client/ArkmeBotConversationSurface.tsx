import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { GearSix } from '@phosphor-icons/react/dist/icons/GearSix'
import { RobotIcon } from '@phosphor-icons/react/dist/csr/Robot'
import type {
  ArkmeBotPrivateChatConversation,
  ArkmeBotPrivateChatMessage,
  ArkmeBotPrivateChatSendResult,
  ArkmeBotSummary,
} from '../types.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeBotSettingsPanel } from './ArkmeBotSettingsPanel.js'
import { ArkmeLinkText } from './ArkmeLinkText.js'
import { arkmeConversationComposerHeight, arkmeConversationComposerLayout } from './conversation-composer-presentation.js'

const styles: Record<string, CSSProperties> = {
  shell: { width: '100%', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: arkmeTheme.base },
  header: { height: 68, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px', boxSizing: 'border-box', borderBottom: `1px solid ${arkmeTheme.border}` },
  avatar: { width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: '50%', background: arkmeTheme.active, color: arkmeTheme.text },
  title: { minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 7, fontSize: 15, lineHeight: '21px', fontWeight: 600 },
  badge: { padding: '1px 6px', borderRadius: 999, background: arkmeTheme.subtle, color: arkmeTheme.secondary, fontSize: 10, lineHeight: '16px', fontWeight: 600 },
  settings: { width: 32, height: 32, display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 8, background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer' },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 22px 12px', boxSizing: 'border-box' },
  messages: { display: 'flex', flexDirection: 'column', gap: 12 },
  row: { display: 'flex', minWidth: 0 },
  rowUser: { justifyContent: 'flex-end' },
  bubble: { maxWidth: 'min(600px, 86%)', padding: '10px 13px', borderRadius: '6px 16px 16px 16px', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: '20px' },
  bubbleUser: { borderRadius: '16px 6px 16px 16px', background: arkmeTheme.messageOwn },
  bubbleAssistant: { background: arkmeTheme.messageOther },
  empty: { margin: 'auto', color: arkmeTheme.secondary, fontSize: 13, lineHeight: '20px', textAlign: 'center' },
  loading: { color: arkmeTheme.secondary, fontSize: 13, textAlign: 'center' },
  error: { marginBottom: 12, padding: '8px 10px', borderRadius: 8, background: arkmeTheme.dangerSoft, color: arkmeTheme.danger, fontSize: 12, lineHeight: '18px' },
  composer: { ...arkmeConversationComposerLayout.composer, background: '#fff' },
  composerInner: {
    ...arkmeConversationComposerLayout.composerInner,
    border: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.input, boxShadow: arkmeTheme.shadow,
  },
  input: {
    ...arkmeConversationComposerLayout.textarea,
    background: 'transparent', color: arkmeTheme.text, boxShadow: 'none', appearance: 'none', WebkitAppearance: 'none',
    caretColor: 'var(--dsw-alias-state-business-primary, #3964fe)',
  },
  tools: { ...arkmeConversationComposerLayout.tools },
  send: {
    width: 34, height: 34, flex: 'none', display: 'grid', placeItems: 'center',
    border: 0, borderRadius: 9, background: '#171923', color: arkmeTheme.foreground, cursor: 'pointer',
    transform: 'translateY(-2px)', transition: 'background-color 100ms ease',
  },
}

function mergeMessages(current: readonly ArkmeBotPrivateChatMessage[], incoming: readonly ArkmeBotPrivateChatMessage[]): ArkmeBotPrivateChatMessage[] {
  const next = [...current]
  for (const message of incoming) {
    const duplicate = next.some(existing => existing.role === message.role && existing.content === message.content
      && existing.createdAtMillis === message.createdAtMillis)
    if (!duplicate) next.push(message)
  }
  return next
}

function botWithActivity(bot: ArkmeBotSummary, messages: readonly ArkmeBotPrivateChatMessage[]): ArkmeBotSummary {
  const latest = messages.reduce<ArkmeBotPrivateChatMessage | undefined>((current, message) => {
    if (current === undefined || message.createdAtMillis >= current.createdAtMillis) return message
    return current
  }, undefined)
  if (latest === undefined) return bot
  return {
    ...bot,
    ...(latest.createdAtMillis > 0 ? { latestMessageAtMillis: latest.createdAtMillis } : {}),
    ...(latest.content === '' ? {} : { latestMessagePreview: latest.content }),
  }
}

export function ArkmeBotConversationSurface({
  bot, onConversationActivity, onDeleted,
}: {
  bot: ArkmeBotSummary
  onConversationActivity?(bot: ArkmeBotSummary): void
  onDeleted?(): void
}) {
  const [messages, setMessages] = useState<ArkmeBotPrivateChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setMessages([])
    void callArkme<ArkmeBotPrivateChatConversation>('bots.private-chat.open', { botRef: bot.botRef }, controller.signal)
      .then(value => {
        if (controller.signal.aborted) return
        setMessages(value.messages)
        onConversationActivity?.(value.bot)
      })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [bot.botRef])

  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }) }, [messages.length])
  useEffect(() => {
    const input = inputRef.current
    if (input === null) return
    input.style.height = '0px'
    input.style.height = `${String(arkmeConversationComposerHeight(input.scrollHeight))}px`
  }, [draft])

  const send = async () => {
    const content = draft.trim()
    if (content === '' || sending) return
    setSending(true)
    setError('')
    try {
      const result = await callArkme<ArkmeBotPrivateChatSendResult>('bots.private-chat.send', { botRef: bot.botRef, content })
      const activityMessages = [result.userMessage, ...result.botMessages]
      setMessages(current => mergeMessages(current, activityMessages))
      onConversationActivity?.(botWithActivity(bot, activityMessages))
      setDraft('')
      if (result.status !== 'ok') setError('Bot 暂未返回回复，请稍后刷新查看。')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSending(false)
    }
  }

  return <section style={styles.shell} aria-label={`${bot.name} Bot 对话`}>
    <header style={styles.header}>
      <span style={styles.avatar} aria-hidden><RobotIcon size={20} weight="fill" /></span>
      <span style={styles.title}><span>{bot.name}</span><span style={styles.badge}>BOT</span></span>
      <button type="button" aria-label="Bot 设置" title="Bot 设置" style={styles.settings} onClick={() => { setSettingsOpen(true) }}><GearSix size={20} /></button>
    </header>
    <div ref={bodyRef} style={styles.body}>
      {error !== '' && <div role="alert" style={styles.error}>{error}</div>}
      {loading ? <div role="status" style={styles.loading}>正在加载 Bot 对话…</div>
        : messages.length === 0 ? <div style={styles.empty}>和 {bot.name} 打个招呼吧</div>
          : <div style={styles.messages}>{messages.map((message, index) => <div
            key={`${message.role}:${message.createdAtMillis}:${index}`} style={{ ...styles.row, ...(message.role === 'user' ? styles.rowUser : {}) }}
          ><div style={{ ...styles.bubble, ...(message.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant) }}>
            <ArkmeLinkText text={message.content} />
          </div></div>)}</div>}
    </div>
    <footer className="arkme-conversation-composer" style={styles.composer}><div className="arkme-conversation-composer-inner" style={styles.composerInner}>
      <textarea
        ref={inputRef} value={draft} disabled={sending} style={styles.input} rows={1} maxLength={20_000}
        placeholder={`发消息给 ${bot.name}`}
        onChange={event => { setDraft(event.target.value) }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault(); void send()
          }
        }}
      />
      <div style={styles.tools}>
        <span aria-hidden style={{ width: 34, height: 34 }} />
        <button type="button" aria-label={sending ? '正在发送' : '发送消息'} title="发送消息" disabled={sending || draft.trim() === ''} style={{ ...styles.send, ...(sending || draft.trim() === '' ? { opacity: .4, cursor: 'default' } : {}) }} onClick={() => { void send() }}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
            <path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div></footer>
    {settingsOpen && <ArkmeBotSettingsPanel bot={bot} onClose={() => { setSettingsOpen(false) }} onUpdated={updated => { onConversationActivity?.(updated); setSettingsOpen(false) }} onDeleted={() => { setSettingsOpen(false); onDeleted?.() }} />}
  </section>
}
