import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { arkoReplyScenes, arkoReplySceneInfo, type ArkoReplyScene } from '../arko-reply-management.js'
import { arkoReplyPromptReference } from '../arko-reply-prompt-reference.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { ArkmeAutomaticAiSettings } from './ArkmeAutomaticAiSettings.js'
import { readArkoReplyPromptDrafts, saveArkoReplyPromptDraft, officialArkoReplyPrompt, arkoReplyPromptContent, emptyArkoReplyPromptDrafts, arkoPromptMaxLength } from './arko-reply-drafts.js'
import { arkoReplyHistory, readArkoReplyHistory, type ArkoReplyHistoryEntry } from './arko-reply-history.js'
import { arkmeTheme as theme } from './arkme-theme.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeMarkdownPlainText } from '../markdown.js'
import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
const quiet: CSSProperties = { border: 0, background: 'transparent', color: theme.accent, padding: '6px 0', font: 'inherit', fontSize: 12, cursor: 'pointer' }
const note: CSSProperties = { color: theme.tertiary, fontSize: 12, lineHeight: 1.7, margin: '8px 0 16px' }
const label: CSSProperties = { display: 'block', fontSize: 13, color: theme.secondary, marginBottom: 10 }
const capabilities = ['record_thought', 'chat_thought'] as const
type HistoryScene = Exclude<ArkoReplyScene, 'arko_chat'>
const historyScenes = arkoReplyScenes.filter((scene): scene is HistoryScene => scene !== 'arko_chat')
const groupScenes = [
  { label: '快记', scenes: ['record_auto', 'record_mention'] },
  { label: '私聊', scenes: ['direct_receive', 'direct_sent', 'direct_mention'] },
  { label: '群聊', scenes: ['group_mention', 'group_auto', 'group_private_followup'] },
] as const
interface HistoryState { thoughts: ArkoReplyHistoryEntry[]; offset: number; thoughtMore: boolean; warning: string }
const blankHistory = (): HistoryState => ({ thoughts: [], offset: 0, thoughtMore: false, warning: '' })

