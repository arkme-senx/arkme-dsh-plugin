import { X } from '@phosphor-icons/react/dist/icons/X'
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { ArkmeDirectorySourceAvatar } from '../ArkmeAvatar.js'
import selfLightIcon from '../../../assets/recording-icons/icon_send_to_self_sidebar.svg'
import selfDarkIcon from '../../../assets/recording-icons/icon_send_to_self_sidebar_dark.svg'
import { buildArkmeSourceTree, flattenVisibleArkmeSourceTree } from '../source-tree.js'
import { RECORDING_FORWARD_MAX_TARGETS } from '../../recording-forward-contract.js'
import { RecordingDesktopIcon } from './RecordingDesktopIcon.js'
import { RecordingTranscriptButton } from './RecordingTranscriptButton.js'
import { useEffect, useRef, useState } from 'react'
import type { ArkmeSourceItem, ArkmeSourceList } from '../../types.js'
import { recordingForwardTargetKey as targetKey, type RecordingForwardAttempt } from './recording-forward-attempt.js'
import { callArkme } from '../api.js'
import { arkmeTheme as colors } from '../arkme-theme.js'

function TargetAvatar({ target, size }: { target: ArkmeSourceItem; size: number }) {
  return target.kind === 'send_to_self' || target.kind === 'topic'
    ? <span aria-hidden style={{ width: size, height: size, flex: 'none' }}><img data-arkme-theme-image="light" alt="" src={`data:image/svg+xml;base64,${selfLightIcon}`} width={size} height={size} style={{ display: 'block' }} /><img data-arkme-theme-image="dark" alt="" src={`data:image/svg+xml;base64,${selfDarkIcon}`} width={size} height={size} style={{ display: 'none' }} /></span>
    : <ArkmeDirectorySourceAvatar source={target} size={size} />
}

