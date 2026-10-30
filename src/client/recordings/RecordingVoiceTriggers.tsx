import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { Microphone } from '@phosphor-icons/react/dist/icons/Microphone'
import { VOICE_TRIGGER_PENDING, defaultRecordingVoiceRule, prioritizeRecordingVoiceCandidates, recordingVoiceRules,
  type RecordingVoiceCandidate, type RecordingVoicePage, type RecordingVoiceRule, type RecordingVoiceSettings, type RecordingVoiceDetail } from '../../recording-voice-trigger-contract.js'
import type { ArkmeRecordingWorkbenchItem } from '../../types.js'
import { callArkme } from '../api.js'
import { arkmeAuthStore } from '../auth-store.js'
import { arkmeTheme as theme } from '../arkme-theme.js'
import { tr, useArkmeLocale } from '../locale.js'
import { ArkmeRecordingSpeakerEditor } from './ArkmeRecordingSpeakerEditor.js'
import { useRecordingPlayback } from './useRecordingPlayback.js'

const button: CSSProperties = { border: `1px solid ${theme.border}`, borderRadius: 7, background: theme.base, color: theme.text, cursor: 'pointer', padding: '6px 10px', font: 'inherit', fontSize: 13 }
const quiet: CSSProperties = { ...button, border: 0, background: 'transparent', color: theme.secondary }
const input: CSSProperties = { width: '100%', boxSizing: 'border-box', border: `1px solid ${theme.border}`, borderRadius: 7, background: theme.input, color: theme.text, padding: '8px 10px', font: 'inherit', fontSize: 14 }
const message = (error: unknown) => error instanceof Error ? error.message : tr('语音触发读取失败')
const clock = (time: number) => new Date(time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

/** No background work until this entry is opened. All recording sources share one owner. */
export function RecordingVoiceTriggerEntry({ style, mediaPath }: { style?: CSSProperties | undefined; mediaPath: string }) {
  useArkmeLocale()
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const accountKey = auth.auth?.status === 'authenticated' ? `${auth.auth.environment}:${auth.auth.userId}` : ''
  const [menu, setMenu] = useState(false), [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  useEffect(() => { setMenu(false); setOpen(false) }, [accountKey])
  useEffect(() => {
    if (!menu) return
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setMenu(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [menu])
  return <>
    <button ref={trigger} type="button" style={style} disabled={!accountKey} aria-label={tr('更多录音操作')} aria-haspopup="menu" aria-expanded={menu}
      onClick={() => { const rect = trigger.current?.getBoundingClientRect(); if (rect) setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 188)), top: Math.min(rect.bottom + 4, window.innerHeight - 64) }); setMenu(value => !value) }}>
      <DotsThree size={18} aria-hidden />{tr('更多')}
    </button>
    {menu && createPortal(<div ref={popup} role="menu" aria-label={tr('录音更多操作')} style={{ position: 'fixed', ...position, width: 180, zIndex: 1100, padding: 5, border: `1px solid ${theme.border}`, borderRadius: 9, background: theme.base, boxShadow: '0 8px 28px #0002' }}>
      <button type="button" role="menuitem" style={{ ...quiet, display: 'flex', alignItems: 'center', gap: 8, width: '100%', color: theme.text }} onClick={() => { setMenu(false); setOpen(true) }}><Microphone size={16} />{tr('语音触发')}</button>
    </div>, document.body)}
    {open && accountKey && <RecordingVoiceTriggerDialog key={accountKey} accountKey={accountKey} mediaPath={mediaPath} onClose={() => { setOpen(false); trigger.current?.focus() }} />}
  </>
}

