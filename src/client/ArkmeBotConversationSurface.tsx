import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { GearSix } from '@phosphor-icons/react/dist/icons/GearSix'
import { RobotIcon } from '@phosphor-icons/react/dist/csr/Robot'
import type {
  ArkmeBotConversation,
  ArkmeBotConversationMessage,
  ArkmeBotConversationReadResult,
  ArkmeBotConversationSendResult,
  ArkmeBotSummary,
} from '../types.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeBotSettingsPanel } from './ArkmeBotSettingsPanel.js'
import { arkmeUi } from './ui-controller.js'
import { ArkmeLinkText } from './ArkmeLinkText.js'
import { arkmeConversationComposerHeight, arkmeConversationComposerLayout } from './conversation-composer-presentation.js'
import { botUsesPrivateConversationSurface } from './bot-conversation-routing.js'

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

function mergeMessages(current: readonly ArkmeBotConversationMessage[], incoming: readonly ArkmeBotConversationMessage[]): ArkmeBotConversationMessage[] {
  const next = [...current]
  for (const message of incoming) {
    const duplicate = message.messageId !== ''
      && next.some(existing => existing.messageId === message.messageId)
    if (!duplicate) next.push(message)
  }
  return next
}

function mergePendingConfirmedMessages(
  ownerMessages: readonly ArkmeBotConversationMessage[],
  pendingMessages: readonly ArkmeBotConversationMessage[],
): ArkmeBotConversationMessage[] {
  const next = [...ownerMessages]
  for (const message of pendingMessages) {
    if (message.messageId !== '' && next.some(existing => existing.messageId === message.messageId)) continue
    const insertionIndex = message.createdAtMillis > 0
      ? next.findIndex(existing => existing.createdAtMillis > message.createdAtMillis)
      : -1
    if (insertionIndex < 0) next.push(message)
    else next.splice(insertionIndex, 0, message)
  }
  return next
}

