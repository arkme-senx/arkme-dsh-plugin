import { arkoInteractionJump } from './arko-interaction-jump.js'
import { recordOwnerId } from '../record-owner-id.js'
import { arkmeSourceIdentityKey } from './source-identity.js'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ArkmeRecordThought, ArkmeRecordThoughts } from '../record-thought-contract.js'
import type { ArkmeTimelineItem, ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeMarkdownBody } from './ArkmeMarkdownBody.js'
import { RecordThoughtStore, type RecordThoughtState } from './record-thought-store.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'
import { arkoReplyHistory } from './arko-reply-history.js'
import { subscribeThoughtInvalidation } from './thought-invalidations.js'
import { ArkmeArkoAvatar } from './ArkmeArkoAvatar.js'
import { arkmeExtensionDetailListStyles as replyStyles } from './extension-detail-list-styles.js'
import { activateDetailReplyKey, detailReplyClickAllowed } from './detail-reply-interaction.js'
import { ArkoChatSuggestionDialog, ArkoChatSuggestionEntry } from './ArkoChatSuggestion.js'
import { ArkoThoughtEntryButton } from './ArkoThoughtEntryButton.js'

const Context = createContext<{ openSuggestion(item: RecordItem, id: string): void; store: RecordThoughtStore; chat: boolean; accountScope: string; source?: ArkmeSourceItem | undefined; onFill?: ((text: string, mentionAsen?: boolean) => void) | undefined } | null>(null)
const empty: RecordThoughtState = Object.freeze({ items: [], loading: false, error: '' })
const noSubscribe = () => () => {}
type RecordItem = Pick<ArkmeTimelineItem, 'itemUid' | 'sendAtMillis' | 'isMe' | 'recordVersion' | 'version' | 'messageActionRef' | 'timelineItemKey'> & Partial<Pick<ArkmeTimelineItem, 'textContent' | 'recordOwnerUserId'>> & { localState?: 'synced' | 'pending' | 'failed' }