export function RecordingVoiceTriggerDialog({ accountKey, mediaPath, onClose }: { accountKey: string; mediaPath: string; onClose(): void }) {
  useArkmeLocale()
  const [settings, setSettings] = useState<RecordingVoiceSettings>(), [items, setItems] = useState<RecordingVoiceCandidate[]>([])
  const [cursor, setCursor] = useState<string>(), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [editing, setEditing] = useState<RecordingVoiceRule>()
  const [voices, setVoices] = useState<ArkmeRecordingWorkbenchItem[]>(), [marking, setMarking] = useState<ArkmeRecordingWorkbenchItem>()
  const dialog = useRef<HTMLElement>(null), abort = useRef<AbortController>(), actionLock = useRef(false), readVersion = useRef(0)
  const editingRef = useRef(false); editingRef.current = !!editing || !!voices || !!marking
  const playback = useRecordingPlayback(mediaPath)
  const guard = (value: RecordingVoiceSettings) => { if (value.accountKey !== accountKey) throw new Error(tr('账号已切换，请重新打开语音触发')); return value }
  const reload = useCallback(async () => {
    if (actionLock.current || editingRef.current) return
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller
    const version = ++readVersion.current
    setLoading(true); setError('')
    try {
      const next = guard(await callArkme<RecordingVoiceSettings>('recordings.voice-triggers', { action: 'settings', accountKey }, controller.signal))
      if (controller.signal.aborted || version !== readVersion.current) return
      setSettings(next)
      if (!next.available) { setItems([]); setCursor(undefined); return }
      const page = await callArkme<RecordingVoicePage>('recordings.voice-triggers', { action: 'page', accountKey }, controller.signal)
      if (controller.signal.aborted || version !== readVersion.current) return
      setItems(prioritizeRecordingVoiceCandidates(page.items)); setCursor(page.nextCursor)
    } catch (reason) { if (!controller.signal.aborted && version === readVersion.current) setError(message(reason)) }
    finally { if (!controller.signal.aborted && version === readVersion.current) setLoading(false) }
  }, [accountKey])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    void reload()
    const focus = () => { void reload() }
    window.addEventListener('focus', focus)
    return () => { abort.current?.abort(); window.removeEventListener('focus', focus); previous?.focus() }
  }, [reload])
  const run = async (task: () => Promise<void>) => {
    if (actionLock.current) return
    actionLock.current = true; abort.current?.abort(); readVersion.current++
    setLoading(false); setBusy(true); setError(''); setNotice('')
    try { await task() } catch (reason) { setError(message(reason)) }
    finally { actionLock.current = false; setBusy(false) }
  }
  const save = (rules: RecordingVoiceRule[]) => run(async () => {
    if (!settings) return
    const result = guard(await callArkme<RecordingVoiceSettings>('recordings.voice-triggers.rules.set', { accountKey, rules: recordingVoiceRules(rules), localRevision: settings.draft.revision, revision: settings.revision }))
    setSettings(result); setEditing(undefined)
    setNotice(result.available ? tr('语音触发规则已保存') : tr('配置已保存在本机，尚未开始自动检测。'))
  })
  const decide = (candidate: RecordingVoiceCandidate, decision: 'save' | 'ignore') => run(async () => {
    const result = await callArkme<RecordingVoiceCandidate>('recordings.voice-triggers.decide', { accountKey, candidateRef: candidate.candidateRef, decision })
    // Keep the row in place, including while late voiceprint attribution arrives.
    if (result.candidateKey !== candidate.candidateKey) throw new Error(tr('识别记录不一致，请刷新后重试'))
    setItems(values => values.map(item => item.candidateKey === candidate.candidateKey ? result : item))
    setNotice(decision === 'save' ? tr('已保存到发给自己，可继续标记说话人。') : tr('已忽略这条识别记录'))
  })
  const detail = (candidate: RecordingVoiceCandidate, mark: boolean) => run(async () => {
    const value = await callArkme<RecordingVoiceDetail>('recordings.voice-triggers', { accountKey, action: 'detail', candidateRef: candidate.candidateRef })
    if (mark) setVoices(value.items)
    else await playback.playAt(value.items, value.items[0]!.startAtMillis)
  })
  const more = () => run(async () => {
    const page = await callArkme<RecordingVoicePage>('recordings.voice-triggers', { action: 'page', accountKey, cursor })
    if (page.nextCursor === cursor) throw new Error(tr('识别记录分页未前进，请刷新重试'))
    setItems(values => { const refs = new Set(values.map(item => item.candidateKey)); return [...values, ...page.items.filter(item => !refs.has(item.candidateKey))] })
    setCursor(page.nextCursor)
  })
  const close = () => { if (!actionLock.current) { playback.stop(); onClose() } }
  return createPortal(<div onClick={event => { if (event.target === event.currentTarget) close() }} style={{ position: 'fixed', inset: 0, zIndex: 1008, background: '#0005', display: 'grid', placeItems: 'center', padding: 12 }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-label={tr('语音触发')} onKeyDown={event => {
      if (marking) return
      if (event.key === 'Escape') { event.stopPropagation(); if (editing) setEditing(undefined); else if (voices) setVoices(undefined); else close() }
      if (event.key === 'Tab') {
        const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])]
        const first = nodes[0], last = nodes.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }} style={{ width: 'min(760px, 100%)', maxHeight: 'calc(100dvh - 24px)', display: 'flex', flexDirection: 'column', borderRadius: 14, background: theme.base, color: theme.text, boxShadow: '0 12px 50px #0003', overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: `1px solid ${theme.border}` }}>
        <strong style={{ flex: 1 }}>{tr('语音触发')}</strong>
        <button type="button" style={quiet} disabled={busy} onClick={close} aria-label={tr('关闭语音触发')}><X size={20} /></button>
      </header>
      <div style={{ padding: '16px 20px', overflowY: 'auto', minHeight: 0, display: 'grid', gap: 14, fontSize: 13 }}>
        <p style={{ margin: 0, color: theme.secondary }}>{tr('上传音频、长录音、全天候录音统一识别。本人优先，其他声音命中也保留供确认。')}</p>
        {settings && !settings.available && <div role="status" style={{ padding: 12, borderRadius: 8, background: theme.layer1, color: theme.secondary }}>{tr(VOICE_TRIGGER_PENDING)}<br />{tr('现在可配置规则并保存在本机；接通后再应用到云端，不会自动执行历史录音。')}</div>}
        {error && <div role="alert" style={{ color: theme.danger }}>{error} <button type="button" style={quiet} disabled={busy || !!editing} onClick={() => { void reload() }}>{tr('重新读取')}</button></div>}
        {notice && <div role="status" style={{ color: theme.secondary }}>{notice}</div>}
        {loading && <div role="status">{tr('正在读取语音触发…')}</div>}
        {settings && <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><strong>{tr('触发规则')}</strong>
            <button type="button" style={quiet} disabled={busy || !!editing || settings.rules.length >= 20} onClick={() => setEditing({ ...defaultRecordingVoiceRule(), id: crypto.randomUUID(), phrase: '', enabled: true })}><Plus size={14} /> {tr('添加')}</button></div>
          {settings.rules.map(rule => <div key={rule.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${theme.border}` }}>
            <div style={{ flex: 1, minWidth: 0 }}><strong>{rule.phrase}</strong><div style={{ marginTop: 5, color: theme.secondary }}>{tr('保存到发给自己')} · {rule.enabled ? settings.available ? tr('已开启') : tr('已配置，待接通') : tr('未开启')}</div></div>
            <button type="button" style={quiet} disabled={busy || !!editing} onClick={() => setEditing(structuredClone(rule))}>{tr('编辑')}</button>
          </div>)}
          {settings.available && settings.draft.revision > 0 && JSON.stringify(settings.draft.rules) !== JSON.stringify(settings.rules) && <button type="button" style={button} disabled={busy || !!editing} onClick={() => { void save(settings.draft.rules) }}>{tr('应用此前保存在本机的配置')}</button>}
          {editing && <VoiceRuleEditor key={editing.id} rule={editing} busy={busy} onCancel={() => setEditing(undefined)} onSave={rule => { void save([...settings.rules.filter(item => item.id !== rule.id), rule]) }} />}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><strong>{tr('识别记录')}</strong><span style={{ color: theme.secondary }}>{tr('本人优先')} <button type="button" style={quiet} disabled={busy || loading || !!editing || !!voices} onClick={() => { void reload() }}>{tr('刷新')}</button></span></div>
          {settings.available && !loading && !error && items.length === 0 && <p style={{ margin: 0, color: theme.secondary }}>{tr('尚未发现口令命中。录音上传并处理后，识别结果会显示在这里。')}</p>}
          {items.map(candidate => <article key={candidate.candidateKey} style={{ padding: 12, border: `1px solid ${theme.border}`, borderRadius: 9 }}>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap', color: theme.secondary }}><span>{candidate.speaker === 'self' ? tr('我') : candidate.speakerLabel} · {clock(candidate.startAtMillis)}</span><span>{tr(candidate.status === 'saved' ? '已保存' : candidate.status === 'ignored' ? '已忽略' : '待确认')}</span></div>
            <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6 }}>{candidate.text || tr('等待后续录音…')}</div>
            {candidate.boundary !== 'complete' && <p style={{ color: theme.secondary }}>{tr(candidate.boundary === 'open' ? '正在等待后续录音，内容完整后可保存。' : '内容边界待确认，请试听核对后保存。')}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button type="button" style={quiet} disabled={busy} onClick={() => { void detail(candidate, false) }}>{tr('播放原音')}</button>
              {candidate.status === 'pending' && <><button type="button" style={quiet} disabled={busy} onClick={() => { void decide(candidate, 'ignore') }}>{tr('忽略')}</button><button type="button" style={button} disabled={busy || candidate.boundary === 'open' || !candidate.text.trim()} onClick={() => { void decide(candidate, 'save') }}>{tr('保存到发给自己')}</button></>}
              {candidate.status === 'saved' && <button type="button" style={button} disabled={busy} onClick={() => { void detail(candidate, true) }}>{tr('标记说话人')}</button>}
            </div>
          </article>)}
          {cursor && <button type="button" style={quiet} disabled={busy || loading} onClick={() => { void more() }}>{tr('加载更多')}</button>}
        </>}
        {playback.isPlaying && <button type="button" style={quiet} onClick={playback.stop}>{tr('停止播放')}</button>}
        {playback.error && <p role="alert" style={{ color: theme.danger }}>{playback.error}</p>}
        {voices && <section aria-label={tr('选择标记的原音片段')} style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 12 }}><strong>{tr('选择需要标记的原音片段')}</strong><p style={{ color: theme.secondary }}>{tr('保存记事不会自动改变说话人。每次仅标记所选片段，更大范围需另行确认。')}</p>
          {voices.map(item => <button type="button" key={item.itemRef} style={{ ...button, width: '100%', marginBottom: 6, textAlign: 'left' }} disabled={!item.canBindSpeaker} onClick={() => setMarking(item)}>{item.speakerLabel} · {clock(item.startAtMillis)}<br />{item.text}</button>)}
          <button type="button" style={quiet} onClick={() => setVoices(undefined)}>{tr('收起')}</button></section>}
      </div>
    </section>
    {marking && <ArkmeRecordingSpeakerEditor item={marking} items={[marking]} initialBatchUpdate={false} onPlay={item => { void playback.playItem(item) }} onClose={() => setMarking(undefined)} onUpdated={() => { setMarking(undefined); setVoices(undefined); setNotice(tr('已标记所选片段，身份识别效果会随后续处理核验。')) }} />}
  </div>, document.body)
}

function VoiceRuleEditor({ rule, busy, onSave, onCancel }: { rule: RecordingVoiceRule; busy: boolean; onSave(rule: RecordingVoiceRule): void; onCancel(): void }) {
  const [phrase, setPhrase] = useState(rule.phrase), [aliases, setAliases] = useState(rule.aliases.join('\n'))
  const [enabled, setEnabled] = useState(rule.enabled), [auto, setAuto] = useState(rule.autoSaveSelf), [error, setError] = useState('')
  return <form aria-label={tr('编辑语音触发规则')} onSubmit={event => { event.preventDefault(); try { const [next] = recordingVoiceRules([{ ...rule, phrase, aliases: aliases.split('\n').map(value => value.trim()).filter(Boolean), enabled, autoSaveSelf: auto }]); onSave(next!) } catch (reason) { setError(message(reason)) } }} style={{ display: 'grid', gap: 12, padding: 14, borderRadius: 9, background: theme.layer1 }}>
    <label>{tr('触发口令')}<input style={input} value={phrase} maxLength={64} disabled={busy} onChange={event => setPhrase(event.target.value)} /></label>
    <label>{tr('其他说法（可选，每行一条，最多 5 条）')}<textarea style={{ ...input, resize: 'vertical' }} rows={2} value={aliases} disabled={busy} onChange={event => setAliases(event.target.value)} /></label>
    <label><input type="checkbox" checked={enabled} disabled={busy} onChange={event => setEnabled(event.target.checked)} /> {tr('启用这条规则')}</label>
    <label><input type="checkbox" checked={auto} disabled={busy} onChange={event => setAuto(event.target.checked)} /> {tr('可靠识别为本人且内容完整时自动保存')}</label>
    <span style={{ color: theme.secondary }}>{tr('其他声音命中也会保留供确认。执行动作：保存到发给自己。')}</span>
    {error && <p role="alert" style={{ color: theme.danger, margin: 0 }}>{error}</p>}
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button type="button" style={quiet} disabled={busy} onClick={onCancel}>{tr('取消')}</button><button type="submit" style={button} disabled={busy}>{tr(busy ? '保存中…' : '保存')}</button></div>
  </form>
}
