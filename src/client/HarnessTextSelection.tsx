import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArkmeMessageTextSelectionToolbar } from './ArkmeMessageTextSelection.js'
import { useMessageUnderlines } from './ArkmeMessageUnderlines.js'
import { useSelectedMessageSearch } from './message-selection-search.js'
import { nativeTextMarkTransport } from './harness-text-marks.js'
import { insertNativeQuote, observeNativeTextTargets, nativeTextRows, type NativeTextInputActions } from './harness-text-selection.js'
import { quoteDomProjection } from './message-quote-selection.js'
import type { NativeChat } from './harness-native-selection.js'
import { arkmeTheme } from './arkme-theme.js'

/** Rendered inside the native iframe, so selection/highlights share its document. */
export function HarnessTextSelection({ sessionId, chat, doc, inputActions }: {
  sessionId: string; chat: NativeChat; doc: Document; inputActions?: NativeTextInputActions | undefined
}) {
  const [account, setAccount] = useState<{ id: number; scope: string }>()
  useLayoutEffect(() => {
    const surface = doc.defaultView?.frameElement?.parentElement
    if (surface?.getAttribute('data-arkme-owned') !== 'deepseek-harness-surface') return
    const update = () => {
      const id = Number(surface.getAttribute('data-arkme-account-id')), scope = surface.getAttribute('data-arkme-account-scope') ?? ''
      setAccount(previous => previous?.id === id && previous.scope === scope ? previous : Number.isSafeInteger(id) && id > 0 && scope ? { id, scope } : undefined)
    }
    const observer = new MutationObserver(update)
    observer.observe(surface, { attributes: true, attributeFilter: ['data-arkme-account-scope', 'data-arkme-account-id'] }); update()
    return () => observer.disconnect()
  }, [doc])
  return account ? <NativeTextSurface key={`${account.scope}:${sessionId}`} sessionId={sessionId} chat={chat} doc={doc} inputActions={inputActions} account={account} /> : null
}

function NativeTextSurface({ sessionId, chat, doc, inputActions, account }: {
  sessionId: string; chat: NativeChat; doc: Document; inputActions?: NativeTextInputActions | undefined; account: { id: number; scope: string }
}) {
  const sourceRef = JSON.stringify(['dsh-native', account.id, sessionId])
  const marks = useMessageUnderlines(`${account.scope}:${sessionId}`, sourceRef, account.id, nativeTextMarkTransport)
  const [query, setQuery] = useState<string>()
  const getViewport = useCallback(() => {
    const flow = [...doc.querySelectorAll('[data-chat-flow]')].find(element => !element.parentElement?.closest('[data-chat-flow]'))
    const box = flow?.parentElement?.getBoundingClientRect()
    return { left: Math.max(0, box?.left ?? 0), right: Math.min(doc.defaultView!.innerWidth, box?.right ?? doc.defaultView!.innerWidth), top: 0, bottom: doc.defaultView!.innerHeight }
  }, [doc])
  useLayoutEffect(() => observeNativeTextTargets(doc, chat, sourceRef), [doc, chat.nodes, sourceRef])
  useSelectedMessageSearch(sourceRef, setQuery)
  return <>
    <style>{'[data-arkme-text-selection] { cursor: text; } [data-arkme-text-selection] a, [data-arkme-text-selection] button { cursor: pointer; }'}</style>
    <ArkmeMessageTextSelectionToolbar selectionDomain="native" replySourceRef={sourceRef} replyLabel="引用" getViewport={getViewport}
      onUnderline={marks.mark} getMarks={marks.getMarks} onRemoveMark={marks.remove} markStorage="local"
      onReply={inputActions ? (target, quote) => {
        const editor = doc.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"]')
        if (!editor || editor.getAttribute('aria-disabled') === 'true') throw new Error('当前会话输入框不可用，请连接源电脑后引用')
        insertNativeQuote(inputActions, quote.text, target.item.senderName)
        editor.focus()
      } : undefined} />
    {marks.layer}
    {query !== undefined && <NativeTextFind chat={chat} doc={doc} query={query} setQuery={setQuery} onClose={() => setQuery(undefined)} />}
  </>
}

