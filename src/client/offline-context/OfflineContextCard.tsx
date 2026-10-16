import type { OfflineContextPreview } from '../../offline-context-contract.js'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { LinkSimple } from '@phosphor-icons/react/dist/icons/LinkSimple'
import { Play } from '@phosphor-icons/react/dist/icons/Play'
import { Waveform } from '@phosphor-icons/react/dist/icons/Waveform'
import { ArrowSquareOut } from '@phosphor-icons/react/dist/icons/ArrowSquareOut'
import { LockSimple } from '@phosphor-icons/react/dist/icons/LockSimple'
import { UsersThree } from '@phosphor-icons/react/dist/icons/UsersThree'
import type { OfflineContextAction, OfflineContextActions, OfflineContextChange, OfflineContextEntry } from '../../offline-context.js'
import { canShareOfflineContext, offlineEvidenceRange, selectedOfflineEvidence } from '../../offline-context.js'
import { ArkmeConfirmDialog } from '../ArkmeConfirmDialog.js'
import { tr, useArkmeLocale } from '../locale.js'
import css from './offline-context.css?inline'

export function offlineClock(value: number): string {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export interface OfflineContextCardProps {
  entry: OfflineContextEntry
  actions: OfflineContextActions
  /** Demonstration mode is explicit and must never invoke a production transport. */
  preview?: boolean
  recoveryPending?: boolean
  renderMessagePicker?: (selected: string, onSelect: (ref: string) => void) => ReactNode
  relinkOptions?: { messageRef: string; label: string }[]
}

export function OfflineContextCard(props: OfflineContextCardProps) {
  // Key at the account/conversation/id boundary so pending dialogs cannot cross conversations.
  return <OfflineContextCardBody key={`${props.entry.conversationKey}:${props.entry.id}`} {...props} />
}

function OfflineContextCardBody({ entry, actions, preview = false, recoveryPending = false, relinkOptions = [], renderMessagePicker }: OfflineContextCardProps) {
  useArkmeLocale()
  const dialogId = useId()
  const [expanded, setExpanded] = useState(false)
  const [menu, setMenu] = useState(false)
  const [dialog, setDialog] = useState<'share' | 'range' | 'relink' | 'withdraw' | undefined>()
  const [includeTranscript, setIncludeTranscript] = useState(false)
  const [frozen, setFrozen] = useState<OfflineContextPreview>()
  const [rangeEvidence, setRangeEvidence] = useState(entry.evidence)
  const [rangeReady, setRangeReady] = useState(false)
  const [startOffset, setStartOffset] = useState(0)
  const [endOffset, setEndOffset] = useState(0)
  const [first, setFirst] = useState(entry.selectedEvidenceIds[0] ?? '')
  const [last, setLast] = useState(entry.selectedEvidenceIds.at(-1) ?? '')
  const [messageRef, setMessageRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [unknown, setUnknown] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const lock = useRef(false)
  const pendingAction = useRef<OfflineContextAction>()
  const selected = selectedOfflineEvidence(entry)
  const playable = selected.find(item => item.playbackRef)
  const rangeIds = offlineEvidenceRange({ ...entry, evidence: rangeEvidence }, first, last)
  const firstLength = Array.from(rangeEvidence.find(e => e.id === first)?.text ?? '').length
  const lastLength = Array.from(rangeEvidence.find(e => e.id === last)?.text ?? '').length
  const rangeValid = rangeIds.length > 0 && Number.isInteger(startOffset) && Number.isInteger(endOffset) && startOffset >= 0 && startOffset < firstLength && endOffset > 0 && endOffset <= lastLength && (rangeIds.length > 1 || endOffset > startOffset)
  const disabled = busy || unknown || recoveryPending
  const sourceAvailable = entry.sourceState === 'available'

  useEffect(() => {
    setFrozen(undefined)
    if (dialog !== 'share' || preview) return
    const controller = new AbortController()
    setError('')
    if (!actions.preview) { setError(tr('分享预览暂不可用')); return }
    void actions.preview(entry, includeTranscript, controller.signal).then(value => {
      if (!controller.signal.aborted) setFrozen(value)
    }).catch(() => { if (!controller.signal.aborted) setError(tr('无法取得分享预览，请重新打开后重试。')) })
    return () => controller.abort()
  }, [dialog, includeTranscript, entry.id, entry.revision, actions.preview, preview])

  useEffect(() => {
    if (dialog !== 'range') return
    const controller = new AbortController()
    setRangeReady(false); setStartOffset(0); setError('')
    if (preview) { setRangeEvidence(entry.evidence); setEndOffset(Array.from(entry.evidence.at(-1)?.text ?? '').length); setRangeReady(true); return }
    if (!actions.rangeOptions) { setError(tr('范围读取暂不可用')); return }
    void actions.rangeOptions(entry, controller.signal).then(options => {
      if (controller.signal.aborted) return
      setRangeEvidence(options.evidence)
      setFirst(options.evidence[0]?.id ?? ''); setLast(options.evidence.at(-1)?.id ?? '')
      setEndOffset(Array.from(options.evidence.at(-1)?.text ?? '').length); setRangeReady(true)
    }).catch(() => { if (!controller.signal.aborted) setError(tr('无法读取最新转写范围，请重新打开后重试。')) })
    return () => controller.abort()
  }, [dialog, entry.id, entry.revision, actions.rangeOptions, preview])

  async function read(action: () => void | Promise<void>) {
    setError('')
    try { await action() } catch { setError(tr('来源暂时打不开，请稍后重试。')) }
  }

  async function change(change: OfflineContextChange) {
    if (lock.current || unknown || recoveryPending) return
    if (change.kind === 'share' && !preview && (!frozen || frozen.expiresAtMillis <= Date.now())) { setError(tr('预览已过期，请重新打开分享。')); return }
    lock.current = true; setBusy(true); setError(''); setFeedback('')
    try {
      const action = { entryId: entry.id, expectedRevision: entry.revision,
        conversationKey: entry.conversationKey, requestId: crypto.randomUUID(), change }
      pendingAction.current = action
      const result = await actions.change(action)
      if (result.status === 'unknown') {
        setUnknown(true)
        setError(tr('操作结果尚未确认，请先核对状态，避免重复提交。'))
      } else if (result.status === 'not_applied') {
        pendingAction.current = undefined; setError(tr('操作未生效，请刷新后重试。'))
      } else {
        pendingAction.current = undefined
        setDialog(undefined); setMenu(false)
        setFeedback(preview ? tr('演示操作已完成，未修改或发送真实内容。') : tr('已更新'))
      }
    } catch {
      // A transport error does not establish whether a write reached the server.
      setUnknown(true)
      setError(tr('暂时无法确认操作结果，请先核对状态。'))
    } finally { lock.current = false; setBusy(false) }
  }

  async function reconcile() {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try {
      if (!pendingAction.current) throw new Error('No pending operation')
      const state = await actions.reconcile(pendingAction.current)
      if (state === 'pending') { setError(tr('操作仍在处理中，请稍后再次核对。')); return }
      pendingAction.current = undefined; setUnknown(false); setError('')
      if (state === 'applied') { setDialog(undefined); setFeedback(preview ? tr('演示操作已完成，未修改或发送真实内容。') : tr('已更新')) }
    }
    catch { setError(tr('核对失败，已保留当前内容，请稍后重试。')) }
    finally { lock.current = false; setBusy(false) }
  }

  if (entry.state === 'dismissed' && !entry.hasSharedSnapshot) return <div className="arkme-offline-removed" role="status">
    <style>{css}</style>
    <span>{tr('已移除这条关联，原消息和录音仍保留')}</span>
    <button type="button" disabled={disabled} onClick={() => void change({ kind: 'restore' })}>{tr('撤销')}</button>
    {error && <span role="alert">{error}</span>}
    {unknown && <button type="button" disabled={busy} onClick={() => void reconcile()}>{tr('核对状态')}</button>}
  </div>

  return <article className="arkme-offline-card" data-offline-context-id={entry.id} aria-label={`${tr('线下交流')}：${entry.title}`} aria-busy={busy}>
    <style>{css}</style>
    <header className="arkme-offline-eyebrow">
      <span><Waveform size={16} />{tr('线下交流')}</span>
      <span className="arkme-offline-visibility">{entry.visibility === 'private' ? <LockSimple size={12} /> : <UsersThree size={13} />}
        {entry.visibility === 'private' ? tr('仅你可见') : preview ? tr('演示共享') : tr('已共享')}</span>
      <time className="arkme-offline-clock">{offlineClock(entry.startAtMillis)}–{offlineClock(entry.endAtMillis)}</time>
      <button type="button" className="arkme-offline-icon" aria-label={tr('线下交流更多操作')} aria-expanded={menu} disabled={disabled}
        onClick={() => setMenu(!menu)}><DotsThree size={22} /></button>
    </header>
    <h3>{entry.title || tr('线下交流')}</h3>
    {entry.state === 'dismissed' && <p role="status">{tr('个人关联已移除；已分享消息独立保留。')}<button type="button" disabled={disabled} onClick={() => void change({ kind: 'restore' })}>{tr('撤销移除')}</button></p>}
    <ul className="arkme-offline-summary">{entry.summary.map((line, index) => <li key={index}>{line}</li>)}</ul>
    {sourceAvailable && entry.state !== 'dismissed' && !entry.summary.length && <p role="status">{tr('选区已保存，摘要尚待重新核对。')}</p>}
    {entry.participants.length > 0 && <p className="arkme-offline-participants">{entry.participants.join(' · ')}</p>}
    <div className="arkme-offline-links">{entry.messages.map(message => <button type="button" key={message.messageRef}
      onClick={() => void read(() => actions.openMessage(message.messageRef))} title={message.excerpt}>
      <LinkSimple size={14} /><span>{message.label}</span><ArrowSquareOut size={12} />
    </button>)}</div>
    {entry.state === 'suggested' && <div className="arkme-offline-suggestion"><strong>{tr('待确认关联')}</strong><p>{entry.reason}</p>
      <button type="button" disabled={disabled || !sourceAvailable || !entry.summary.length} onClick={() => void change({ kind: 'confirm' })}>{tr('是这次交流')}</button>
      <button type="button" disabled={disabled} onClick={() => void change({ kind: 'dismiss', reason: 'unrelated' })}>{tr('不是这次交流')}</button>
    </div>}
    {entry.sourceState !== 'available' && <p role="status" className="arkme-offline-warning">{entry.sourceState === 'changed'
      ? tr('原文已更新，等待重新核对关联。') : tr('原始录音暂不可用，已保留关联位置。')}</p>}
    <footer className="arkme-offline-actions">
      {entry.hasSharedSnapshot && <button type="button" disabled={disabled} onClick={() => setDialog('withdraw')}>{tr('撤回已分享消息')}</button>}
      <button type="button" disabled={!playable || !sourceAvailable} title={!playable ? tr('当前片段未提供可播放的音频') : undefined}
        onClick={() => playable?.playbackRef && void read(() => actions.play(playable.playbackRef!))}><Play size={14} />{tr('回听')}</button>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><ChatCircle size={14} />{expanded ? tr('收起原文') : tr('查看原文')}</button>
      {entry.visibility === 'private' && <button type="button" className="arkme-offline-share" disabled={disabled || !canShareOfflineContext(entry)}
        onClick={() => { setIncludeTranscript(false); setDialog('share') }}>{tr('分享到此对话')}</button>}
    </footer>
    {expanded && <div className="arkme-offline-transcript">
      <p className="arkme-offline-explanation">{entry.reason}</p>
      {selected.map(item => <div key={item.id} className="arkme-offline-quote">
        <span>{item.speaker} · {offlineClock(item.startAtMillis)}{item.soundSource === 'playback' ? ` · ${tr('播放内容')}` : ''}</span>
        <p>{item.text}</p>
        <button type="button" disabled={!item.transcriptRef || !sourceAvailable} onClick={() => item.transcriptRef && void read(() => actions.openTranscript(item.transcriptRef!))}>
          {tr('定位转写原文')} <ArrowSquareOut size={12} />
        </button>
        {item.playbackRef && <button type="button" disabled={!sourceAvailable} onClick={() => void read(() => actions.play(item.playbackRef!))}>{tr('回听此段')}</button>}
      </div>)}
    </div>}
    {menu && <div className="arkme-offline-menu" aria-label={tr('关联操作')} onKeyDown={event => { if (event.key === 'Escape') setMenu(false) }}>
      <button type="button" disabled={disabled || entry.visibility !== 'private'} onClick={() => void change({ kind: 'dismiss', reason: 'unrelated' })}>{tr('关联不对')}</button>
      <button type="button" disabled={disabled || entry.visibility !== 'private'} onClick={() => {
        setFirst(entry.selectedEvidenceIds[0] ?? ''); setLast(entry.selectedEvidenceIds.at(-1) ?? ''); setDialog('range'); setMenu(false)
      }}>{tr('调整录音范围')}</button>
      <button type="button" disabled={disabled || (relinkOptions.length === 0 && !renderMessagePicker) || entry.visibility !== 'private'} onClick={() => {
        setMessageRef(renderMessagePicker ? '' : relinkOptions[0]?.messageRef ?? ''); setDialog('relink'); setMenu(false)
      }}>{tr('关联其他消息')}</button>
      <button type="button" disabled={disabled || entry.visibility !== 'private'} onClick={() => void change({ kind: 'dismiss', reason: 'playback' })}>{tr('这是播放内容')}</button>
      <button type="button" disabled={disabled || entry.visibility !== 'private'} onClick={() => void change({ kind: 'dismiss', reason: 'remove' })}>{tr('移除关联')}</button>
    </div>}
    {error && <p className="arkme-offline-error" role="alert">{error} {unknown && <button type="button" disabled={busy} onClick={() => void reconcile()}>{tr('核对状态')}</button>}</p>}
    {feedback && <p className="arkme-offline-feedback" role="status">{feedback}</p>}
    {dialog && <ArkmeConfirmDialog titleId={dialogId}
      title={dialog === 'withdraw' ? tr('撤回已分享消息') : dialog === 'share' ? tr('分享线下交流') : dialog === 'range' ? tr('调整录音范围') : tr('关联其他消息')}
      description={dialog === 'withdraw' ? tr('撤回此前发送到对话的共享快照。个人关联和原始录音保留。') : dialog === 'share' ? `${tr('接收范围')}：${entry.conversationName}${entry.conversationKind === 'group_chat' ? ` · ${tr('群内可见')}` : ''}`
        : dialog === 'range' ? tr('选择连续的原文片段。修改后会重新核对摘要与关联。') : tr('选择这段交流实际对应的消息。')}
      confirmLabel={dialog === 'withdraw' ? tr('确认撤回') : dialog === 'share' ? preview ? tr('确认分享（演示）') : tr('确认分享') : tr('保存')}
      busyLabel={tr('处理中…')} busy={busy} error={error}
      confirmDisabled={unknown || recoveryPending || (dialog === 'relink' && !messageRef) || (dialog === 'range' && (!rangeReady || !rangeValid)) || (dialog === 'share' && (!canShareOfflineContext(entry) || !preview && !frozen))}
      onClose={() => setDialog(undefined)} onConfirm={() => void change(dialog === 'withdraw' ? { kind: 'withdraw' } : dialog === 'share' ? { kind: 'share', includeTranscript, ...(frozen ? { previewRef: frozen.previewRef } : {}) }
        : dialog === 'range' ? { kind: 'range', evidenceIds: rangeIds, startOffset, endOffset } : { kind: 'relink', messageRef })}>
      {dialog === 'withdraw' ? <p>{tr('撤回后如需再次分享，请重新预览并确认。')}</p> : dialog === 'share' ? <div className="arkme-offline-share-preview">
        {preview ? <><strong>{entry.title}</strong><ul>{entry.summary.map((line, index) => <li key={index}>{line}</li>)}</ul></> : frozen ? <><strong>{frozen.title}</strong><p>{frozen.summary}</p></> : <p role="status">{tr('正在取得分享预览…')}</p>}
        <label><input type="checkbox" checked={includeTranscript} onChange={event => setIncludeTranscript(event.target.checked)} />{tr('附上所选转写原文')}</label>
        {includeTranscript && (preview ? selected.map(item => <p key={item.id}>{item.speaker}：{item.text}</p>) : frozen?.transcript.map((line, index) => <p key={index}>{line}</p>))}
        <small>{tr('仅分享以上内容，不包含原始音频或其他录音片段。')}{preview ? ` ${tr('这是交互演示，不会发送消息。')}` : ''}</small>
      </div> : dialog === 'range' ? <div className="arkme-offline-range">
        {!rangeReady && <p role="status">{tr('正在读取最新转写…')}</p>}
        <label>{tr('从')}<select value={first} onChange={event => { setFirst(event.target.value); setStartOffset(0) }}>{rangeEvidence.map(item => <option key={item.id} value={item.id}>{offlineClock(item.startAtMillis)} · {item.text.slice(0, 28)}</option>)}</select></label>
        <label>{tr('到')}<select value={last} onChange={event => { setLast(event.target.value); setEndOffset(Array.from(rangeEvidence.find(e => e.id === event.target.value)?.text ?? '').length) }}>{rangeEvidence.map(item => <option key={item.id} value={item.id}>{offlineClock(item.endAtMillis)} · {item.text.slice(0, 28)}</option>)}</select></label>
        <label>{tr('首段起始字（从 1 开始）')}<input type="number" min={1} max={firstLength} value={startOffset + 1} onChange={event => setStartOffset(Number(event.target.value) - 1)} /></label>
        <label>{tr('末段结束字（含）')}<input type="number" min={1} max={lastLength} value={endOffset} onChange={event => setEndOffset(Number(event.target.value))} /></label>
        {!rangeValid && <p role="alert">{tr('请选择有效的连续文字范围。')}</p>}
        {rangeIds.length === 0 ? <p role="alert">{tr('结束片段不能早于开始片段。')}</p>
          : rangeEvidence.filter(item => rangeIds.includes(item.id)).map(item => <p key={item.id}>{Array.from(item.text).slice(item.id === first ? startOffset : 0, item.id === last ? endOffset : undefined).join('')}</p>)}
      </div> : renderMessagePicker ? renderMessagePicker(messageRef, setMessageRef) : <div className="arkme-offline-range"><select aria-label={tr('目标消息')} value={messageRef} onChange={event => setMessageRef(event.target.value)}>
        {relinkOptions.map(option => <option key={option.messageRef} value={option.messageRef}>{option.label}</option>)}
      </select></div>}
      {unknown && <button type="button" className="arkme-offline-reconcile" disabled={busy} onClick={() => void reconcile()}>{tr('核对状态')}</button>}
    </ArkmeConfirmDialog>}
  </article>
}
