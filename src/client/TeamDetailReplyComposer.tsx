import { useRef, useState } from 'react'
import { ArkmeComposerSendButton } from './ArkmeComposerSendButton.js'
import { ArkmeRichComposerInput } from './ArkmeRichComposerInput.js'
import { arkmeConversationComposerLayout as layout } from './conversation-composer-presentation.js'
import { tr } from './locale.js'

interface Attempt { uid: string; version: number; expectedReplySeq: number }

interface Draft {
  text: string
  attempt?: Attempt
}

export function TeamDetailReplyComposer({ accountKey, conversationKey, messageKey, version, expectedReplySeq, disabled, onSend }: {
  accountKey: string
  conversationKey: string
  messageKey: string
  version: number
  expectedReplySeq: number
  disabled: boolean
  onSend(text: string, attempt: Attempt): Promise<void>
}) {
  const storageKey = JSON.stringify(['arkme-team-detail-reply', accountKey, conversationKey, messageKey])
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const saved = JSON.parse(raw) as Draft
        if (typeof saved.text === 'string') return saved
      }
    } catch { /* The editor can still open without a saved draft. */ }
    return { text: '' }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const save = (next: Draft) => {
    if (next.text) localStorage.setItem(storageKey, JSON.stringify(next))
    else localStorage.removeItem(storageKey)
    setDraft(next)
  }
  const submit = async () => {
    if (disabled || pending.current || !draft.text.trim()) return
    if (draft.attempt && draft.attempt.version !== version) {
      setError(tr('原消息已更新，请核对上次发送结果后再试'))
      return
    }
    const attempt = draft.attempt ?? { uid: crypto.randomUUID(), version, expectedReplySeq }
    pending.current = true
    setBusy(true)
    setError('')
    try {
      save({ ...draft, attempt })
      await onSend(draft.text, attempt)
      try {
        const saved = localStorage.getItem(storageKey)
        if (saved && (JSON.parse(saved) as Draft).attempt?.uid === attempt.uid) save({ text: '' })
      } catch { setDraft({ text: '' }); setError(tr('消息已加入发送队列，草稿未能更新到本机')) }
    } catch (caught) { setError(caught instanceof Error ? caught.message : tr('发送失败，请重试')) }
    finally { pending.current = false; setBusy(false) }
  }
  return <div data-arkme-team-detail-composer style={{ ...layout.composer, padding: '8px 12px' }}>
    <ArkmeRichComposerInput ariaLabel={tr('延展回复')} placeholder={tr('延展此快记...')} value={draft.text}
      mentions={[]} emojis={[]} maxLength={20_000} disabled={disabled || busy} style={{ ...layout.textarea, minHeight: 40 }}
      onTextChange={text => {
        try { save({ text }); setError('') }
        catch { setError(tr('草稿未能保存到本机')) }
      }}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() }
      }} />
    {error && <div role="alert">{error}</div>}
    <ArkmeComposerSendButton ariaLabel={tr('发送延展')} disabled={disabled || busy || !draft.text.trim()} onClick={() => { void submit() }} />
  </div>
}