function NativeTextFind({ chat, doc, query, setQuery, onClose }: {
  chat: NativeChat; doc: Document; query: string; setQuery: (value: string) => void; onClose: () => void
}) {
  const [matches, setMatches] = useState<{ row: HTMLElement; range: Range }[]>([])
  const [index, setIndex] = useState(0)
  useEffect(() => {
    let frame = 0
    const scan = () => {
      const found: typeof matches = [], needle = query.replace(/\s+/gu, ' ').trim()
      if (needle) for (const { row } of nativeTextRows(doc, chat)) {
        const projection = quoteDomProjection(row)
        for (let start = projection.text.indexOf(needle); start >= 0 && found.length < 500; start = projection.text.indexOf(needle, start + needle.length)) {
          const first = projection.units[start]!.start, last = projection.units[start + needle.length - 1]!.end
          const range = doc.createRange(); range.setStart(first.node, first.offset); range.setEnd(last.node, last.offset)
          found.push({ row, range })
        }
      }
      setMatches(found); setIndex(current => Math.min(current, Math.max(0, found.length - 1)))
    }
    const observer = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest('[data-arkme-native-find],[data-arkme-underline-layer]'))) {
        cancelAnimationFrame(frame); frame = requestAnimationFrame(scan)
      }
    })
    observer.observe(doc.body, { childList: true, subtree: true, characterData: true }); scan()
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [query, chat.nodes, doc])
  useEffect(() => {
    if (globalThis.CSS?.highlights && typeof Highlight !== 'undefined') {
      CSS.highlights.set('arkme-native-find', new Highlight(...matches.map(match => match.range)))
      CSS.highlights.set('arkme-native-find-current', new Highlight(...(matches[index] ? [matches[index]!.range] : [])))
      return () => { CSS.highlights.delete('arkme-native-find'); CSS.highlights.delete('arkme-native-find-current') }
    }
  }, [matches, index])
  const move = (step: number) => {
    if (!matches.length) return
    const next = (index + step + matches.length) % matches.length
    const match = matches[next]!
    setIndex(next); (match.range.startContainer.parentElement ?? match.row).scrollIntoView({ block: 'center' })
  }
  const button = { color: 'inherit', background: 'transparent', border: 0, borderRadius: 5, padding: '4px 8px', cursor: 'pointer', fontSize: 15 }
  return createPortal(<div data-arkme-native-find role="search" aria-label="查找已加载消息" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose() }
    if (event.key === 'Enter') { event.preventDefault(); move(event.shiftKey ? -1 : 1) }
  }} style={{ position: 'fixed', right: 16, top: 78, zIndex: 12001, maxWidth: 'calc(100vw - 32px)', padding: 10, borderRadius: 10, border: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.menu, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow }}>
    <style>{'::highlight(arkme-native-find) { background: #f8db7166; } ::highlight(arkme-native-find-current) { background: #efa63b99; }'}</style>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <input autoFocus aria-label="查找关键词" value={query} onChange={event => { setIndex(0); setQuery(event.target.value) }} style={{ width: 200, maxWidth: '50vw', color: 'inherit', background: 'transparent', border: `1px solid ${arkmeTheme.border}`, borderRadius: 5, padding: 5 }} />
      <span role="status" style={{ fontSize: 12 }}>{matches.length ? `${index + 1}/${matches.length}${matches.length === 500 ? '+' : ''}` : '无匹配'}</span>
      <button style={button} aria-label="上一个匹配" disabled={!matches.length} onClick={() => move(-1)}>↑</button>
      <button style={button} aria-label="下一个匹配" disabled={!matches.length} onClick={() => move(1)}>↓</button>
      <button style={button} aria-label="关闭查找" onClick={onClose}>×</button>
    </div>
    <div style={{ color: arkmeTheme.secondary, fontSize: 11, marginTop: 5 }}>仅查找当前已加载消息；向上加载历史后自动补充</div>
  </div>, doc.body)
}