export function RecordThoughtsProvider({ accountScope, enabled, sourceRef, sourceKey, source, chat = false, onFill, children }: {
  accountScope: string | undefined; enabled: boolean; sourceRef?: string | undefined; sourceKey?: string | undefined; source?: ArkmeSourceItem | undefined; chat?: boolean;
  onFill?: ((text: string, mentionAsen?: boolean) => void) | undefined; children: ReactNode
}) {
  useEffect(() => arkoReplyHistory.activate(accountScope), [accountScope])
  const chatRef = chat ? sourceRef : undefined
  const canRead = enabled && !!accountScope && (!chat || !!chatRef)
  const chatIdentity = chat ? sourceKey || sourceRef : undefined
  const dialogScope = JSON.stringify([accountScope, sourceKey ?? sourceRef, canRead, chat])
  const [suggestion, setSuggestion] = useState<{ scope: string; item: RecordItem; id: string }>()
  const openSuggestion = useCallback((item: RecordItem, id: string) => setSuggestion({ scope: dialogScope, item, id }), [dialogScope])
  const closeSuggestion = useCallback(() => setSuggestion(undefined), [])
  useEffect(closeSuggestion, [dialogScope, closeSuggestion])
  // The stable conversation owns state; its current signed reference owns each read.
  // A separate holder per Store prevents an old account/source reader using a new binding.
  const binding = useMemo(() => ({ sourceRef: chatRef }), [accountScope, chat, chatIdentity])
  const store = useMemo(() => new RecordThoughtStore(accountScope ?? '', (scope, recordUids, signal, messageActionRefs) =>
    callArkme<ArkmeRecordThoughts>(chat ? 'chat.thoughts.query' : 'record.thoughts.query',
      chat ? { expectedAccountScope: scope, sourceRef: binding.sourceRef, messageActionRefs } : { expectedAccountScope: scope, recordUids }, signal, { priority: 'background' })), [accountScope, chat, binding])
  useEffect(() => {
    if (binding.sourceRef === chatRef) return
    binding.sourceRef = chatRef
    store.rebind()
  }, [binding, chatRef, store])
  useEffect(() => subscribeThoughtInvalidation(change => {
    if (change.accountScope !== accountScope || change.sourceKey && change.sourceKey !== sourceKey) return
    if (change.stream) { if (!chat) store.applyStream(change.stream); return }
    if (change.clear) store.invalidate(change.timelineItemKey)
    else store.refresh()
  }), [store, accountScope, sourceKey, chat])
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return
    const visibility = () => store.setActive(canRead && document.visibilityState !== 'hidden')
    const focus = () => { visibility(); if (canRead && document.visibilityState !== 'hidden') store.refresh() }
    visibility(); document.addEventListener('visibilitychange', visibility); window.addEventListener('focus', focus)
    return () => { store.setActive(false); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', focus) }
  }, [store, canRead])
  useEffect(() => () => store.dispose(), [store])
  const context = useMemo(() => canRead && accountScope ? { store, chat, onFill, source, accountScope, openSuggestion } : null, [canRead, accountScope, store, chat, onFill, source, openSuggestion])
  return <Context.Provider value={context}>{children}
    {context && suggestion?.scope === dialogScope && <ChatSuggestionSelection key={`${dialogScope}:${suggestion.item.itemUid}:${suggestion.id}`}
      item={suggestion.item} id={suggestion.id} scopeKey={dialogScope} onClose={closeSuggestion}/>}
  </Context.Provider>
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
  return { ...state, chat: context?.chat === true, onFill: context?.onFill, openSuggestion: (id: string) => context?.openSuggestion(item, id), retry: () => store?.refresh(item.itemUid), focus: () => store?.requestFocus(item.itemUid), takeFocus: () => store?.takeFocus(item.itemUid) }
}
const buttonStyle = { border: 0, background: 'transparent', padding: 0, color: arkmeTheme.accent, font: 'inherit', fontSize: 12, cursor: 'pointer' } as const
const visibleThoughts = (items: readonly ArkmeRecordThought[]) => items.filter(item => item.status !== 'invalidated')
/** Share the existing account-scoped read when composing human and Arko replies. */
function useSelectedInteractionThought(item: RecordItem) {
  const context=useContext(Context)
  const jump=useSyncExternalStore(arkoInteractionJump.subscribe,arkoInteractionJump.snapshot,arkoInteractionJump.snapshot)
  const sourceKey=context?.source ? arkmeSourceIdentityKey(context.source) : undefined
  const owner=recordOwnerId(item.recordOwnerUserId ?? (!context?.chat||item.isMe ? context?.accountScope.split(':')[1] : undefined))
  const matches=(request: typeof jump)=>request?.scope===context?.accountScope && request?.rootUid===item.itemUid && request?.sourceKey===sourceKey && String(request?.recordOwnerUserId)===String(owner)
  const [retained,setRetained]=useState<typeof jump>()
  const selected=matches(jump) ? jump : undefined
  useEffect(()=>{if(selected?.thought)setRetained(selected)},[selected])
  useEffect(()=>{
    const clear=()=>{setRetained(undefined);if(jump && jump.scope===context?.accountScope)arkoInteractionJump.consume(jump.revision)}
    const unsubscribe=subscribeThoughtInvalidation(change=>{if(change.accountScope===context?.accountScope)clear()})
    const focusTarget=typeof window==='undefined' ? undefined : window
    focusTarget?.addEventListener('focus',clear)
    return()=>{unsubscribe();focusTarget?.removeEventListener('focus',clear)}
  },[context?.accountScope,jump])
  return selected?.thought ?? (matches(retained) ? retained?.thought : undefined)
}
export function useRecordThoughtReplySummary(item: RecordItem) {
  const state = useThought(item), selected=useSelectedInteractionThought(item)
  const thoughts=visibleThoughts(selected ? [selected,...state.items.filter(row=>row.id!==selected.id)] : state.items)
  const count = thoughts.filter(thought => !state.chat || thought.scene !== 5).length
  return { count, hasContent: thoughts.length > 0 || !!state.error, selectedInteraction: selected }
}
function ThoughtState({ thought, onFill, onRetry, retrying, continuation, refreshError, onRefresh }: { thought: ArkmeRecordThought; onFill?: ((text: string, mentionAsen?: boolean) => void) | undefined; onRetry?: (() => void) | undefined; retrying?: boolean | undefined; continuation?: boolean; refreshError?: string | undefined; onRefresh?: (() => void) | undefined }) {
  if (continuation && refreshError && thought.status !== 'ready') return <span role="status" title={refreshError}
    style={{ display: 'flex', alignItems: 'center', minHeight: 20, lineHeight: '20px', gap: 8, color: arkmeTheme.tertiary, fontSize: 12 }}>
    <span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{tr('连接暂时不畅，正在重试…')}</span>
    {onRefresh && <button type="button" style={{ ...buttonStyle, flexShrink: 0 }} onClick={onRefresh}>{tr('重试')}</button>}
  </span>
  if (thought.status === 'generating') return <span role="status" style={{ color: arkmeTheme.tertiary, fontSize: 12, ...(continuation ? { display: 'block', minHeight: 20, lineHeight: '20px' } : {}) }}>{tr(continuation ? 'Arko 正在回复…' : 'Arko 正在思考…')}</span>
  if (thought.status === 'failed') return <span role="status" style={{ color: arkmeTheme.tertiary, fontSize: 12 }}>{tr('failure' in thought && thought.failure === 'insufficient_balance' ? '积分不足，Arko 暂时无法回复' : 'Arko 暂时没能完成回应')}
    {onRetry ? <button type="button" disabled={retrying} style={{ ...buttonStyle, marginLeft: 8 }} onClick={onRetry}>{tr('重试')}</button> : onFill && <button type="button" style={{ ...buttonStyle, marginLeft: 8 }} onClick={() => onFill('@阿森 ', true)}>{tr('重新提问')}</button>}
  </span>
  return null
}
export function RecordThoughtEntry({ item, onOpen }: { item: RecordItem; onOpen(): void }) {
  const state = useThought(item)
  return <RecordThoughtEntryView state={state} onOpen={onOpen}/>
}
function RecordThoughtEntryView({ state, onOpen }: { state: ReturnType<typeof useThought>; onOpen(): void }) {
  const thoughts = visibleThoughts(state.items)
  if (!thoughts.length) return null
  if (!state.chat) {
    if (thoughts.every(item => item.status === 'generating' || item.status === 'failed')) return <div data-arkme-record-thought-entry style={{ padding: '5px 0' }}>{thoughts.map(thought => <ThoughtState key={thought.id} thought={thought} onFill={state.onFill}/>)}</div>
    const manual = thoughts.every(item => item.biz === 2)
    return <ArkoThoughtEntryButton record ariaLabel={manual ? '查看 Arko 的回应' : '查看 Arko 的想法'} onOpen={onOpen}/>
  }
  return <div data-arkme-record-thought-entry style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '0 12px', alignSelf: 'flex-start', minWidth: 0 }}>
    {thoughts.map(thought => thought.scene === 5 ? <ArkoChatSuggestionEntry key={thought.id} thought={thought} onOpen={() => state.openSuggestion(thought.id)}/> : <div key={`${thought.id}:${thought.generation}`}>
      {thought.status === 'generating' || thought.status === 'failed' ? <ThoughtState thought={thought} onFill={state.onFill}/> : <>
        <ArkoThoughtEntryButton ariaLabel={thought.biz === 2 ? '查看 Arko 的回应' : '查看 Arko 的想法'}
          privateOnly={thought.visibility === 'user'} onOpen={() => { state.focus(); onOpen() }}/>
      </>}
    </div>)}
  </div>
}
/** One subscription and footer owner for self, private-chat and group-chat bubbles. */
export function RecordThoughtMessageFooter({ item, onOpen, children }: { item: RecordItem; onOpen(): void; children: ReactNode }) {
  const state = useThought(item)
  if (!visibleThoughts(state.items).length) return <>{children}</>
  return <div data-arkme-thought-message-footer style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px 12px', marginTop: 4, minWidth: 0 }}>
    <RecordThoughtEntryView state={state} onOpen={onOpen}/>
    <div data-arkme-thought-message-meta style={{ minWidth: 0, marginLeft: 'auto' }}>{children}</div>
  </div>
}
function ThoughtAnalysis({ thought, headline = true, warnings = true }: { thought: ArkmeRecordThought; headline?: boolean; warnings?: boolean }) {
  const display = thought.display
  if (!display) return null
  const rows = [['当前对话', display.context], ['对方的表达', display.surface], ['可能的想法', display.underlying], ['情绪', display.emotion],
    ['回应期待', display.expectation], ['我的沟通进展', display.lastAction], ['建议下一步', display.suggestedNext], ['建议语气', display.tone]]
  return <div data-arkme-thought-analysis style={{ fontSize: 13, lineHeight: 1.7, color: arkmeTheme.secondary }}>
    {headline && display.headline && <p style={{ margin: '0 0 12px', color: arkmeTheme.text }}>{display.headline}</p>}
    {rows.map(([label, value]) => value ? <div key={label} style={{ marginBottom: 9 }}><div style={{ color: arkmeTheme.tertiary, fontSize: 12 }}>{tr(label!)}</div><div style={{ whiteSpace: 'pre-wrap' }}>{value}</div></div> : null)}
    {warnings && display.warnings.length > 0 && <div style={{ margin: '10px 0' }}><div style={{ color: arkmeTheme.tertiary, fontSize: 12 }}>{tr('需要留意')}</div>{display.warnings.map((warning, index) => <div key={index}>{warning}</div>)}</div>}
  </div>
}
function ChatSuggestionSelection({ item, id, scopeKey, onClose }: { item: RecordItem; id: string; scopeKey: string; onClose(): void }) {
  const state = useThought(item), thought = visibleThoughts(state.items).find(row => row.id === id && row.scene === 5)
  useEffect(() => { if (!thought) onClose() }, [thought, onClose])
  if (!thought) return null
  const display = thought.display
  const hasAnalysis = display && [display.context, display.surface, display.underlying, display.emotion,
    display.expectation, display.lastAction, display.suggestedNext, display.tone].some(Boolean)
  return <ArkoChatSuggestionDialog thought={thought} scopeKey={scopeKey} loading={state.loading} error={state.error}
    analysis={hasAnalysis ? <ThoughtAnalysis thought={thought} headline={false} warnings={false}/> : undefined}
    onRetry={state.retry} onClose={onClose}
    onFill={state.onFill ? text => { onClose(); state.onFill?.(text) } : undefined}/>
}
export function RecordThoughtContent({ item, embedded = false, onReply, selectedThoughtId, items, interaction, onRetry, retryingId, refreshError, onRefresh }: {
  item: RecordItem; embedded?: boolean; onReply?: ((thought: ArkmeRecordThought) => void) | undefined; selectedThoughtId?: string | undefined
  items?: readonly ArkmeRecordThought[] | undefined; onRetry?: ((thought: ArkmeRecordThought) => void) | undefined; retryingId?: string | undefined
  refreshError?: string | undefined; onRefresh?: (() => void) | undefined
  /** The enclosing detail owns this exact result across body remounts. */
  interaction?: ArkmeRecordThought | undefined
}) {
  const state = useThought(item)
  const selectedInteraction=useSelectedInteractionThought(item)
  const override=items===undefined ? interaction ?? selectedInteraction : undefined
  const allThoughts = visibleThoughts(items ?? (override ? [override,...state.items.filter(row=>row.id!==override.id)] : state.items))
  const advice = items === undefined && state.chat ? allThoughts.filter(thought => thought.scene === 5) : []
  const thoughts = allThoughts.filter(thought => !advice.includes(thought))
  const section = useRef<HTMLElement>(null)
  useEffect(() => { if (items === undefined && thoughts.length && state.takeFocus()) section.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }) }, [item.itemUid, state.items, state.focusRevision, items])
  if (!allThoughts.length && (items !== undefined || !state.error)) return null
  return <>{advice.map(thought => <ArkoChatSuggestionEntry key={thought.id} thought={thought} onOpen={() => state.openSuggestion(thought.id)}/>)}
    {(thoughts.length > 0 || state.error && !advice.length) && <section ref={section} aria-label={tr('Arko 的想法')} data-arkme-record-thought-content
    style={{ ...(embedded ? {} : replyStyles.extensionContext), minWidth: 0 }}>
    {!embedded && thoughts.length > 0 && <div data-arkme-thought-reply-count style={replyStyles.extensionContextTitle}>{tr('共')}{thoughts.length}{tr('条延展')}</div>}
    <div style={replyStyles.extensionContextList}>{thoughts.map(thought => {
      const reply = onReply && (thought !== override || !!thought.replyTargetRef) && thought.status !== 'generating' && thought.status !== 'failed' ? () => onReply(thought) : undefined
      return <div key={thought.id} data-arkme-thought-reply={thought.id}
      role={reply ? 'button' : undefined} tabIndex={reply ? 0 : undefined} aria-label={reply ? tr('回复 Arko') : undefined}
      aria-pressed={reply ? thought.id === selectedThoughtId : undefined}
      onClick={event => { if (reply && detailReplyClickAllowed(event)) reply() }}
      onKeyDown={event => { if (reply) activateDetailReplyKey(event, reply) }}
      style={{ ...replyStyles.extensionContextRow, ...(thought.id === selectedThoughtId ? replyStyles.extensionContextRowSelected : {}), cursor: reply ? 'pointer' : 'default' }}>
      <ArkmeArkoAvatar size={32}/>
      <div style={replyStyles.extensionContextBody}>
        <div style={replyStyles.extensionContextHead}>
          <span data-arkme-thought-author style={replyStyles.extensionContextName}>Arko</span>
          {thought.visibility === 'user' && <span style={{ color: arkmeTheme.tertiary, fontSize: 12 }}>{tr('仅你可见')}</span>}
        </div>
        <ThoughtState thought={thought} continuation={items !== undefined} refreshError={refreshError} onRefresh={onRefresh}
          onFill={items ? undefined : state.onFill} onRetry={onRetry ? () => onRetry(thought) : undefined} retrying={retryingId === thought.id}/>
        {thought.status !== 'failed' && <>
          <ThoughtAnalysis thought={thought}/>
          {thought.display?.suggestions.length ? thought.display.suggestions.map((group, index) => <div key={index} style={{ marginTop: 14 }}>
            {group.style && <div style={{ fontSize: 12, color: arkmeTheme.tertiary, marginBottom: 5 }}>{group.style}</div>}
            {group.items.map((text, i) => <div key={i} style={{ marginBottom: 12 }}><ArkmeMarkdownBody text={text} highlightMentions={false} textStyle={{ fontSize: 14, lineHeight: 1.7 }}/>
              {state.onFill && <button type="button" style={{ ...buttonStyle, marginTop: 5 }} onClick={() => state.onFill?.(text)}>{tr('填入输入框')}</button>}
            </div>)}
          </div>) : thought.content && <ArkmeMarkdownBody text={thought.content} highlightMentions={false} textStyle={{ fontSize: 14, lineHeight: 1.7 }}/>}
        </>}
      </div>
    </div>})}</div>
    {items === undefined && state.error && <div role="status" style={{ fontSize: 12, color: arkmeTheme.tertiary }}>{tr(state.error)}
      <button type="button" disabled={state.loading} onClick={state.retry} style={{ ...buttonStyle, marginLeft: 8 }}>{tr('重试')}</button>
    </div>}
  </section>}</>
}
