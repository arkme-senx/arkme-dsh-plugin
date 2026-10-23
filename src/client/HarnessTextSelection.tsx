import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { MessageTextFind } from './MessageTextFind.js'
import { ArkmeMessageTextSelectionToolbar } from './ArkmeMessageTextSelection.js'
import { useMessageUnderlines } from './ArkmeMessageUnderlines.js'
import { useSelectedMessageSearch } from './message-selection-search.js'
import { createNativeTextMarkTransport } from './harness-text-marks.js'
import { insertNativeQuote, observeNativeTextTargets, nativeTextRows, type NativeTextInputActions } from './harness-text-selection.js'
import type { NativeChat } from './harness-native-selection.js'

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
  const transport = useMemo(() => createNativeTextMarkTransport(account.scope), [account.scope, sessionId])
  const marks = useMessageUnderlines(`${account.scope}:${sessionId}`, sourceRef, account.id, transport)
  const [query, setQuery] = useState<string>()
  const getRows = useCallback(() => nativeTextRows(doc, chat).map(row => row.row), [doc, chat.nodes])
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
      onUnderline={marks.mark} getMarks={marks.getMarks} onRemoveMark={marks.remove} markStorage={marks.storage}
      onReply={inputActions ? (target, quote) => {
        const editor = doc.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"]')
        if (!editor || editor.getAttribute('aria-disabled') === 'true') throw new Error('当前会话输入框不可用，请连接源电脑后引用')
        insertNativeQuote(inputActions, quote.text, target.item.senderName)
        editor.focus()
      } : undefined} />
    {marks.layer}
    {query !== undefined && <MessageTextFind getRows={getRows} doc={doc} query={query} setQuery={setQuery} onClose={() => setQuery(undefined)} />}
  </>
}