function ArkoReplyManagerBody({ accountScope, onClose }: { accountScope: string; onClose(): void }) {
  useArkmeLocale()
  const [tab, setTab] = useState<'scenes' | 'history'>('scenes'), [more, setMore] = useState(false), [target, setTarget] = useState<ArkoReplyScene>()
  const [book, setBook] = useState(emptyArkoReplyPromptDrafts), [form, setForm] = useState('')
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [draftReadFailed, setDraftReadFailed] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<() => void>(), confirmId = useId()
  const scope = useRef(accountScope); scope.current = accountScope
  const [filter, setFilter] = useState<HistoryScene | 'all'>('all'), [history, setHistory] = useState(blankHistory), [historyLoading, setHistoryLoading] = useState(false)
  const historyCandidates = useRef<ArkoReplyHistoryEntry[]>([])
  const historyController = useRef<AbortController>(), historyState = useRef(history); historyState.current = history
  const dirty = !!target && form !== arkoReplyPromptContent(book, target)
  const navigate = (action: () => void) => { if (dirty) setPendingNavigation(() => action); else action() }
  const loadDrafts = () => { try { const saved = readArkoReplyPromptDrafts(accountScope); setBook(saved); setForm(target ? arkoReplyPromptContent(saved, target) : ''); setError(''); setDraftReadFailed(false) } catch (caught) { setDraftReadFailed(true); setError(caught instanceof Error ? caught.message : tr('无法读取提示词草稿')) } }
  useEffect(() => { arkoReplyHistory.activate(accountScope); loadDrafts(); return () => historyController.current?.abort() }, [accountScope])
  const edit = (next: ArkoReplyScene) => {
    setTarget(next); setForm(arkoReplyPromptContent(book, next)); setNotice(''); if (!draftReadFailed) setError('')
  }
  const overview = (advanced = false) => { setTarget(undefined); setMore(advanced); setForm(''); setNotice(''); if (!draftReadFailed) setError('') }
  const switchTab = (next: 'scenes' | 'history') => { if (next !== tab) navigate(() => { overview(); setTab(next) }) }
  const save = () => {
    if (!target || scope.current !== accountScope || draftReadFailed) return
    try {
      const saved = saveArkoReplyPromptDraft(accountScope, target, form === officialArkoReplyPrompt(target) ? null : form, book.revision)
      setBook(saved); setForm(arkoReplyPromptContent(saved, target)); setNotice(tr('已保存本机提示词草稿')); setError('')
    } catch (caught) { setError(caught instanceof Error ? caught.message : tr('提示词草稿未能保存，请重试')) }
  }
  const loadHistory = async (append = false) => {
    historyController.current?.abort(); const controller = new AbortController(); historyController.current = controller
    const previous = append ? historyState.current : blankHistory(), expectedScope = accountScope, selectedFilter = filter
    setHistoryLoading(true); setError(''); if (!append) { setHistory(blankHistory()); historyCandidates.current = arkoReplyHistory.list(expectedScope).filter(item => item.scene !== 'arko_chat' && (selectedFilter === 'all' || item.scene === selectedFilter)) }
    try {
      const result = await readArkoReplyHistory(expectedScope, selectedFilter, previous.offset, controller.signal, historyCandidates.current)
      if (controller.signal.aborted || scope.current !== expectedScope) return
      setHistory({ thoughts: [...new Map([...previous.thoughts, ...result.items].map(item => [item.key, item])).values()],
        offset: result.nextOffset, thoughtMore: result.hasMore, warning: result.failedSources ? tr('部分来源暂时无法校验，已暂缓展示。') : '' })
    } catch {
      if (!controller.signal.aborted && scope.current === expectedScope) setHistory({ ...previous, warning: tr('部分来源暂时无法校验，已暂缓展示。') })
    } finally { if (!controller.signal.aborted && scope.current === expectedScope) setHistoryLoading(false) }
  }
  useEffect(() => { if (tab === 'history') void loadHistory(); return () => historyController.current?.abort() }, [tab, filter, accountScope])
  const openThought = (entry: ArkoReplyHistoryEntry) => {
    onClose()
    arkmeUi.showConversationTarget(entry.source, entry.item.itemUid, entry.item.sendAtMillis, entry.item.recordOwnerUserId, undefined, false, true)
  }
  const title = target ? tr(arkoReplySceneInfo[target].title) : more ? tr('提示词') : tr('回复管理')
  const changedCount = arkoReplyScenes.filter(scene => arkoReplySceneInfo[scene].availability === 'existing' && officialArkoReplyPrompt(scene) && book.scenes[scene]).length
  const rows = [
    ...history.thoughts.map(entry => ({ key: entry.key, title: arkoReplySceneInfo[entry.scene].title, source: entry.source.displayName, at: entry.item.sendAtMillis, content: entry.thought.display?.headline || entry.thought.content,
      open: () => openThought(entry), disabled: false })),
  ].sort((a, b) => b.at - a.at)
  return <ArkmeDetailShell title={title} label={tr('Arko 回复管理')} onClose={() => navigate(onClose)}
    {...(target || more ? { onBack: () => navigate(() => overview(!!target)), backLabel: tr(target ? '返回提示词列表' : '返回回复管理') } : {})}
    bodyStyle={{ padding: '16px 22px 28px' }}
    footer={target ? <div style={{ padding: '12px 22px 18px', borderTop: `1px solid ${theme.borderSoft}` }}>
      <p style={{ ...note, margin: '0 0 10px' }}>{tr('仅保存在本机，尚未在云端生效')}</p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <button type="button" style={quiet} disabled={draftReadFailed || form === officialArkoReplyPrompt(target)} onClick={() => { setForm(officialArkoReplyPrompt(target)); setNotice(''); setError('') }}>{tr('恢复默认')}</button>
        <button type="button" data-arko-reply-save disabled={!dirty || draftReadFailed} onClick={save} style={{ border: 0, borderRadius: 8, padding: '9px 18px', background: dirty && !draftReadFailed ? theme.primaryAction : theme.layer2, color: dirty && !draftReadFailed ? theme.onPrimaryAction : theme.tertiary, cursor: dirty ? 'pointer' : 'default', font: 'inherit', fontSize: 13 }}>{tr('保存修改')}</button>
      </div>
    </div> : undefined}>
    <style>{`.arko-reply-tabs{display:flex;gap:24px;border-bottom:1px solid ${theme.borderSoft};margin-bottom:20px}[data-arkme-workspace] .arko-reply-tabs button{border:0;background:transparent;padding:7px 0 12px;font:inherit;font-size:14px;color:${theme.tertiary};cursor:pointer}[data-arkme-workspace] .arko-reply-tabs button[aria-selected=true]{color:${theme.text};box-shadow:0 2px ${theme.text}}
      [data-arkme-workspace] button.arko-reply-row{width:100%;display:flex;align-items:center;justify-content:space-between;gap:14px;text-align:left;border:0;border-bottom:1px solid ${theme.borderSoft};background:transparent;padding:14px 0;color:${theme.text};font:inherit;cursor:pointer}[data-arkme-workspace] button.arko-reply-row:hover{background:${theme.hover}}.arko-reply-row small{display:block;color:${theme.tertiary};font-size:12px;margin-top:5px;line-height:1.5}
      .arko-reply-reference summary{font-size:13px;color:${theme.secondary};cursor:pointer;padding:10px 0}.arko-reply-reference pre{font-family:inherit;font-size:12px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere;color:${theme.secondary};background:${theme.layer1};padding:12px;border-radius:8px}[data-arkme-workspace] button.arko-reply-history-row{display:block}.arko-reply-capabilities .arkme-automatic-ai{margin:20px 0 14px}.arko-reply-capabilities .arkme-automatic-ai h3{font-size:14px;margin-bottom:8px;font-weight:600}.arko-reply-capabilities .arkme-automatic-ai-row{min-height:46px}.arko-reply-history-text{font-size:13px;line-height:1.7;color:${theme.secondary};margin-top:8px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}`}</style>
    {error && <p role="alert" style={{ ...note, color: theme.danger }}>{tr(error)}{draftReadFailed && <button type="button" onClick={loadDrafts} style={{ ...quiet, marginLeft: 8 }}>{tr('重试')}</button>}</p>}
    {notice && <p role="status" style={note}>{notice}</p>}
    {target ? <>
      <p style={note}>{tr(arkoReplySceneInfo[target].description)}</p>
      <label style={label} htmlFor="arko-reply-prompt">{tr('提示词')}</label>
      <textarea id="arko-reply-prompt" aria-label={tr('提示词')} maxLength={arkoPromptMaxLength} value={form} rows={16}
        onChange={event => { setForm(event.target.value); setNotice('') }}
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', border: `1px solid ${theme.border}`, borderRadius: 9, background: theme.base, color: theme.text, padding: 12, font: 'inherit', fontSize: 13, lineHeight: 1.8 }}/>
      <p style={note}>{tr('默认内容来自官方源码参考，尚未同步线上实际配置。')} · {arkoReplyPromptReference.sourceRevision}</p>
    </> : more ? <>
      <p style={note}>{tr('选择回复类型，查看或编辑现有提示词。')}</p>
      {groupScenes.map(group => <section key={group.label} style={{ marginTop: 22 }}><div style={{ fontSize: 12, color: theme.tertiary, marginBottom: 3 }}>{tr(group.label)}</div>
        {group.scenes.filter(scene => arkoReplySceneInfo[scene].availability === 'existing' && officialArkoReplyPrompt(scene)).map(scene => <button key={scene} type="button" className="arko-reply-row" onClick={() => edit(scene)}><span>{tr(arkoReplySceneInfo[scene].title)}
          {book.scenes[scene] && <small>{tr('已修改')}</small>}</span><CaretRight size={15} aria-hidden/></button>)}
      </section>)}
    </> : <>
      <div role="tablist" aria-label={tr('回复管理页面')} className="arko-reply-tabs">
        <button type="button" role="tab" aria-selected={tab === 'scenes'} onClick={() => switchTab('scenes')}>{tr('回复设置')}</button>
        <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => switchTab('history')}>{tr('全部回复')}</button>
      </div>
      {tab === 'scenes' ? <>
        <div className="arko-reply-capabilities"><ArkmeAutomaticAiSettings accountScope={accountScope} only={capabilities} title="自动回应" compact /></div>
        <button type="button" className="arko-reply-row" style={{ marginTop: 16, borderBottom: 0 }} onClick={() => navigate(() => overview(true))}><span>{tr('提示词')}{changedCount > 0 && <small>{tr('已修改')} · {changedCount}</small>}</span><CaretRight size={15} aria-hidden/></button>
      </> : <>
        <label style={{ ...label, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>{tr('回复类型')}
          <select aria-label={tr('回复类型')} value={filter} onChange={event => setFilter(event.target.value as HistoryScene | 'all')} style={{ maxWidth: 220, font: 'inherit', fontSize: 12, color: theme.secondary, background: theme.base, border: `1px solid ${theme.border}`, borderRadius: 6, padding: 6 }}>
            <option value="all">{tr('全部类型')}</option>{historyScenes.map(scene => <option value={scene} key={scene}>{tr(arkoReplySceneInfo[scene].title)}</option>)}
          </select>
        </label>
        <p style={note}>{tr('当前展示本次已读取并重新校验的快记与聊天回复，完整云端汇总待接通。')}</p>
        {history.warning && <p role="status" style={note}>{history.warning}<button type="button" style={{ ...quiet, marginLeft: 8 }} onClick={() => { void loadHistory() }}>{tr('重试')}</button></p>}
        {rows.map(row => <button key={row.key} type="button" className="arko-reply-row arko-reply-history-row" disabled={row.disabled || historyLoading} onClick={row.open}>
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}><span>{tr(row.title)} · {row.source}</span><time style={{ color: theme.tertiary, whiteSpace: 'nowrap' }}>{new Date(row.at).toLocaleString(arkmeIntlLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></span>
          <div className="arko-reply-history-text">{arkmeMarkdownPlainText(row.content)}</div><small>{tr('查看原消息')} →</small>
        </button>)}
        {historyLoading && <p role="status" style={note}>{tr('正在校验并读取回复…')}</p>}
        {!historyLoading && !rows.length && !history.warning && <p style={note}>{tr('当前范围暂无可展示的回复。打开快记或聊天读取已有回应后，可在这里查看。')}</p>}
        {history.thoughtMore && <button type="button" disabled={historyLoading} onClick={() => { void loadHistory(true) }} style={{ ...quiet, marginTop: 16 }}>{tr('加载更多')}</button>}
      </>}
    </>}
    {pendingNavigation && <ArkmeConfirmDialog busy={false} titleId={confirmId} title={tr('提示词修改尚未保存')} description={tr('离开后会放弃这次修改，已保存的草稿会保留。')}
      confirmLabel={tr('放弃修改')} busyLabel={tr('放弃修改')} onClose={() => setPendingNavigation(undefined)} onConfirm={() => { const action = pendingNavigation; setPendingNavigation(undefined); action() }} />}
  </ArkmeDetailShell>
}

export function ArkoReplyManager(props: { accountScope: string; onClose(): void }) {
  return <ArkoReplyManagerBody key={props.accountScope} {...props}/>
}
