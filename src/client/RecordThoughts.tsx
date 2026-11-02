import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import type { ArkmeRecordThought, ArkmeRecordThoughts } from '../record-thought-contract.js'
import type { ArkmeTimelineItem, ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeMarkdownBody } from './ArkmeMarkdownBody.js'
import { RecordThoughtStore, type RecordThoughtState } from './record-thought-store.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'
import { arkoReplyHistory } from './arko-reply-history.js'
import { subscribeThoughtInvalidation } from './thought-invalidations.js'

const Context = createContext<{ store: RecordThoughtStore; chat: boolean; accountScope: string; source?: ArkmeSourceItem | undefined; onFill?: ((text: string, mentionAsen?: boolean) => void) | undefined } | null>(null)
const empty: RecordThoughtState = Object.freeze({ items: [], loading: false, error: '' })
const noSubscribe = () => () => {}
type RecordItem = Pick<ArkmeTimelineItem, 'itemUid' | 'sendAtMillis' | 'isMe' | 'recordVersion' | 'version' | 'messageActionRef' | 'timelineItemKey'> & Partial<Pick<ArkmeTimelineItem, 'textContent' | 'recordOwnerUserId'>> & { localState?: 'synced' | 'pending' | 'failed' }

export function RecordThoughtsProvider({ accountScope, enabled, sourceRef, sourceKey, source, chat = false, onFill, children }: {
  accountScope: string | undefined; enabled: boolean; sourceRef?: string | undefined; sourceKey?: string | undefined; source?: ArkmeSourceItem | undefined; chat?: boolean;
  onFill?: ((text: string, mentionAsen?: boolean) => void) | undefined; children: ReactNode
}) {
  useEffect(() => arkoReplyHistory.activate(accountScope), [accountScope])
  const chatRef = chat ? sourceRef : undefined
  const store = useMemo(() => new RecordThoughtStore(accountScope ?? '', (scope, recordUids, signal, messageActionRefs) =>
    callArkme<ArkmeRecordThoughts>(chatRef ? 'chat.thoughts.query' : 'record.thoughts.query',
      chatRef ? { expectedAccountScope: scope, sourceRef: chatRef, messageActionRefs } : { expectedAccountScope: scope, recordUids }, signal, { priority: 'background' })), [accountScope, chatRef])
  useEffect(() => subscribeThoughtInvalidation(change => {
    if (change.accountScope !== accountScope || change.sourceKey && change.sourceKey !== sourceKey) return
    if (change.stream) { if (!chat) store.applyStream(change.stream); return }
    if (change.clear) store.invalidate(change.timelineItemKey)
    else store.refresh()
  }), [store, accountScope, sourceKey, chat])
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return
    const visibility = () => store.setActive(enabled && !!accountScope && document.visibilityState !== 'hidden')
    const focus = () => { visibility(); if (enabled && document.visibilityState !== 'hidden') store.refresh() }
    visibility(); document.addEventListener('visibilitychange', visibility); window.addEventListener('focus', focus)
    return () => { store.setActive(false); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', focus) }
  }, [store, enabled, accountScope])
  useEffect(() => () => store.dispose(), [store])
  const context = useMemo(() => enabled && accountScope ? { store, chat, onFill, source, accountScope } : null, [enabled, accountScope, store, chat, onFill, source])
  return <Context.Provider value={context}>{children}</Context.Provider>
}
function useThought(item: RecordItem) {
  const context = useContext(Context)
  const store = (context?.chat ? !!item.messageActionRef && item.localState !== 'pending' : item.isMe) && item.localState !== 'failed' ? context?.store : null
  const subscribe = useCallback((listener: () => void) => store?.subscribe(item.itemUid, item.sendAtMillis, item.recordVersion ?? item.version ?? 0, listener, item.messageActionRef, item.timelineItemKey) ?? noSubscribe(),
    [store, item.itemUid, item.sendAtMillis, item.recordVersion, item.version, item.messageActionRef, item.timelineItemKey])
  const get = useCallback(() => store?.get(item.itemUid) ?? empty, [store, item.itemUid])
  const state = useSyncExternalStore(subscribe, get, get)
  useEffect(() => {
    if (!context?.source || !store) return
    arkoReplyHistory.observeItem(context.accountScope, context.source, item)
    if (state.loaded && !state.loading && !state.error) arkoReplyHistory.observe(context.accountScope, context.source, item, state.items)
  }, [context?.accountScope, context?.source, store, item, state.loaded, state.loading, state.error, state.items])
  return { ...state, chat: context?.chat === true, onFill: context?.onFill, retry: () => store?.refresh(item.itemUid), focus: () => store?.requestFocus(item.itemUid), takeFocus: () => store?.takeFocus(item.itemUid) }
}
const buttonStyle = { border: 0, background: 'transparent', padding: 0, color: arkmeTheme.accent, font: 'inherit', fontSize: 12, cursor: 'pointer' } as const
const visibleThoughts = (items: readonly ArkmeRecordThought[]) => items.filter(item => item.status !== 'invalidated')
const suggestions = (thought: ArkmeRecordThought) => {
  const candidates = thought.display?.suggestions.flatMap(group => group.items) ?? []
  return [...new Set(candidates.length ? candidates : thought.content ? [thought.content] : [])]
}
function title(thought: ArkmeRecordThought): string {
  if (thought.scene === 3 || thought.scene === 4) return 'Arko · 私密想法'
  if (thought.scene === 5) return 'Arko · 回复建议'
  return thought.biz === 2 ? 'Arko · 回应' : 'Arko · 快记想法'
}
function ThoughtState({ thought, onFill }: { thought: ArkmeRecordThought; onFill?: ((text: string, mentionAsen?: boolean) => void) | undefined }) {
  if (thought.status === 'generating') return <span role="status" style={{ color: arkmeTheme.tertiary, fontSize: 12 }}>{tr('Arko 正在思考…')}</span>
  if (thought.status === 'failed') return <span role="status" style={{ color: arkmeTheme.tertiary, fontSize: 12 }}>{tr('Arko 暂时没能完成回应')}
    {onFill && <button type="button" style={{ ...buttonStyle, marginLeft: 8 }} onClick={() => onFill('@阿森 ', true)}>{tr('重新提问')}</button>}
  </span>
  return null
}
function SuggestionPreview({ thought, onFill }: { thought: ArkmeRecordThought; onFill?: ((text: string, mentionAsen?: boolean) => void) | undefined }) {
  const queue = suggestions(thought), [index, setIndex] = useState(0)
  const current = queue[index % Math.max(1, queue.length)]
  if (!current) return null
  return <div data-arkme-thought-suggestion style={{ padding: '2px 0 4px 18px', maxWidth: 440, fontSize: 13, color: arkmeTheme.secondary, lineHeight: 1.6 }}>
    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{current}</div>
    <div style={{ display: 'flex', gap: 16, marginTop: 5 }}>
      {onFill && <button type="button" style={buttonStyle} onClick={event => { event.stopPropagation(); onFill(current) }}>{tr('填入输入框')}</button>}
      {queue.length > 1 && <button type="button" style={buttonStyle} onClick={event => { event.stopPropagation(); setIndex(value => value + 1) }}>{tr('换一句')}</button>}
    </div>
  </div>
}
export function RecordThoughtEntry({ item, onOpen }: { item: RecordItem; onOpen(): void }) {
  const state = useThought(item), thoughts = visibleThoughts(state.items)
  if (!thoughts.length) return null
  if (!state.chat) {
    if (thoughts.every(item => item.status === 'generating' || item.status === 'failed')) return <div data-arkme-record-thought-entry style={{ padding: '5px 0' }}>{thoughts.map(thought => <ThoughtState key={thought.id} thought={thought} onFill={state.onFill}/>)}</div>
    const manual = thoughts.every(item => item.biz === 2)
    return <button type="button" data-arkme-record-thought-entry aria-label={tr(manual ? '查看 Arko 的回应' : '查看 Arko 的想法')}
      style={{ display: 'flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start', border: 0, background: 'transparent', padding: '5px 0', color: arkmeTheme.tertiary, font: 'inherit', fontSize: 12, cursor: 'pointer' }}
      onClick={event => { event.stopPropagation(); state.focus(); onOpen() }}>
      <Sparkle size={14} aria-hidden/>{tr(manual ? 'Arko · 回应' : 'Arko · 快记想法')}<CaretRight size={12} aria-hidden/>
    </button>
  }
  return <div data-arkme-record-thought-entry style={{ alignSelf: 'flex-start', minWidth: 0, paddingTop: 4 }}>
    {thoughts.map(thought => <div key={`${thought.id}:${thought.generation}`}>
      {thought.status === 'generating' || thought.status === 'failed' ? <ThoughtState thought={thought} onFill={state.onFill}/> : <>
        <button type="button" style={{ ...buttonStyle, display: 'flex', alignItems: 'center', gap: 4, padding: '4px 0', color: arkmeTheme.tertiary }}
          aria-label={`${tr(thought.biz === 2 ? '查看 Arko 的回应' : '查看 Arko 的想法')}${thought.visibility === 'user' ? ` · ${tr('仅你可见')}` : ''}`} onClick={event => { event.stopPropagation(); state.focus(); onOpen() }}>
          <Sparkle size={14} aria-hidden/>{tr(title(thought))}{thought.visibility === 'user' && <span> · {tr('仅你可见')}</span>}<CaretRight size={12} aria-hidden/>
        </button>
        {thought.scene === 5 && <SuggestionPreview thought={thought} onFill={state.onFill}/>}
      </>}
    </div>)}
  </div>
}
function ThoughtAnalysis({ thought }: { thought: ArkmeRecordThought }) {
  const display = thought.display
  if (!display) return null
  const rows = [['当前对话', display.context], ['对方的表达', display.surface], ['可能的想法', display.underlying], ['情绪', display.emotion],
    ['回应期待', display.expectation], ['我的沟通进展', display.lastAction], ['建议下一步', display.suggestedNext], ['建议语气', display.tone]]
  return <div data-arkme-thought-analysis style={{ fontSize: 13, lineHeight: 1.7, color: arkmeTheme.secondary }}>
    {display.headline && <p style={{ margin: '0 0 12px', color: arkmeTheme.text }}>{display.headline}</p>}
    {rows.map(([label, value]) => value ? <div key={label} style={{ marginBottom: 9 }}><div style={{ color: arkmeTheme.tertiary, fontSize: 12 }}>{tr(label!)}</div><div style={{ whiteSpace: 'pre-wrap' }}>{value}</div></div> : null)}
    {display.warnings.length > 0 && <div style={{ margin: '10px 0' }}><div style={{ color: arkmeTheme.tertiary, fontSize: 12 }}>{tr('需要留意')}</div>{display.warnings.map((warning, index) => <div key={index}>{warning}</div>)}</div>}
  </div>
}
export function RecordThoughtContent({ item }: { item: RecordItem }) {
  const state = useThought(item), thoughts = visibleThoughts(state.items)
  const section = useRef<HTMLElement>(null)
  useEffect(() => { if (thoughts.length && state.takeFocus()) section.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }) }, [item.itemUid, state.items, state.focusRevision])
  if (!thoughts.length && !state.error) return null
  return <section ref={section} aria-label={tr('Arko 的想法')} data-arkme-record-thought-content style={{ margin: '18px 0 22px', minWidth: 0 }}>
    {thoughts.map(thought => <div key={thought.id} style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9, color: arkmeTheme.secondary, fontSize: 13, fontWeight: 600 }}>
        <Sparkle size={16} aria-hidden/>{tr(state.chat ? title(thought) : thought.biz === 2 ? 'Arko 的回应' : 'Arko · 快记想法')}
        {thought.visibility === 'user' && <span style={{ fontWeight: 400, color: arkmeTheme.tertiary, fontSize: 12 }}>{tr('仅你可见')}</span>}
      </div>
      <ThoughtState thought={thought} onFill={state.onFill}/>
      {thought.status !== 'failed' && <>
        <ThoughtAnalysis thought={thought}/>
        {thought.display?.suggestions.length ? thought.display.suggestions.map((group, index) => <div key={index} style={{ marginTop: 14 }}>
          {group.style && <div style={{ fontSize: 12, color: arkmeTheme.tertiary, marginBottom: 5 }}>{group.style}</div>}
          {group.items.map((text, i) => <div key={i} style={{ marginBottom: 12 }}><ArkmeMarkdownBody text={text} highlightMentions={false} textStyle={{ fontSize: 14, lineHeight: 1.7 }}/>
            {state.onFill && <button type="button" style={{ ...buttonStyle, marginTop: 5 }} onClick={() => state.onFill?.(text)}>{tr('填入输入框')}</button>}
          </div>)}
        </div>) : thought.content && <ArkmeMarkdownBody text={thought.content} highlightMentions={false} textStyle={{ fontSize: 14, lineHeight: 1.7 }}/>}
      </>}
    </div>)}
    {state.error && <div role="status" style={{ fontSize: 12, color: arkmeTheme.tertiary }}>{tr(state.error)}
      <button type="button" disabled={state.loading} onClick={state.retry} style={{ ...buttonStyle, marginLeft: 8 }}>{tr('重试')}</button>
    </div>}
  </section>
}