function botWithActivity(bot: ArkmeBotSummary, messages: readonly ArkmeBotConversationMessage[]): ArkmeBotSummary {
  const latest = messages.reduce<ArkmeBotConversationMessage | undefined>((current, message) => {
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
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const [messages, setMessages] = useState<ArkmeBotConversationMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const loadedBotRef = useRef<string>()
  const pendingConfirmedMessagesRef = useRef(new Map<string, ArkmeBotConversationMessage>())
  const sendInFlightRef = useRef(false)
  const readInFlightRef = useRef<{ botRef: string; sequence: number }>()
  const confirmedReadRef = useRef<{ botRef: string; sequence: number }>()
  const activeRef = useRef(true)
  const privateSurfaceAvailable = botUsesPrivateConversationSurface(bot)
  const conversationRevision = ui.recordRevision

  useEffect(() => {
    activeRef.current = true
    return () => { activeRef.current = false }
  }, [])

  useEffect(() => {
    if (!privateSurfaceAvailable) {
      loadedBotRef.current = undefined
      pendingConfirmedMessagesRef.current.clear()
      setMessages([])
      setError('')
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const initialLoad = loadedBotRef.current !== bot.botRef
    if (initialLoad) {
      pendingConfirmedMessagesRef.current.clear()
      setLoading(true)
    }
    setError('')
    if (initialLoad) setMessages([])
    const operation = initialLoad ? 'bots.private-chat.open' as const : 'bots.private-chat.refresh' as const
    void callArkme<ArkmeBotConversation>(operation, { botRef: bot.botRef }, controller.signal)
      .then(value => {
        if (controller.signal.aborted) return
        loadedBotRef.current = bot.botRef
        for (const message of value.messages) {
          if (message.messageId !== '') pendingConfirmedMessagesRef.current.delete(message.messageId)
        }
        const visibleMessages = mergePendingConfirmedMessages(
          value.messages,
          [...pendingConfirmedMessagesRef.current.values()],
        )
        setMessages(visibleMessages)
        onConversationActivity?.(botWithActivity(bot, visibleMessages))
        const sequence = value.latestSequence
        if (sequence === undefined || !Number.isSafeInteger(sequence) || sequence <= 0) return
        const confirmed = confirmedReadRef.current
        if (confirmed?.botRef === bot.botRef && confirmed.sequence >= sequence) return
        const inFlight = readInFlightRef.current
        if (inFlight?.botRef === bot.botRef && inFlight.sequence >= sequence) return
        const attempt = { botRef: bot.botRef, sequence }
        readInFlightRef.current = attempt
        void callArkme<ArkmeBotConversationReadResult>(
          'bots.private-chat.mark-read', { botRef: bot.botRef, sequence },
        ).then(result => {
          const latestConfirmed = confirmedReadRef.current
          if (result.effectiveReadSequence >= sequence
            && (latestConfirmed?.botRef !== bot.botRef || latestConfirmed.sequence < sequence)) {
            confirmedReadRef.current = attempt
          }
        }).catch(() => {
          // Read acknowledgement is best-effort and must never hide an already rendered conversation.
        }).finally(() => {
          if (readInFlightRef.current === attempt) readInFlightRef.current = undefined
        })
      })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)) })
      .finally(() => { if (!controller.signal.aborted && initialLoad) setLoading(false) })
    return () => { controller.abort() }
  }, [bot.botRef, conversationRevision, privateSurfaceAvailable])

  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }) }, [messages.length])
  useEffect(() => {
    const input = inputRef.current
    if (input === null) return
    input.style.height = '0px'
    input.style.height = `${String(arkmeConversationComposerHeight(input.scrollHeight))}px`
  }, [draft])

  const send = async () => {
    const content = draft.trim()
    if (!privateSurfaceAvailable || content === '' || sendInFlightRef.current) return
    sendInFlightRef.current = true
    setSending(true)
    setError('')
    try {
      const result = await callArkme<ArkmeBotConversationSendResult>('bots.private-chat.send', { botRef: bot.botRef, content })
      if (!activeRef.current) return
      const activityMessages = [result.userMessage, ...result.botMessages]
      for (const message of activityMessages) {
        if (message.messageId !== '') pendingConfirmedMessagesRef.current.set(message.messageId, message)
      }
      setMessages(current => mergeMessages(current, activityMessages))
      onConversationActivity?.(botWithActivity(bot, activityMessages))
      setDraft('')
      if (result.status !== 'ok') setError('Bot 暂未返回回复，请稍后刷新查看。')
    } catch (caught) {
      if (activeRef.current) setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      sendInFlightRef.current = false
      if (activeRef.current) setSending(false)
    }
  }

  const privateChatUnavailable = !privateSurfaceAvailable
  const privateChatInboundOnly = privateSurfaceAvailable && bot.privateChatOutboundEnabled === false

  return <section style={styles.shell} aria-label={`${bot.name} Bot 对话`}>
    <header style={styles.header}>
      <span style={styles.avatar} aria-hidden><RobotIcon size={20} weight="fill" /></span>
      <span style={styles.title}><span>{bot.name}</span><span style={styles.badge}>BOT</span></span>
      {privateSurfaceAvailable && <button type="button" aria-label="Bot 设置" title="Bot 设置" style={styles.settings} onClick={() => { setSettingsOpen(true) }}><GearSix size={20} /></button>}
    </header>
    <div ref={bodyRef} style={styles.body}>
      {error !== '' && <div role="alert" style={styles.error}>{error}</div>}
      {loading ? <div role="status" style={styles.loading}>正在加载 Bot 对话…</div>
        : messages.length === 0 ? <div style={styles.empty}>和 {bot.name} 打个招呼吧</div>
          : <div style={styles.messages}>{messages.map((message, index) => <div
            key={message.messageId || `${message.role}:${message.createdAtMillis}:${index}`} style={{ ...styles.row, ...(message.role === 'user' ? styles.rowUser : {}) }}
          ><div style={{ ...styles.bubble, ...(message.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant) }}>
            <ArkmeLinkText text={message.content} />
          </div></div>)}</div>}
    </div>
    {privateChatUnavailable || privateChatInboundOnly ? <footer className="arkme-conversation-composer" style={styles.composer}><div className="arkme-conversation-composer-inner" style={styles.composerInner}>
      <div role="note" style={styles.loading}>{privateChatUnavailable
        ? '当前 Bot 会话暂不可用'
        : 'Webhook Bot 仅接收外部系统推送'}</div>
    </div></footer> : <footer className="arkme-conversation-composer" style={styles.composer}><div className="arkme-conversation-composer-inner" style={styles.composerInner}>
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
    </div></footer>}
    {privateSurfaceAvailable && settingsOpen && <ArkmeBotSettingsPanel bot={bot} onClose={() => { setSettingsOpen(false) }} onUpdated={updated => { onConversationActivity?.(updated); setSettingsOpen(false) }} onDeleted={() => { setSettingsOpen(false); onDeleted?.() }} />}
  </section>
}
