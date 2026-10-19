import { useEffect, useRef, useState } from 'react'
import type { TeamMessage, TeamTimeline } from '../team-app-contract.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { TeamMessageContent, teamMessagePresentation } from './TeamMessageContent.js'
import { quoteCanonicalText } from '../message-quote.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

/** Team history has its own authority. Never route these refs through ordinary Chat search. */
export function TeamSelectedTextSearch({ conversationRef, accountKey, queryRequest, onClose }: {
  conversationRef: string; accountKey: string; queryRequest: { text: string }; onClose(): void
}) {
  const [query, setQuery] = useState(queryRequest.text), [messages, setMessages] = useState<TeamMessage[]>([])
  const [loading, setLoading] = useState(true), [complete, setComplete] = useState(false), [error, setError] = useState('')
  const [selected, setSelected] = useState<TeamMessage>(), [attempt, setAttempt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { setQuery(queryRequest.text); setSelected(undefined); input.current?.focus() }, [queryRequest])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setComplete(false); setMessages([])
    void (async () => {
      let beforeSeq = 0
      const found = new Map<string, TeamMessage>()
      try {
        for (let pass = 0; pass < 100; pass++) {
          const page = await callArkme<TeamTimeline>('team.app.timeline', { conversationRef, expectedAccountKey: accountKey, beforeSeq }, controller.signal)
          controller.signal.throwIfAborted()
          for (const message of page.messages) found.set(message.key, message)
          setMessages([...found.values()].sort((a, b) => b.seq - a.seq))
          if (!page.hasMore) { setComplete(true); return }
          if (!page.beforeSeq || beforeSeq && page.beforeSeq >= beforeSeq) throw new Error('历史消息分页异常，请重试')
          beforeSeq = page.beforeSeq
        }
        setError('历史消息较多，当前结果尚未覆盖全部记录')
      } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '读取历史消息失败') }
      finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [conversationRef, accountKey, attempt])
  const hits = query.trim() ? messages.filter(message => message.state === 'published' && message.contentStatus === 'available'
    && quoteCanonicalText(teamMessagePresentation(message)).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : []
  return <ArkmeDetailShell title={tr('查找团队消息')} label={tr('查找团队消息')} onClose={onClose} bodyStyle={{ padding: 16 }}
    {...(selected ? { onBack: () => setSelected(undefined) } : {})}>
    {selected ? <TeamMessageContent message={selected} conversationRef={conversationRef} /> : <>
      <input ref={input} autoFocus type="search" aria-label={tr('搜索团队聊天关键词')} value={query} onChange={event => setQuery(event.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, background: arkmeTheme.input, color: arkmeTheme.text, fontSize: 14 }} />
      <p role="status" style={{ fontSize: 12, color: arkmeTheme.secondary }}>{loading ? '正在查找' : complete ? '查找完成' : '结果尚不完整'} · 已读取 {messages.length} 条 · {hits.length} 条匹配</p>
      {error && <p role="alert" style={{ fontSize: 12, color: arkmeTheme.danger }}>{error}<button type="button" onClick={() => setAttempt(v => v + 1)}>{tr('重试')}</button></p>}
      {hits.map(message => <button type="button" key={message.key} onClick={() => setSelected(message)}
        style={{ width: '100%', display: 'block', padding: '12px 0', border: 0, borderBottom: `1px solid ${arkmeTheme.borderSoft}`, background: 'transparent', color: arkmeTheme.text, textAlign: 'left', cursor: 'pointer' }}>
        <span style={{ display: 'block', fontSize: 12, color: arkmeTheme.secondary, marginBottom: 6 }}>{message.sender.nickname} · {new Date(message.createdAt).toLocaleString()}</span>
        <span style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere', fontSize: 14 }}>{quoteCanonicalText(teamMessagePresentation(message))}</span>
      </button>)}
      {complete && query.trim() && !hits.length && <p>{tr('没有匹配的消息')}</p>}
    </>}
  </ArkmeDetailShell>
}