export function RecordingTranscriptForward({ attempt, onClose, onComplete, maxCommentLength = 20_000 }: {
  attempt: RecordingForwardAttempt; onClose(): void; onComplete(message: string): void; maxCommentLength?: number
}) {
  const [directory, setDirectory] = useState<'root' | 'send_to_self'>('root')
  const [targets, setTargets] = useState<ArkmeSourceItem[]>([])
  const [selfTarget, setSelfTarget] = useState<ArkmeSourceItem>()
  const selfTargetController = useRef<AbortController>()
  const [nextCursor, setNextCursor] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [capability, setCapability] = useState<{ supported: boolean } | { error: string }>()
  const [filter, setFilter] = useState('')
  const [comment, setComment] = useState(attempt.commentText ?? '')
  const [selectionError, setSelectionError] = useState('')
  const [collapsedTopics, setCollapsedTopics] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Map<string, ArkmeSourceItem>>(new Map())
  const [results, setResults] = useState<Map<string, string>>(new Map())
  const [sending, setSending] = useState(false)
  const controller = useRef<AbortController>()
  const directoryController = useRef<AbortController>()
  const capabilityController = useRef<AbortController>()
  const busy = useRef(false)
  const closed = useRef(false)
  const closeButton = useRef<HTMLButtonElement>(null)
  const recordSupported = capability !== undefined && 'supported' in capability && capability.supported

  const checkCapability = async () => {
    capabilityController.current?.abort()
    const request = new AbortController(); capabilityController.current = request
    setCapability(undefined)
    try {
      const value = await callArkme<{ recordTargetsSupported: boolean }>('recordings.forward.capabilities', {}, request.signal)
      if (!request.signal.aborted) setCapability({ supported: value.recordTargetsSupported })
    } catch {
      if (!request.signal.aborted) setCapability({ error: '未能确认自己和主题的转发能力，联系人和群聊仍可使用' })
    }
  }

  useEffect(() => {
    closed.current = false
    const previous = document.activeElement
    closeButton.current?.focus()
    void checkCapability()
    return () => {
      closed.current = true; selfTargetController.current?.abort(); capabilityController.current?.abort(); controller.current?.abort(); directoryController.current?.abort()
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  const loadSelfTarget = async () => {
    selfTargetController.current?.abort()
    const request = new AbortController(); selfTargetController.current = request
    try {
      const page = await callArkme<ArkmeSourceList>('sources.list', { directory: 'send_to_self', limit: 50 }, request.signal)
      if (request.signal.aborted || closed.current) return
      const target = page.items.find(item => item.kind === 'send_to_self')
      if (target === undefined) throw new Error('未能读取发给自己入口，请重试')
      setSelfTarget(target)
      setSelected(previous => previous.has('send_to_self') ? new Map(previous).set('send_to_self', target) : previous)
    } catch {
      if (!request.signal.aborted && !closed.current) setLoadError('未能读取发给自己入口，联系人和群聊仍可使用')
    }
  }

  useEffect(() => {
    if (recordSupported) void loadSelfTarget()
    return () => { selfTargetController.current?.abort() }
  }, [recordSupported])

  const load = async (cursor?: string) => {
    directoryController.current?.abort()
    const request = new AbortController(); directoryController.current = request
    setLoading(true); setLoadError('')
    if (directory === 'root' && recordSupported && selfTarget === undefined) void loadSelfTarget()
    try {
      const page = await callArkme<ArkmeSourceList>('sources.list', { directory, limit: 50, ...(cursor === undefined ? {} : { cursor }) }, request.signal)
      if (request.signal.aborted || closed.current) return
      setSelected(previous => {
        const next = new Map(previous)
        for (const item of page.items) if (next.has(targetKey(item))) next.set(targetKey(item), item)
        return next
      })
      setTargets(previous => {
        const values = new Map((cursor === undefined ? [] : previous).map(item => [targetKey(item), item]))
        for (const item of page.items) if (targetKey(item) !== '') values.set(targetKey(item), item)
        return [...values.values()]
      })
      if (page.hasMore && (page.nextCursor === undefined || page.nextCursor === cursor)) {
        setLoadError('目标列表分页暂不可用，请刷新后重试'); setNextCursor(undefined)
      } else setNextCursor(page.hasMore ? page.nextCursor : undefined)
    } catch (reason) { if (!request.signal.aborted && !closed.current) setLoadError(reason instanceof Error ? reason.message : '读取转发目标失败') }
    finally { if (!request.signal.aborted && !closed.current) setLoading(false) }
  }

  useEffect(() => { setTargets([]); setNextCursor(undefined); setFilter(''); void load(); return () => { directoryController.current?.abort() } }, [directory])

  const send = async () => {
    if (busy.current || selected.size === 0) return
    busy.current = true; setSending(true)
    const request = new AbortController(); controller.current = request
    try {
      const message = await attempt.send([...selected.values()], comment, request.signal, (key, result) => {
        setResults(previous => new Map(previous).set(key, result))
      })
      if (!request.signal.aborted && message !== undefined) onComplete(message)
    } finally {
      busy.current = false
      if (!closed.current) setSending(false)
    }
  }

  const toggleTarget = (target: ArkmeSourceItem, checked: boolean) => {
    if (busy.current || attempt.hasSent(targetKey(target))) return
    setSelectionError('')
    if (checked && !selected.has(targetKey(target)) && selected.size >= RECORDING_FORWARD_MAX_TARGETS) { setSelectionError('最多选择 5 个发送对象'); return }
    setSelected(previous => {
      const next = new Map(previous); const key = targetKey(target)
      if (checked) { if (next.size < RECORDING_FORWARD_MAX_TARGETS || next.has(key)) next.set(key, target) } else next.delete(key)
      return next
    })
  }
  const keyword = filter.trim().toLocaleLowerCase()
  const directoryTargets = directory === 'root' && selfTarget !== undefined
    ? [selfTarget, ...targets.filter(target => target.kind !== 'send_to_self')]
    : targets
  const rows = directory === 'send_to_self' && keyword === ''
    ? flattenVisibleArkmeSourceTree(buildArkmeSourceTree(directoryTargets), collapsedTopics)
    : directoryTargets.filter(target => `${target.displayName} ${target.latestPreview ?? ''}`.toLocaleLowerCase().includes(keyword)).map(source => ({ source, depth: 0, hasChildren: false, expanded: false }))

  return <div style={{ position: 'fixed', inset: 0, zIndex: 1_100, display: 'grid', placeItems: 'center', padding: 'min(48px,5vh) min(48px,5vw)', boxSizing: 'border-box', background: 'var(--dsw-alias-bg-mask-1, rgba(19,22,26,.34))' }}><section role="dialog" aria-modal="true" aria-label="转发录音片段" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose() }
    if (event.key === 'Tab') {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)'))
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
    }
  }} style={{ width: 'min(520px,100%)', height: 'min(660px,100%)', minHeight: 'min(520px,100%)', overflow: 'hidden', display: 'flex', flexDirection: 'column', borderRadius: 16, background: colors.base, color: colors.text, border: `1px solid ${colors.border}`, boxShadow: colors.shadow }}>
    <header style={{ height: 54, flex: 'none', display: 'grid', gridTemplateColumns: '54px 1fr 54px', alignItems: 'center' }}>
      {directory === 'send_to_self' ? <RecordingTranscriptButton aria-label="返回转发对象" onClick={() => { setDirectory('root') }} style={{ border: 0, background: 'transparent', display: 'grid', placeItems: 'center' }}><CaretLeft size={20} /></RecordingTranscriptButton> : <span />}
      <strong style={{ fontSize: 16, textAlign: 'center', fontWeight: 600 }}>{directory === 'root' ? '转发给' : '发给自己'}</strong>
      <RecordingTranscriptButton ref={closeButton} aria-label="关闭录音转发" onClick={onClose} style={{ border: 0, background: 'transparent', display: 'grid', placeItems: 'center', color: colors.tertiary }}><X size={20} /></RecordingTranscriptButton>
    </header>
    <div style={{ margin: '4px 18px 12px', height: 38, flex: 'none', position: 'relative' }}>
      <span style={{ position: 'absolute', left: 13, top: 10, color: colors.caption }}><RecordingDesktopIcon name="search" size={17} /></span>
      <input aria-label="搜索转发对象" placeholder="搜索" value={filter} onChange={event => { setFilter(event.target.value) }} style={{ boxSizing: 'border-box', width: '100%', height: '100%', border: 0, borderRadius: 10, padding: '0 12px 0 40px', background: colors.layer2, color: colors.text, outline: 0, fontSize: 13 }} />
    </div>
    {directory === 'root' && recordSupported && selfTarget === undefined && loadError === '' && <small role="status" style={{ margin: '0 18px 8px', color: colors.secondary }}>正在读取发给自己入口…</small>}
    {capability === undefined && <small role="status" style={{ margin: '0 18px 8px', color: colors.secondary }}>正在检查自己和主题转发能力…</small>}
    {capability !== undefined && ('error' in capability
      ? <small role="alert" style={{ margin: '0 18px 8px', color: colors.danger }}>{capability.error}<RecordingTranscriptButton aria-label="重新检查转发能力" onClick={() => { void checkCapability() }}>重试</RecordingTranscriptButton></small>
      : !capability.supported && <small role="status" style={{ margin: '0 18px 8px', color: colors.secondary }}>服务端暂不支持向自己或主题转发录音</small>)}
    <div style={{ overflowY: 'auto', minHeight: 0, flex: 1, padding: '4px 18px 18px' }}>{rows.map(({ source: target, depth, hasChildren, expanded }) => {
      const key = targetKey(target); const sent = attempt.hasSent(key)
      const checked = sent || selected.has(key)
      const recordTarget = target.kind === 'send_to_self' || target.kind === 'topic'
      const disabled = sending || sent || (recordTarget && !recordSupported)
      return <div key={key} style={{ display: 'flex', alignItems: 'center', paddingLeft: depth * 18 }}>
        {hasChildren && <RecordingTranscriptButton aria-label={`${expanded ? '折叠' : '展开'}主题 ${target.displayName}`} onClick={() => { setCollapsedTopics(previous => { const next = new Set(previous); if (next.has(target.sourceRef)) next.delete(target.sourceRef); else next.add(target.sourceRef); return next }) }} style={{ width: 20, padding: 0, border: 0, background: 'transparent', transform: expanded ? 'rotate(90deg)' : undefined }}><CaretRight size={14} /></RecordingTranscriptButton>}
        <label style={{ minWidth: 0, flex: 1, display: 'grid', gridTemplateColumns: '20px 36px minmax(0,1fr) auto', gap: 10, padding: '9px 8px', alignItems: 'center', cursor: disabled ? 'default' : 'pointer', borderRadius: 8 }}>
          <span style={{ position: 'relative', width: 20, height: 20 }}><input type="checkbox" aria-label={`选择发送对象 ${target.displayName}`} disabled={disabled} checked={checked} onChange={event => { toggleTarget(target, event.target.checked) }} style={{ appearance: 'none', margin: 0, width: 20, height: 20, borderRadius: '50%', border: `1px solid ${checked ? colors.text : colors.caption}`, background: checked ? colors.text : 'transparent', cursor: 'inherit', opacity: disabled && !sent ? .4 : 1 }} />{checked && <Check aria-hidden size={14} weight="bold" style={{ position: 'absolute', left: 3, top: 3, color: colors.base, pointerEvents: 'none' }} />}</span>
          <TargetAvatar target={target} size={36} />
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, fontWeight: 500 }}>{target.displayName}</span>{target.latestPreview && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: colors.secondary }}>{target.latestPreview}</span>}</span>
          {sent ? <small>已转发</small> : target.activeAtMillis > 0 && <time style={{ fontSize: 12, color: colors.caption }}>{new Date(target.activeAtMillis).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</time>}
        </label>
        {target.kind === 'send_to_self' && directory === 'root' && <RecordingTranscriptButton aria-label="选择自己和主题" disabled={!recordSupported} onClick={() => { setDirectory('send_to_self') }} style={{ width: 28, border: 0, padding: 0, background: 'transparent' }}><CaretRight size={16} /></RecordingTranscriptButton>}
      </div>
    })}{!loading && rows.length === 0 && loadError === '' && <p style={{ textAlign: 'center', fontSize: 12, color: colors.secondary }}>{keyword ? '未找到匹配的对象' : '暂无转发目标'}</p>}
    {loadError !== '' && <div role="alert">{loadError}<RecordingTranscriptButton disabled={loading} onClick={() => { void load(nextCursor) }}>重试</RecordingTranscriptButton></div>}
    {loading && <span role="status">正在读取目标…</span>}{nextCursor !== undefined && <RecordingTranscriptButton disabled={loading} onClick={() => { void load(nextCursor) }}>加载更多目标</RecordingTranscriptButton>}
    </div>
    {selectionError && <small role="alert" style={{ margin: '0 18px 8px', color: colors.danger }}>{selectionError}</small>}
    {selected.size > 0 && <footer aria-label="已选转发目标" style={{ flex: 'none', padding: '10px 16px 14px', borderTop: `1px solid ${colors.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 30 }}><span style={{ fontSize: 14, fontWeight: 600 }}>发送给：</span>{[...selected].map(([key, target]) => <span key={key} title={target.displayName}><TargetAvatar target={target} size={26} /></span>)}</div>
      <div style={{ height: 1, margin: '8px 2px 6px', background: colors.border }} />
      <div aria-label="录音转发预览" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 34, fontSize: 12 }}><RecordingDesktopIcon name="forward" size={18} /><div style={{ minWidth: 0, flex: 1 }}><div>录音片段（{attempt.items.length}）</div><div style={{ color: colors.tertiary, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{attempt.items[0]?.speakerLabel}：{attempt.items[0]?.text}</div></div></div>
      <div style={{ position: 'relative', marginTop: 6, borderRadius: 12, background: colors.layer2 }}>
        <textarea rows={1} aria-label="转发附言" placeholder="说点什么..." value={comment} maxLength={maxCommentLength} readOnly={attempt.commentText !== undefined} onChange={event => { setComment(event.target.value) }} style={{ width: '100%', minHeight: 54, maxHeight: 102, resize: 'none', border: 0, outline: 0, padding: '17px 66px 17px 16px', boxSizing: 'border-box', background: 'transparent', color: colors.text, font: 'inherit', fontSize: 14, lineHeight: '20px', display: 'block' }} />
        <RecordingTranscriptButton aria-label={sending ? '正在转发' : '发送录音'} disabled={sending || [...selected.keys()].every(key => attempt.hasSent(key))} onClick={() => { void send() }} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, border: 0, borderRadius: '50%', padding: 0, display: 'grid', placeItems: 'center', background: colors.primaryAction, color: colors.onPrimaryAction }}><RecordingDesktopIcon name="forward" size={22} /></RecordingTranscriptButton>
      </div>
      {results.size > 0 && <div role="status" style={{ maxHeight: 64, overflowY: 'auto', fontSize: 12, lineHeight: '18px', marginTop: 6 }}>{[...selected].map(([key, target]) => results.has(key) && <div key={key} style={{ color: attempt.hasSent(key) ? colors.secondary : colors.danger }}>{target.displayName}：{results.get(key)}</div>)}</div>}
    </footer>}
  </section></div>
}
