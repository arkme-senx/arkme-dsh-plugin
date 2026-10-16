import { useEffect, useRef, useState } from 'react'
import { createArkmeSdk } from '../../sdk/index.js'
import type { ArkmeSourceItem, ArkmeTimelineItem } from '../../types.js'
import { tr } from '../locale.js'

const sdk = createArkmeSdk()
/** Uses the ordinary authorized directory/timeline owners, including paging. */
export function OfflineContextMessagePicker({ selected, onSelect }: { selected: string; onSelect(ref: string): void }) {
  const [sources, setSources] = useState<ArkmeSourceItem[]>([])
  const [sourceCursor, setSourceCursor] = useState<string>()
  const [source, setSource] = useState<ArkmeSourceItem>()
  const [messages, setMessages] = useState<ArkmeTimelineItem[]>([])
  const [messageCursor, setMessageCursor] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController>()
  const begin = () => {
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError('')
    return controller.signal
  }
  const loadSources = async (cursor?: string) => {
    const signal = begin()
    try {
      const page = await sdk.listSources('root', { limit: 40, ...(cursor ? { cursor } : {}), signal })
      if (signal.aborted) return
      const chats = page.items.filter(item => item.kind === 'private_chat' || item.kind === 'group_chat')
      setSources(old => cursor ? [...old, ...chats] : chats)
      setSourceCursor(page.nextCursor)
    } catch { if (!signal.aborted) setError(tr('无法读取对话，请重试')) }
    finally { if (!signal.aborted) setBusy(false) }
  }
  useEffect(() => { void loadSources(); return () => request.current?.abort() }, [])
  const loadMessages = async (target: ArkmeSourceItem, cursor?: string) => {
    const signal = begin()
    if (!cursor) { setSource(target); setMessages([]); setMessageCursor(undefined); onSelect('') }
    try {
      const page = await sdk.readChatTimeline(target.sourceRef, { limit: 40, ...(cursor ? { mode: 'older', cursor } : { mode: 'initial' }) }, signal)
      if (signal.aborted) return
      setMessages(old => cursor ? [...old, ...page.items] : page.items)
      setMessageCursor(page.unified?.olderCursor)
    } catch { if (!signal.aborted) setError(tr('无法读取消息，请重试')) }
    finally { if (!signal.aborted) setBusy(false) }
  }
  return <div>
    <label>{tr('目标对话')}<select value={source?.sourceRef ?? ''} disabled={busy} onChange={event => {
      const target = sources.find(item => item.sourceRef === event.target.value)
      if (target) void loadMessages(target)
    }}><option value="">{tr('选择对话')}</option>{sources.map(item => <option key={item.sourceRef} value={item.sourceRef}>{item.displayName}</option>)}</select></label>
    {sourceCursor && <button type="button" disabled={busy} onClick={() => void loadSources(sourceCursor)}>{tr('更多对话')}</button>}
    {source && <fieldset disabled={busy}><legend>{tr('选择实际对应的消息')}</legend>
      {messages.filter(item => item.offlineContextMessageRef).map(item => <label key={item.offlineContextMessageRef} style={{ display: 'block' }}>
        <input type="radio" name="offline-context-message-target" checked={selected === item.offlineContextMessageRef} onChange={() => onSelect(item.offlineContextMessageRef!)} />
        {new Date(item.sendAtMillis).toLocaleString()} · {(item.textContent || item.title || tr('附件消息')).slice(0, 240)}
      </label>)}
      {messageCursor && <button type="button" onClick={() => void loadMessages(source, messageCursor)}>{tr('更早消息')}</button>}
      {!busy && !messages.length && <p>{tr('当前页没有可选择的消息。')}</p>}
    </fieldset>}
    {busy && <p role="status">{tr('正在读取…')}</p>}
    {error && <p role="alert">{error}<button type="button" onClick={() => source ? void loadMessages(source) : void loadSources()}>{tr('重试')}</button></p>}
  </div>
}
